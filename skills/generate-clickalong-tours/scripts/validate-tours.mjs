#!/usr/bin/env node

/**
 * Offline validator for Clickalong tour drafts. Mirrors the Agent API's
 * server-side rules so a push never fails on shape, and applies the same
 * leak-safety posture as write-clickalong-docs: tour copy and selectors are
 * public content, so anything secret-shaped or account-specific is an error.
 *
 * Findings NEVER quote the offending value — a report that repeats a secret
 * is itself a leak. Locations are file + field + segment index only.
 *
 * Errors always fail the run; warnings fail it unless --allow-warnings (the
 * operator's explicit, per-run waiver). Unknown flags are hard errors.
 * Zero dependencies.
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DRAFT_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 256 * 1024;
const SENTINEL_ORIGIN = "https://portable-path.invalid";

const SECRET_SHAPES = [
  /\b(sk|pk|rk|ck|cka|ghp|gho|ghs|shpat|shpss)_[a-z0-9_-]{10,}/i,
  /\bsk-proj-[a-z0-9_-]{10,}/i,
  /\bgithub_pat_[a-z0-9_]{10,}/i,
  /\bxox[abps]-[a-z0-9-]{10,}/i,
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\beyJ[a-zA-Z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i,
  /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{8,}/i,
];
const ID_SEGMENT_ERROR =
  /^(?:[0-9]{6,}|[0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25}|c[a-z0-9]{20,}|gid:.*)$/i;
const ID_SEGMENT_WARN = /^(?:[0-9]{4,5}|(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])[a-zA-Z0-9]{16,})$/;

const TOP_LEVEL_KEYS = new Set([
  // Local push envelope (managed by push-tours.mjs), then the API body.
  "id", "version",
  "name", "description", "start", "audience", "steps", "expectedVersion",
]);
const STEP_KEYS = new Set([
  "selector", "fallbackLocators", "title", "description", "annotation", "advanceOn", "route",
]);

export async function validateTours(folder) {
  const errors = [];
  const warnings = [];
  const err = (file, message) => errors.push(`${file}: ${message}`);
  const warn = (file, message) => warnings.push(`${file}: ${message}`);

  const isPlainObject = (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  function checkCopy(file, label, text) {
    if (typeof text !== "string") return;
    for (const shape of SECRET_SHAPES) {
      if (shape.test(text)) {
        err(file, `${label} contains a secret-shaped string (value withheld from this report)`);
        return;
      }
    }
    if (/@(?!example\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
      warn(file, `${label} contains a non-example email address`);
    }
    if (/localhost|127\.0\.0\.1|\.internal\b|staging\./i.test(text)) {
      warn(file, `${label} references a local/staging/internal address`);
    }
  }

  function portablePathname(file, label, value, { shopify }) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
      return err(file, `${label} must be an absolute pathname`);
    }
    if (
      value.length > 500 ||
      value.includes("?") ||
      value.includes("#") ||
      value.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      /%(?:2f|5c|2e)/i.test(value)
    ) {
      return err(
        file,
        `${label} must be ≤500 chars with no query, hash, backslashes, control characters, or encoded separators`
      );
    }
    let resolved;
    try {
      resolved = new URL(value, SENTINEL_ORIGIN);
    } catch {
      return err(file, `${label} does not parse as a pathname`);
    }
    // Dot segments, protocol-relative tricks, or anything else that changes
    // origin or canonical form under real browser URL resolution.
    if (resolved.origin !== SENTINEL_ORIGIN || resolved.pathname !== value) {
      return err(file, `${label} changes under URL normalization (dot segments or origin escape)`);
    }
    const segments = value.split("/");
    segments.forEach((segment, index) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        /* keep raw */
      }
      if (segment === "*" || ID_SEGMENT_ERROR.test(decoded)) {
        err(
          file,
          `${label} segment ${index} looks account/record-specific${shopify ? " — Shopify starts/routes must be store-portable" : ""}`
        );
      } else if (ID_SEGMENT_WARN.test(decoded)) {
        warn(file, `${label} segment ${index} may be account-specific — confirm it is a stable route`);
      }
    });
  }

  function checkSelector(file, label, selector) {
    if (typeof selector !== "string" || selector.trim().length === 0 || selector.length > 300) {
      return err(file, `${label} must be a non-empty CSS selector ≤300 chars`);
    }
    checkCopy(file, label, selector);
    const tokens = selector.split(/[^a-zA-Z0-9]+/);
    tokens.forEach((token, index) => {
      if (token && ID_SEGMENT_ERROR.test(token)) {
        err(file, `${label} embeds an account/record-shaped value (token ${index})`);
      } else if (token && ID_SEGMENT_WARN.test(token)) {
        warn(file, `${label} token ${index} may be account-specific`);
      }
    });
    if (/:nth-[a-z-]+\(/i.test(selector)) {
      warn(file, `${label} uses positional :nth-* matching — fragile across accounts and redesigns`);
    }
    if (
      /\.(?:css|sc|jss|emotion|chakra)-[a-zA-Z0-9]+/.test(selector) ||
      /\.[a-zA-Z0-9_-]*(?:-[0-9a-f]{5,}|__[a-zA-Z0-9]*\d[a-zA-Z0-9]{2,})(?![a-zA-Z0-9_-])/.test(selector)
    ) {
      warn(file, `${label} looks like a build-generated class name`);
    }
  }

  function requireString(file, label, value, min, max) {
    if (typeof value !== "string" || value.trim().length < min || value.length > max) {
      err(file, `${label} must be a string of ${min}–${max} chars`);
      return false;
    }
    return true;
  }

  const folderStat = await lstat(resolve(folder)).catch(() => null);
  if (!folderStat || folderStat.isSymbolicLink() || !folderStat.isDirectory()) {
    return { files: [], errors: [`Draft folder not found or not a plain directory: ${folder}`], warnings };
  }
  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith(".json") && !entry.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) {
    return { files: [], errors: [`No tour drafts (*.json) in ${folder}`], warnings };
  }

  const files = [];
  const names = new Map();
  for (const entry of entries) {
    const name = entry.name;
    files.push(name);
    try {
      if (!entry.isFile()) {
        err(name, "not a regular file (symlinks and specials are refused)");
        continue;
      }
      const fileStat = await lstat(join(folder, name));
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        err(name, "not a regular file (symlinks and specials are refused)");
        continue;
      }
      if (fileStat.size > MAX_DRAFT_BYTES) {
        err(name, `larger than ${MAX_DRAFT_BYTES} bytes`);
        continue;
      }
      let draft;
      try {
        draft = JSON.parse(await readFile(join(folder, name), "utf8"));
      } catch {
        err(name, "not valid JSON");
        continue;
      }
      if (!isPlainObject(draft)) {
        err(name, "must be a JSON object");
        continue;
      }
      for (const key of Object.keys(draft)) {
        if (!TOP_LEVEL_KEYS.has(key)) err(name, `unknown field "${key}"`);
      }
      const { id, version } = draft;
      if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
        err(name, "id (push envelope) must be a UUID");
      }
      if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
        err(name, "version (push envelope) must be a positive integer");
      }
      const serialized = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
      if (serialized > MAX_BODY_BYTES) {
        err(name, `serializes to ${serialized} bytes — the API caps bodies at ${MAX_BODY_BYTES}`);
      }
      if (requireString(name, "name", draft.name, 1, 200)) {
        const existing = names.get(draft.name.trim());
        if (existing) err(name, `duplicate tour name also used by ${existing}`);
        names.set(draft.name.trim(), name);
        checkCopy(name, "name", draft.name);
      }
      if (draft.description !== undefined) {
        if (typeof draft.description !== "string" || draft.description.length > 500) {
          err(name, "description must be a string ≤500 chars");
        } else checkCopy(name, "description", draft.description);
      }
      const shopify = draft.start?.kind === "shopify-app";
      if (draft.start !== undefined && draft.start !== null) {
        if (!isPlainObject(draft.start)) err(name, "start must be an object or null");
        else {
          if (!["same-origin", "shopify-app"].includes(draft.start.kind)) {
            err(name, 'start.kind must be "same-origin" or "shopify-app"');
          }
          portablePathname(name, "start.pathname", draft.start.pathname, { shopify });
        }
      }
      if (draft.audience !== undefined && draft.audience !== null) {
        if (!isPlainObject(draft.audience)) err(name, "audience must be an object or null");
        else {
          for (const key of Object.keys(draft.audience)) {
            if (!["pathContains", "attributes"].includes(key)) {
              err(name, `audience has unknown field "${key}"`);
            }
          }
          if (draft.audience.pathContains !== undefined) {
            if (
              typeof draft.audience.pathContains !== "string" ||
              draft.audience.pathContains.length > 300
            ) {
              err(name, "audience.pathContains must be a string ≤300 chars");
            } else checkCopy(name, "audience.pathContains", draft.audience.pathContains);
          }
          if (draft.audience.attributes !== undefined) {
            if (!isPlainObject(draft.audience.attributes)) {
              err(name, "audience.attributes must be an object");
            } else {
              const pairs = Object.entries(draft.audience.attributes);
              if (pairs.length > 5) err(name, "audience.attributes is capped at 5 pairs");
              for (const [key, value] of pairs) {
                if (!/^[a-zA-Z0-9_.-]{1,50}$/.test(key)) {
                  err(name, "an audience attribute key is invalid (letters, numbers, dot, dash, underscore, ≤50)");
                }
                if (typeof value !== "string" || value.length === 0 || value.length > 200 || /[\r\n]/.test(value)) {
                  err(name, `audience.attributes value for a key must be a single-line string of 1–200 chars`);
                } else {
                  checkCopy(name, `audience.attributes value`, value);
                }
              }
            }
          }
        }
      }
      if (!Array.isArray(draft.steps) || draft.steps.length < 1 || draft.steps.length > 25) {
        err(name, "steps must be an array of 1–25 steps");
        continue;
      }
      const selectors = new Set();
      draft.steps.forEach((step, index) => {
        const label = `steps[${index}]`;
        if (!isPlainObject(step)) {
          err(name, `${label} must be an object`);
          return;
        }
        for (const key of Object.keys(step)) {
          if (!STEP_KEYS.has(key)) {
            err(name, `${label} has unknown field "${key}"${key === "screenshot" ? " (screenshots are server-owned)" : ""}`);
          }
        }
        checkSelector(name, `${label}.selector`, step.selector);
        if (typeof step.selector === "string") {
          if (selectors.has(step.selector)) {
            warn(name, `${label}.selector repeats an earlier step's selector`);
          }
          selectors.add(step.selector);
        }
        if (requireString(name, `${label}.title`, step.title, 1, 200)) {
          checkCopy(name, `${label}.title`, step.title);
        }
        if (step.description !== undefined) {
          if (typeof step.description !== "string" || step.description.length > 500) {
            err(name, `${label}.description must be a string ≤500 chars`);
          } else checkCopy(name, `${label}.description`, step.description);
        }
        if (step.annotation !== undefined) {
          if (typeof step.annotation !== "string" || step.annotation.length > 200) {
            err(name, `${label}.annotation must be a string ≤200 chars`);
          } else checkCopy(name, `${label}.annotation`, step.annotation);
        }
        // Explicit by contract: the server default is "click", authored tours
        // almost always want "manual", and silence has caused wedged runs.
        if (step.advanceOn === undefined) {
          err(name, `${label}.advanceOn is required — set "manual" (recommended) or "click" deliberately`);
        } else if (!["click", "manual"].includes(step.advanceOn)) {
          err(name, `${label}.advanceOn must be "click" or "manual"`);
        }
        if (step.route !== undefined) {
          if (draft.start === undefined || draft.start === null) {
            err(name, `${label}.route requires the tour to declare a start`);
          } else {
            portablePathname(name, `${label}.route`, step.route, { shopify });
          }
        }
        if (step.fallbackLocators !== undefined) {
          if (!Array.isArray(step.fallbackLocators) || step.fallbackLocators.length > 5) {
            err(name, `${label}.fallbackLocators must be an array of at most 5 locators`);
            return;
          }
          step.fallbackLocators.forEach((locator, locatorIndex) => {
            const locatorLabel = `${label}.fallbackLocators[${locatorIndex}]`;
            if (!isPlainObject(locator)) return err(name, `${locatorLabel} must be an object`);
            if (locator.kind === "css") {
              checkSelector(name, `${locatorLabel}.selector`, locator.selector);
            } else if (locator.kind === "role") {
              if (
                typeof locator.role !== "string" ||
                !/^[a-z][a-z0-9_-]{0,30}$/i.test(locator.role) ||
                !requireString(name, `${locatorLabel}.name`, locator.name, 1, 80)
              ) {
                err(name, `${locatorLabel} needs a valid role and a name of 1–80 chars`);
              } else checkCopy(name, `${locatorLabel}.name`, locator.name);
            } else if (locator.kind === "text") {
              if (
                typeof locator.tag !== "string" ||
                !/^[a-z][a-z0-9-]{0,30}$/i.test(locator.tag) ||
                !requireString(name, `${locatorLabel}.text`, locator.text, 1, 80)
              ) {
                err(name, `${locatorLabel} needs a valid tag and text of 1–80 chars`);
              } else checkCopy(name, `${locatorLabel}.text`, locator.text);
            } else {
              err(name, `${locatorLabel}.kind must be css, role, or text`);
            }
          });
        }
      });
    } catch (error) {
      err(name, `could not be validated (${error instanceof Error ? error.name : "error"})`);
    }
  }
  return { files, errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const allowWarnings = argv.includes("--allow-warnings");
  const positional = argv.filter((argument) => !argument.startsWith("-"));
  const unknown = argv.filter(
    (argument) => argument.startsWith("-") && argument !== "--allow-warnings"
  );
  if (unknown.length > 0 || positional.length > 1) {
    console.error(`Unknown arguments: ${unknown.concat(positional.slice(1)).join(" ")}`);
    process.exitCode = 1;
  } else {
    const folder = resolve(positional[0] ?? "clickalong-tours");
    const { files, errors, warnings } = await validateTours(folder);
    for (const message of errors) console.error(`ERROR   ${message}`);
    for (const message of warnings) console.error(`warning ${message}`);
    console.log(`\n${files.length} draft(s): ${errors.length} error(s), ${warnings.length} warning(s)`);
    if (errors.length > 0 || (warnings.length > 0 && !allowWarnings)) process.exitCode = 1;
  }
}
