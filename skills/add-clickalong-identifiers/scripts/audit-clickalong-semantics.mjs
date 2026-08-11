#!/usr/bin/env node

// Static audit for the AI-assist semantic contract (references/assist-semantics.md).
// Source heuristics only: it cannot compute rendered accessible names, so errors
// are reserved for markup that is definitionally wrong for the shipped widget
// (unrecognized data-clickalong-action values, the attribute on elements the
// widget classifies before consulting it) and everything else is a warning.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([
  ".astro",
  ".cjs",
  ".cshtml",
  ".ejs",
  ".erb",
  ".handlebars",
  ".hbs",
  ".htm",
  ".html",
  ".js",
  ".jsx",
  ".liquid",
  ".mjs",
  ".php",
  ".pug",
  ".razor",
  ".svelte",
  ".ts",
  ".tsx",
  ".twig",
  ".vue",
]);

const IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".claude",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "__fixtures__",
  "__snapshots__",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "node_modules",
  "storybook-static",
  "target",
  "test",
  "tests",
  "vendor",
]);

const IGNORED_FILE = /(?:^|\.)((?:spec|test|stories))\.[^.]+$|\.snap$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TAG_SPAN = 2_000;

function locationFor(source, index) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: index - lastNewline };
}

function isCommentOnlyLine(source, index) {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);
  const line = source.slice(start, end === -1 ? source.length : end).trimStart();
  return line.startsWith("//") || line.startsWith("<!--") || line.startsWith("*") ||
    line.startsWith("/*") || line.startsWith("{/*");
}

/**
 * A dynamic framework binding (Vue `:attr` / `v-bind:attr`, Angular
 * `[attr.…]`, or an object/member position like `props.attr =`) carries an
 * expression, not a literal — skip it rather than judging the expression text.
 * The same guard keeps selector strings (`[data-…='x']`) out of the findings.
 */
function isDynamicBinding(source, index) {
  const previous = index > 0 ? source[index - 1] : "";
  return previous === ":" || previous === "[" || previous === ".";
}

/**
 * The opening tag containing the given attribute match. Scans forward from
 * the tag's `<` tracking brace depth and string/template quotes, so a `>`
 * inside a JSX arrow-function prop or a quoted attribute value never
 * terminates the tag early. Returns null when the markup cannot be bounded
 * confidently — every consumer then skips (fails open) rather than guessing.
 */
function enclosingTag(source, index) {
  const start = source.lastIndexOf("<", index);
  if (start === -1 || index - start > MAX_TAG_SPAN) return null;
  let depth = 0;
  let quote = "";
  let end = -1;
  const limit = Math.min(source.length, start + MAX_TAG_SPAN);
  for (let cursor = start + 1; cursor < limit; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote && source[cursor - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth = Math.max(0, depth - 1);
    } else if (character === ">" && depth === 0) {
      end = cursor;
      break;
    } else if (character === "<" && depth === 0) {
      // A fresh tag opened before this one closed: the lookbehind `<` was
      // not a tag start (likely a comparison operator).
      return null;
    }
  }
  if (end === -1 || index > end) return null;
  const text = source.slice(start, end + 1);
  const name = /^<\s*([A-Za-z][\w.-]*)/.exec(text)?.[1] ?? "";
  if (!name) return null;
  return { start, text, name: name.toLowerCase() };
}

function hasAttribute(tagText, attribute) {
  return new RegExp(`(?:^|[\\s{("'])${attribute}\\s*[=/>\\s]`, "i").test(tagText);
}

function attributeValue(tagText, attribute) {
  const match = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:\\{\\s*)?(["'])([^"']*)\\1`,
    "i",
  ).exec(tagText);
  return match ? match[2] : null;
}

function finding(type, severity, file, source, index, message) {
  const { line, column } = locationFor(source, index);
  return { type, severity, file, line, column, message };
}

function scanSource(file, source) {
  const findings = [];

  const action = /\bdata-clickalong-action\s*=\s*(?:\{\s*)?(["'])([^"']*)\1/g;
  for (const match of source.matchAll(action)) {
    if (isCommentOnlyLine(source, match.index) || isDynamicBinding(source, match.index)) continue;
    const value = match[2];
    // Messages deliberately avoid the attribute="value" shape so the audit
    // never flags its own strings when a repo contains the installed skill.
    if (value !== "navigation") {
      findings.push(finding(
        "invalid-action-value",
        "error",
        file,
        source,
        match.index,
        `Unrecognized value ${JSON.stringify(value)} for data-clickalong-action; the widget honors only the value navigation.`,
      ));
      continue;
    }
    const tag = enclosingTag(source, match.index);
    if (!tag) continue;
    const role = attributeValue(tag.text, "role");
    const type = attributeValue(tag.text, "type");
    const declaresType = hasAttribute(tag.text, "type");
    // A <button> with no type attribute IS a submit button per HTML — the
    // widget classifies it before the opt-in is consulted. A declared but
    // non-literal type (a dynamic expression) is skipped, not judged.
    const submitButton =
      (tag.name === "button" && (type === "submit" || !declaresType)) ||
      (tag.name === "input" && type === "submit");
    const toggleRole = role === "checkbox" || role === "radio";
    if (["input", "select", "textarea"].includes(tag.name) || submitButton || toggleRole) {
      const subject = toggleRole
        ? `${role}-role element`
        : submitButton
          ? (tag.name === "button" && !declaresType
            ? "button (no type attribute, which defaults to submit)"
            : "submit button")
          : tag.name;
      findings.push(finding(
        "inert-action-placement",
        "error",
        file,
        source,
        match.index,
        `The navigation opt-in has no effect on this ${subject} — the widget classifies form fields, ` +
          "submit buttons, and checkbox/radio roles before consulting the attribute and never treats them as navigation." +
          (tag.name === "button" && !declaresType ? " Add an explicit button type." : ""),
      ));
    }
  }

  const emptyLabel = /\blabel\s*=\s*(?:""|''|\{\s*(?:""|'')\s*\})/g;
  for (const match of source.matchAll(emptyLabel)) {
    if (isCommentOnlyLine(source, match.index) || isDynamicBinding(source, match.index)) continue;
    const tag = enclosingTag(source, match.index);
    if (!tag) continue;
    if (hasAttribute(tag.text, "aria-label") || hasAttribute(tag.text, "aria-labelledby")) continue;
    const hasPlaceholder = hasAttribute(tag.text, "placeholder");
    findings.push(finding(
      "empty-label",
      "warning",
      file,
      source,
      match.index,
      `This ${tag.name} has an empty label prop and no aria-label: its accessible name ` +
        (hasPlaceholder
          ? "falls through to the placeholder, so the AI guide knows it by example text instead of its visible caption."
          : "is empty, so the AI guide cannot target it by name at all.") +
        " Give it its visible label (e.g. label plus labelHidden) or an aria-label.",
    ));
  }

  const passwordType = /\btype\s*=\s*(?:\{\s*)?(["'])password\1/g;
  for (const match of source.matchAll(passwordType)) {
    if (isCommentOnlyLine(source, match.index) || isDynamicBinding(source, match.index)) continue;
    const tag = enclosingTag(source, match.index);
    if (!tag || hasAttribute(tag.text, "autocomplete")) continue;
    findings.push(finding(
      "password-without-autocomplete",
      "warning",
      file,
      source,
      match.index,
      `This password ${tag.name} has no autocomplete attribute; declare current-password or new-password ` +
        "so credential fencing is deterministic and browser autofill behaves.",
    ));
  }

  return findings;
}

function shouldIgnoreFile(name) {
  return IGNORED_FILE.test(name) || !SOURCE_EXTENSIONS.has(extname(name).toLowerCase());
}

function looksGenerated(path, source) {
  const name = basename(path).toLowerCase();
  if (name.includes(".min.")) return true;
  if (!new Set([".cjs", ".js", ".mjs"]).has(extname(name))) return false;
  if (source.length < 30_000) return false;
  const lineCount = source.split("\n").length;
  return lineCount < 250 || source.split("\n").some((line) => line.length > 5_000);
}

async function collectFiles(root) {
  const files = [];
  const warnings = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path);
        continue;
      }
      if (!entry.isFile() || shouldIgnoreFile(entry.name)) continue;

      const info = await stat(path);
      if (info.size > MAX_FILE_BYTES) {
        warnings.push({
          type: "large-file",
          severity: "warning",
          file: relative(root, path),
          message: `Skipped file larger than ${MAX_FILE_BYTES} bytes.`,
        });
        continue;
      }
      files.push(path);
    }
  }

  await walk(root);
  return { files, warnings };
}

export async function auditClickalongSemantics(rootPath = ".") {
  const root = resolve(rootPath);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error(`Not a directory: ${root}`);

  const { files, warnings } = await collectFiles(root);
  const errors = [];
  let filesScanned = 0;

  for (const path of files) {
    const source = await readFile(path, "utf8");
    const file = relative(root, path).split(sep).join("/");
    if (looksGenerated(path, source)) {
      warnings.push({
        type: "generated-file",
        severity: "warning",
        file,
        message: "Skipped probable generated JavaScript bundle.",
      });
      continue;
    }
    filesScanned += 1;
    for (const item of scanSource(file, source)) {
      (item.severity === "error" ? errors : warnings).push(item);
    }
  }

  errors.sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0)
  );
  warnings.sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0)
  );

  return { root, filesScanned, errors, warnings };
}

function formatLocation(item) {
  return item.file ? `${item.file}:${item.line ?? 1}:${item.column ?? 1}` : "audit";
}

function printHuman(result) {
  console.log(`Clickalong assist-semantics audit: ${result.root}`);
  console.log(`Scanned ${result.filesScanned} source files.`);

  for (const warning of result.warnings) {
    console.warn(`WARNING ${formatLocation(warning)} — ${warning.message}`);
  }
  for (const error of result.errors) {
    console.error(`ERROR ${formatLocation(error)} — ${error.message}`);
  }

  if (result.errors.length === 0) {
    console.log(
      "Static audit passed. Accessible names cannot be computed statically — " +
        "verify rendered names and uniqueness in the app (references/assist-semantics.md).",
    );
  }
}

function printHelp() {
  console.log(`Usage: node audit-clickalong-semantics.mjs [repository-root] [--json]

Static heuristics for the Clickalong AI-assist semantic contract:
  - errors on unrecognized data-clickalong-action values and on placements the
    widget ignores (form fields, submit buttons incl. type-less <button>,
    checkbox/radio roles);
  - warns on empty-label fields without an aria-label (placeholder-named or
    nameless controls) and password inputs without autocomplete.

Literal static markup only: dynamic framework bindings (Vue :attr, Angular
[attr...], expression values) are skipped, not judged.

Exits 1 when errors are present. Warnings never fail the audit.`);
}

async function main(argv) {
  let root = ".";
  let json = false;
  let rootSeen = false;

  for (const argument of argv) {
    if (argument === "--json") {
      json = true;
    } else if (argument === "--help" || argument === "-h") {
      printHelp();
      return 0;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (rootSeen) {
      throw new Error(`Unexpected argument: ${argument}`);
    } else {
      root = argument;
      rootSeen = true;
    }
  }

  const result = await auditClickalongSemantics(root);
  if (json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  return result.errors.length === 0 ? 0 : 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`ERROR ${error.message}`);
      process.exitCode = 2;
    });
}
