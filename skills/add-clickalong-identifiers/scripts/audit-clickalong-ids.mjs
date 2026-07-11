#!/usr/bin/env node

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
const VALID_ID = /^clickalong-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 96;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

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
  return line.startsWith("//") || line.startsWith("<!--") || line.startsWith("*");
}

function occurrence(file, source, index, value) {
  const { line, column } = locationFor(source, index);
  return { id: value, file, line, column };
}

function scanSource(file, source) {
  const occurrences = [];
  const dynamic = [];

  const quoted = /\bid\s*=\s*(?:\{\s*)?(["'])(clickalong-[^"']*)\1(?:\s*\})?/g;
  for (const match of source.matchAll(quoted)) {
    if (isCommentOnlyLine(source, match.index)) continue;
    occurrences.push(occurrence(file, source, match.index, match[2]));
  }

  const template = /\bid\s*=\s*\{\s*`(clickalong-[^`]*)`\s*\}/g;
  const templateRanges = [];
  for (const match of source.matchAll(template)) {
    if (isCommentOnlyLine(source, match.index)) continue;
    templateRanges.push([match.index, match.index + match[0].length]);
    if (match[1].includes("${")) {
      const { line, column } = locationFor(source, match.index);
      dynamic.push({
        type: "dynamic",
        file,
        line,
        column,
        message: "Clickalong IDs must be literal; remove template interpolation.",
      });
    } else {
      occurrences.push(occurrence(file, source, match.index, match[1]));
    }
  }

  const expression = /\bid\s*=\s*\{([^}\n]+)\}/g;
  for (const match of source.matchAll(expression)) {
    if (!match[1].includes("clickalong-") || isCommentOnlyLine(source, match.index)) continue;
    const coveredByTemplate = templateRanges.some(
      ([start, end]) => match.index >= start && match.index < end
    );
    const representedAsQuotedLiteral = /^[\s]*["']clickalong-[^"']*["'][\s]*$/.test(match[1]);
    if (coveredByTemplate || representedAsQuotedLiteral) continue;
    const { line, column } = locationFor(source, match.index);
    dynamic.push({
      type: "dynamic",
      file,
      line,
      column,
      message: "Clickalong IDs must be literal; remove variables or concatenation.",
    });
  }

  return { occurrences, dynamic };
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

export async function auditClickalongIds(rootPath = ".") {
  const root = resolve(rootPath);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error(`Not a directory: ${root}`);

  const { files, warnings } = await collectFiles(root);
  const occurrences = [];
  const errors = [];
  let filesScanned = 0;

  for (const path of files) {
    const source = await readFile(path, "utf8");
    const file = relative(root, path).split(sep).join("/");
    if (looksGenerated(path, source)) {
      warnings.push({
        type: "generated-file",
        file,
        message: "Skipped probable generated JavaScript bundle.",
      });
      continue;
    }
    filesScanned += 1;
    const scanned = scanSource(file, source);
    occurrences.push(...scanned.occurrences);
    errors.push(...scanned.dynamic);
  }

  for (const item of occurrences) {
    if (!VALID_ID.test(item.id) || item.id.length > MAX_ID_LENGTH) {
      errors.push({
        type: "invalid",
        ...item,
        message:
          `Invalid ID "${item.id}"; expected lowercase kebab-case ` +
          `matching ${VALID_ID} and at most ${MAX_ID_LENGTH} characters.`,
      });
    }
  }

  const grouped = new Map();
  for (const item of occurrences) {
    const group = grouped.get(item.id) ?? [];
    group.push(item);
    grouped.set(item.id, group);
  }
  for (const [id, group] of grouped) {
    if (group.length < 2) continue;
    errors.push({
      type: "duplicate",
      id,
      locations: group.map(({ file, line, column }) => ({ file, line, column })),
      message: `ID "${id}" has ${group.length} literal source declarations.`,
    });
  }

  occurrences.sort((a, b) =>
    a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line
  );
  errors.sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0)
  );

  if (occurrences.length === 0) {
    warnings.push({
      type: "no-identifiers",
      message: "No literal clickalong-* IDs were found in scanned source files.",
    });
  }

  return {
    root,
    filesScanned,
    occurrences,
    errors,
    warnings,
  };
}

function formatLocation(item) {
  return item.file ? `${item.file}:${item.line ?? 1}:${item.column ?? 1}` : "audit";
}

function printHuman(result) {
  console.log(`Clickalong ID audit: ${result.root}`);
  console.log(`Scanned ${result.filesScanned} source files; found ${result.occurrences.length} IDs.`);

  for (const item of result.occurrences) {
    console.log(`  ${item.id}  ${formatLocation(item)}`);
  }
  for (const warning of result.warnings) {
    console.warn(`WARNING ${formatLocation(warning)} — ${warning.message}`);
  }
  for (const error of result.errors) {
    const locations = error.locations
      ? ` (${error.locations.map(formatLocation).join(", ")})`
      : "";
    console.error(`ERROR ${formatLocation(error)} — ${error.message}${locations}`);
  }

  if (result.errors.length === 0) {
    console.log("Static audit passed. Verify uniqueness and visibility in the rendered app.");
  }
}

function printHelp() {
  console.log(`Usage: node audit-clickalong-ids.mjs [repository-root] [--json]

Validate literal clickalong-* HTML IDs in web source files. Generated output,
dependencies, tests, stories, and fixtures are ignored.`);
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

  const result = await auditClickalongIds(root);
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
