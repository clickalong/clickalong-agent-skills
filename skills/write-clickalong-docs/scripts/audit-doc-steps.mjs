#!/usr/bin/env node

/**
 * Step-structure audit for a generated Clickalong docs bundle.
 *
 * Clickalong executes numbered steps: the workspace AI assistant quotes them
 * as numbered lists, live assistance falls back from a published tour to an
 * ordered public document, and operators follow them as the script when
 * recording a tour (25-step recorder cap). This audit checks that every
 * task-shaped document carries ordered steps a tour could follow: present,
 * flat, atomic, bounded, and naming their controls.
 *
 * Zero dependencies. Errors always fail the run; warnings fail it under
 * --strict. Wording checks assume English step text; non-English bundles
 * may waive those warnings with the operator.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

/** Documents shaped as a task must carry ordered steps. */
const STEP_REQUIRED_TYPES = new Set(["how-to", "troubleshooting"]);
const KNOWN_TYPES = new Set(["how-to", "feature-guide", "faq", "troubleshooting", "concept"]);
const DEFAULT_TYPE = "how-to";

/** Clickalong's recorder caps a tour at 25 steps; longer tasks must split. */
const MAX_TOUR_STEPS = 25;
const MAX_STEP_LENGTH = 220;

const ORDERED_ITEM = /^(\s*)\d{1,3}[.)]\s+(.*)$/;
const COMPOUND_STEP = /,\s*then\b|\band then\b|;\s/i;
const VAGUE_START = /^(?:make sure|ensure|verify that|configure|set up|manage)\b/i;
const ACTION_VERB = /\b(?:click|tap|press|select|choose|open|toggle|enable|disable|drag|expand|collapse)\b/i;

function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return { type: null, endIndex: 0 };
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      const block = lines.slice(1, index).join("\n");
      const match = /^type:\s*["']?([A-Za-z-]+)["']?\s*$/m.exec(block);
      return { type: match ? match[1].toLowerCase() : null, endIndex: index + 1 };
    }
  }
  return { type: null, endIndex: 0 };
}

function preview(text) {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function auditDocument(file, source) {
  const findings = [];
  const lines = source.split("\n");
  const { type: declaredType, endIndex } = parseFrontmatter(lines);
  const type = declaredType ?? DEFAULT_TYPE;

  if (declaredType && !KNOWN_TYPES.has(declaredType)) {
    findings.push({
      severity: "warning",
      type: "unknown-type",
      file,
      line: 1,
      preview: declaredType,
      message: `Unknown document type. Use one of: ${[...KNOWN_TYPES].join(", ")}.`,
    });
  }

  const lists = [];
  let current = null;
  let inFence = false;
  for (let index = endIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      current = null;
      continue;
    }
    if (inFence) continue;

    const item = ORDERED_ITEM.exec(line);
    if (item && item[1].length === 0) {
      if (!current) {
        current = { startLine: index + 1, items: [], nestedReported: false };
        lists.push(current);
      }
      current.items.push({ line: index + 1, text: item[2].trim() });
    } else if (item) {
      if (current && !current.nestedReported) {
        current.nestedReported = true;
        findings.push({
          severity: "warning",
          type: "nested-steps",
          file,
          line: index + 1,
          preview: preview(item[2].trim()),
          message:
            "Tours are linear — a nested step cannot be followed. Flatten it into the sequence or split the document.",
        });
      }
    } else if (line.trim() !== "") {
      current = null;
    }
  }

  const steps = lists.reduce((total, list) => total + list.items.length, 0);

  if (STEP_REQUIRED_TYPES.has(type) && lists.length === 0) {
    findings.push({
      severity: "error",
      type: "missing-steps",
      file,
      line: 1,
      preview: `type: ${type}`,
      message:
        "A task-shaped document must carry a numbered Steps list — Clickalong's assistant and tours follow it. Add ordered steps or set a non-task type (feature-guide, faq, concept).",
    });
  }

  for (const list of lists) {
    if (list.items.length > MAX_TOUR_STEPS) {
      findings.push({
        severity: "warning",
        type: "too-many-steps",
        file,
        line: list.startLine,
        preview: `${list.items.length} steps`,
        message: `More than ${MAX_TOUR_STEPS} steps cannot become one tour (recorder cap). Split the task into smaller documents.`,
      });
    }
    for (const step of list.items) {
      if (COMPOUND_STEP.test(step.text)) {
        findings.push({
          severity: "warning",
          type: "compound-step",
          file,
          line: step.line,
          preview: preview(step.text),
          message:
            "One action per step. Split 'X, then Y' into two steps; a tour can only spotlight one control at a time.",
        });
      }
      if (VAGUE_START.test(step.text)) {
        findings.push({
          severity: "warning",
          type: "vague-step",
          file,
          line: step.line,
          preview: preview(step.text),
          message:
            "Steps are actions, not conditions. Move preconditions to 'Before you start' or name the exact action and control.",
        });
      }
      if (ACTION_VERB.test(step.text) && !step.text.includes("**")) {
        findings.push({
          severity: "warning",
          type: "unlabeled-action",
          file,
          line: step.line,
          preview: preview(step.text),
          message:
            "Name the exact control in **bold** exactly as the UI renders it — the assistant quotes labels verbatim and tour targets are matched against them.",
        });
      }
      if (step.text.length > MAX_STEP_LENGTH) {
        findings.push({
          severity: "warning",
          type: "long-step",
          file,
          line: step.line,
          preview: preview(step.text),
          message: `Step exceeds ${MAX_STEP_LENGTH} characters — it is probably several actions. Split it.`,
        });
      }
    }
  }

  return { type, lists: lists.length, steps, findings };
}

async function collectFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.shift();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (extname(entry.name).toLowerCase() !== ".md") continue;
      if (basename(entry.name).startsWith("_")) continue;
      files.push(join(directory, entry.name));
    }
  }
  return files.sort();
}

export async function auditDocSteps(root) {
  const resolvedRoot = resolve(root);
  const rootStat = await stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error(`Not a directory: ${resolvedRoot}`);

  const files = await collectFiles(resolvedRoot);
  const documents = [];
  const findings = [];
  for (const file of files) {
    const relativePath = relative(resolvedRoot, file) || file;
    const source = await readFile(file, "utf8");
    const result = auditDocument(relativePath, source);
    documents.push({
      file: relativePath,
      type: result.type,
      lists: result.lists,
      steps: result.steps,
    });
    findings.push(...result.findings);
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return {
    root: resolvedRoot,
    files: files.length,
    documents,
    findings,
    errors: findings.filter((finding) => finding.severity === "error"),
    warnings: findings.filter((finding) => finding.severity === "warning"),
  };
}

function parseArguments(argv) {
  const options = { json: false, strict: false };
  let root;
  for (const argument of argv) {
    if (argument === "--json") options.json = true;
    else if (argument === "--strict") options.strict = true;
    else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else if (root === undefined) root = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (root === undefined) {
    throw new Error("Usage: audit-doc-steps.mjs <docs-folder> [--strict] [--json]");
  }
  return { root, options };
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exitCode = 1;
    return;
  }

  const result = await auditDocSteps(parsed.root);

  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const finding of result.findings) {
      console.log(
        `${finding.severity.toUpperCase()} ${finding.type} ${finding.file}:${finding.line}\n  ${finding.preview}\n  ${finding.message}`,
      );
    }
    for (const document of result.documents) {
      console.log(
        `${document.file}: type=${document.type} lists=${document.lists} steps=${document.steps}`,
      );
    }
    console.log(
      `\nAudited ${result.files} document(s): ${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
    );
  }

  const failed =
    result.errors.length > 0 || (parsed.options.strict && result.warnings.length > 0);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
