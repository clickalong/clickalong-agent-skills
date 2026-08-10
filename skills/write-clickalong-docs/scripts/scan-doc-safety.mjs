#!/usr/bin/env node

/**
 * Safety scanner for a generated Clickalong docs bundle.
 *
 * Scans every text file under the given folder for content that must never
 * ship in end-user documentation: credential shapes, URLs with embedded
 * credentials, secret-named assignments carrying real-looking values
 * (errors), plus local filesystem paths, internal/dev endpoints,
 * non-example email addresses, admin/staging URLs, and high-entropy
 * strings (warnings).
 *
 * Zero dependencies. Errors always fail the run; warnings fail it under
 * --strict. Error previews are redacted so the report itself cannot leak
 * the secret it found.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCANNED_EXTENSIONS = new Set([
  ".json",
  ".markdown",
  ".md",
  ".mdx",
  ".txt",
  ".yaml",
  ".yml",
]);

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const DEFAULT_ALLOWED_EMAIL_DOMAINS = ["example.com", "example.net", "example.org"];

/** Error rules: content that is never acceptable in a public document. */
const TOKEN_RULES = [
  ["aws-access-key-id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g],
  ["stripe-webhook-secret", /\bwhsec_[A-Za-z0-9]{8,}\b/g],
  ["shopify-token", /\bshp(?:at|ca|ss|pa)_[A-Fa-f0-9]{8,}\b/g],
  ["github-token", /\b(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["model-provider-key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g],
  ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  // userinfo credentials in any URL scheme (postgres://u:p@, mongodb+srv://u:p@, https basic auth)
  ["url-credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`]+:[^\s@/"'`]+@/gi],
];

const SECRET_NAME_WORDS =
  "SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_?SECRET|CREDENTIALS?";

/** ENV_STYLE: `SOME_API_KEY=value` / `SOME_TOKEN: value`. */
const ENV_ASSIGNMENT = new RegExp(
  `\\b([A-Z][A-Z0-9_]*(?:${SECRET_NAME_WORDS})[A-Z0-9_]*)\\s*[:=]\\s*["'\`]?([^\\s"'\`]{8,})`,
  "g",
);

/** JSON/JS style: `"apiKey": "value"`. */
const KEYED_ASSIGNMENT = new RegExp(
  `["']([A-Za-z]*(?:[Ss]ecret|[Tt]oken|[Pp]assword|[Aa]pi[_]?[Kk]ey|[Pp]rivate[_]?[Kk]ey|[Cc]redentials?)[A-Za-z]*)["']\\s*:\\s*["']([^"']{8,})["']`,
  "g",
);

/** Values that are clearly placeholders, not leaked secrets. */
const PLACEHOLDER_VALUE =
  /^(?:<[^>]*>?|\{\{.*|\$\{.*|\$[A-Z_]+|your[-_.][^\s]*|my[-_.][^\s]*|x{4,}.*|\*{3,}.*|\.{3}.*|…|example.*|changeme.*|placeholder.*|redacted.*|todo.*|dummy.*|sample.*|\[.*)$/i;

/** Values that are structurally not secrets. */
const NON_SECRET_VALUE = /^(?:https?:\/\/|true$|false$|null$|none$|\d+$)/i;

const WARNING_RULES = [
  [
    "filesystem-path",
    /(?:\/Users\/[^\s"'`)\]]+|\/home\/[^\s"'`)\]]+|[A-Za-z]:\\[^\s"'`)\]]+)/g,
    "Local filesystem path — leaks machine layout or a username; end-user docs should not need one.",
  ],
  [
    "internal-endpoint",
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9][a-z0-9-]*\.(?:internal|local|corp|lan))\b/gi,
    "Internal or development endpoint — end users cannot reach it and it maps your infrastructure.",
  ],
  [
    "suspicious-url-path",
    /https?:\/\/[^\s)"'`]*\/(?:admin|internal|staging|debug)(?:[/?#]|\b)/gi,
    "URL points at an admin/internal/staging/debug surface — not an end-user destination.",
  ],
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,})\b/g;

const ENTROPY_CANDIDATE = /[A-Za-z0-9+/=_-]{32,}/g;
const ENTROPY_THRESHOLD = 4.2;

function shannonEntropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function redact(value) {
  const head = value.slice(0, 4);
  return `${head}…(${value.length} chars, redacted)`;
}

function isAllowedEmailDomain(domain, allowedDomains) {
  const lower = domain.toLowerCase();
  return allowedDomains.some(
    (allowed) => lower === allowed || lower.endsWith(`.${allowed}`),
  );
}

function* matchAll(pattern, line) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    yield match;
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
}

function scanLine(line, lineNumber, file, allowedDomains) {
  const findings = [];
  const errorSpans = [];

  const record = (severity, type, column, matched, message, { redactMatch } = {}) => {
    findings.push({
      severity,
      type,
      file,
      line: lineNumber,
      column,
      preview: redactMatch ? redact(matched) : matched,
      message,
    });
  };

  for (const [type, pattern] of TOKEN_RULES) {
    for (const match of matchAll(pattern, line)) {
      errorSpans.push([match.index, match.index + match[0].length]);
      record(
        "error",
        type,
        match.index + 1,
        match[0],
        "Credential-shaped content must never appear in a document, even as an example.",
        { redactMatch: true },
      );
    }
  }

  for (const pattern of [ENV_ASSIGNMENT, KEYED_ASSIGNMENT]) {
    for (const match of matchAll(pattern, line)) {
      const value = match[2];
      if (PLACEHOLDER_VALUE.test(value) || NON_SECRET_VALUE.test(value)) continue;
      const overlaps = errorSpans.some(
        ([start, end]) => match.index < end && match.index + match[0].length > start,
      );
      if (overlaps) continue;
      errorSpans.push([match.index, match.index + match[0].length]);
      record(
        "error",
        "secret-assignment",
        match.index + 1,
        `${match[1]}=${value}`,
        "Secret-named assignment with a real-looking value. Describe where users find the value instead of printing one.",
        { redactMatch: true },
      );
    }
  }

  for (const [type, pattern, message] of WARNING_RULES) {
    for (const match of matchAll(pattern, line)) {
      record("warning", type, match.index + 1, match[0], message);
    }
  }

  for (const match of matchAll(EMAIL, line)) {
    if (isAllowedEmailDomain(match[1], allowedDomains)) continue;
    record(
      "warning",
      "email-address",
      match.index + 1,
      match[0],
      "Email on a non-example domain. Use you@example.com, or allow the product's own domain with --allow-domain.",
    );
  }

  for (const match of matchAll(ENTROPY_CANDIDATE, line)) {
    const value = match[0];
    const overlapsError = errorSpans.some(
      ([start, end]) => match.index < end && match.index + value.length > start,
    );
    if (overlapsError) continue;
    const mixedCase = /[a-z]/.test(value) && /[A-Z]/.test(value);
    const hasDigit = /\d/.test(value);
    if (!hasDigit || !(mixedCase || /[+/=]/.test(value))) continue;
    if (shannonEntropy(value) < ENTROPY_THRESHOLD) continue;
    record(
      "warning",
      "high-entropy-string",
      match.index + 1,
      redact(value),
      "High-entropy string — looks machine-generated. Confirm it is not a key, token, or signed URL.",
    );
  }

  return findings;
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
      if (!SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      files.push(join(directory, entry.name));
    }
  }
  return files.sort();
}

export async function scanDocSafety(root, options = {}) {
  const resolvedRoot = resolve(root);
  const rootStat = await stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error(`Not a directory: ${resolvedRoot}`);

  const allowedDomains = [
    ...DEFAULT_ALLOWED_EMAIL_DOMAINS,
    ...(options.allowDomains ?? []).map((domain) => domain.toLowerCase()),
  ];

  const files = await collectFiles(resolvedRoot);
  const findings = [];
  for (const file of files) {
    const fileStat = await stat(file);
    const relativePath = relative(resolvedRoot, file) || file;
    if (fileStat.size > MAX_FILE_BYTES) {
      findings.push({
        severity: "warning",
        type: "file-too-large",
        file: relativePath,
        line: 1,
        column: 1,
        preview: `${fileStat.size} bytes`,
        message: "File exceeds the scan size limit and was skipped. Split it or review it manually.",
      });
      continue;
    }
    const source = await readFile(file, "utf8");
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      findings.push(...scanLine(lines[index], index + 1, relativePath, allowedDomains));
    }
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
  return {
    root: resolvedRoot,
    files: files.length,
    findings,
    errors: findings.filter((finding) => finding.severity === "error"),
    warnings: findings.filter((finding) => finding.severity === "warning"),
  };
}

function parseArguments(argv) {
  const options = { json: false, strict: false, allowDomains: [] };
  let root;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--allow-domain") {
      const value = argv[index + 1];
      if (!value) throw new Error("--allow-domain requires a value");
      options.allowDomains.push(value);
      index += 1;
    } else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else if (root === undefined) root = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (root === undefined) {
    throw new Error(
      "Usage: scan-doc-safety.mjs <docs-folder> [--strict] [--json] [--allow-domain <domain>]...",
    );
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

  const result = await scanDocSafety(parsed.root, parsed.options);

  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const finding of result.findings) {
      console.log(
        `${finding.severity.toUpperCase()} ${finding.type} ${finding.file}:${finding.line}:${finding.column}\n  ${finding.preview}\n  ${finding.message}`,
      );
    }
    console.log(
      `\nScanned ${result.files} file(s): ${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
    );
    if (result.errors.length > 0) {
      console.log("Errors must be removed before these documents can be published.");
    } else if (result.warnings.length > 0) {
      console.log(
        "Warnings must be fixed or explicitly waived by the operator before publishing.",
      );
    }
  }

  const failed =
    result.errors.length > 0 || (parsed.options.strict && result.warnings.length > 0);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
