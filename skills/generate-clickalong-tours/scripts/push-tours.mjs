#!/usr/bin/env node

/**
 * Push Clickalong tour drafts to the workspace bound to CLICKALONG_AGENT_TOKEN.
 *
 * Safety model:
 * - READ-ONLY BY DEFAULT. Without --apply this validates, plans, and prints —
 *   it never writes to the API or the filesystem.
 * - Writes additionally require --expect-workspace <uuid> matching the
 *   workspace id the token resolves to on a fresh GET, so a swapped or
 *   mistyped token can never publish into the wrong tenant.
 * - Unknown CLI flags are hard errors (a typo like --dry-rnu must never
 *   silently change semantics).
 * - The token is read from the environment, sent only in the Authorization
 *   header to an allowlisted HTTPS origin, and every line this script prints
 *   passes through a redactor that strips the token, its hex tail, and
 *   anything cka_-shaped. The whole run is wrapped so even crashes print
 *   redacted.
 * - Drafts are opened only as contained regular files (no symlinks, no
 *   specials, ≤1 MiB); id/version write-backs go through a same-directory
 *   temp file + atomic rename.
 * - Validation (validate-tours.mjs, same trusted folder as this script) runs
 *   in-process before any write: errors always block; warnings block unless
 *   --allow-warnings.
 * - Upserts are idempotent: a draft without an id gets a locally generated
 *   UUID persisted BEFORE the POST (the server treats the id as an
 *   idempotency key), and updates send expectedVersion from the draft's
 *   last-pushed version so concurrent dashboard edits 409 instead of being
 *   overwritten.
 *
 * Usage:
 *   node <skill-root>/scripts/push-tours.mjs --list
 *   node <skill-root>/scripts/push-tours.mjs [folder]                    # plan only
 *   node <skill-root>/scripts/push-tours.mjs [folder] --apply --expect-workspace <uuid>
 *   node <skill-root>/scripts/push-tours.mjs --delete <uuid> --apply --expect-workspace <uuid>
 *
 * Zero dependencies.
 */

import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateTours } from "./validate-tours.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^cka_[0-9a-f]{64}$/;
const MAX_DRAFT_BYTES = 1024 * 1024;
export const DEFAULT_API_BASE = "https://clickalong.ai";

/** Redact the live token, its reconstructable hex tail, and anything token-shaped. */
export function makeRedactor(token) {
  const tail = token && token.length > 4 ? token.slice(4) : null;
  return (text) => {
    let out = String(text);
    if (token) out = out.split(token).join("cka_[redacted]");
    if (tail) out = out.split(tail).join("[redacted-hex]");
    return out.replaceAll(/cka_[0-9a-f]{4,}/gi, "cka_[redacted]");
  };
}

/**
 * The API origin is allowlisted, never taken from the environment freely: a
 * writable base URL is a bearer-token exfiltration channel. Overrides must be
 * HTTPS, origin-only (no userinfo/path/query/fragment), and explicitly
 * acknowledged with --allow-custom-base.
 */
export function resolveApiBase(envBase, allowCustom) {
  if (!envBase || envBase === DEFAULT_API_BASE) return { base: DEFAULT_API_BASE };
  if (!allowCustom) {
    return {
      error:
        "CLICKALONG_API_BASE is set but custom bases are refused without --allow-custom-base (the base URL receives your token).",
    };
  }
  let url;
  try {
    url = new URL(envBase);
  } catch {
    return { error: "CLICKALONG_API_BASE is not a valid URL." };
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    return {
      error:
        "CLICKALONG_API_BASE must be an https origin with no path, query, credentials, or fragment.",
    };
  }
  return { base: url.origin };
}

/** Strict argv parsing: every unknown token is a hard error. */
export function parseArgs(argv) {
  const args = {
    folder: null,
    list: false,
    apply: false,
    allowWarnings: false,
    allowCustomBase: false,
    expectWorkspace: null,
    deleteId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") args.list = true;
    else if (argument === "--apply") args.apply = true;
    else if (argument === "--allow-warnings") args.allowWarnings = true;
    else if (argument === "--allow-custom-base") args.allowCustomBase = true;
    else if (argument === "--expect-workspace") {
      args.expectWorkspace = argv[++index] ?? "";
      if (!UUID_RE.test(args.expectWorkspace)) {
        return { error: "--expect-workspace requires a workspace UUID (shown by --list)." };
      }
    } else if (argument === "--delete") {
      args.deleteId = argv[++index] ?? "";
      if (!UUID_RE.test(args.deleteId)) {
        return { error: "--delete requires a tour UUID (shown by --list)." };
      }
    } else if (argument.startsWith("-")) {
      return { error: `Unknown flag ${argument}. Refusing to guess what you meant.` };
    } else if (args.folder === null) args.folder = argument;
    else return { error: `Unexpected argument ${argument}.` };
  }
  if (args.apply && !args.expectWorkspace) {
    return {
      error:
        "--apply requires --expect-workspace <uuid>: run --list, confirm the workspace with the operator, then pin its id.",
    };
  }
  if (args.deleteId && !args.apply) {
    return { error: "--delete only runs with --apply --expect-workspace." };
  }
  return { args };
}

/**
 * Preflight the whole bundle against the live inventory before any write.
 * Hard failures: an id the workspace doesn't know, an id owned by a recorder
 * tour, the same id in two files, or an id-less draft whose name collides
 * with an existing remote tour.
 */
export function planBundle(drafts, inventoryTours) {
  const bySource = new Map(inventoryTours.map((tour) => [tour.id, tour.source]));
  const remoteNames = new Map(inventoryTours.map((tour) => [tour.name, tour.id]));
  const seenIds = new Map();
  const plan = [];
  const errors = [];
  for (const draft of drafts) {
    const { file, body } = draft;
    const id = typeof body.id === "string" ? body.id : null;
    if (id !== null && !UUID_RE.test(id)) {
      errors.push(`${file}: id is not a UUID — refusing to build a URL from it.`);
      continue;
    }
    if (id) {
      const previous = seenIds.get(id);
      if (previous) {
        errors.push(`${file}: id already used by ${previous} — two drafts, one tour.`);
        continue;
      }
      seenIds.set(id, file);
      if (!bySource.has(id)) {
        errors.push(
          `${file}: id is not in this workspace. A draft copied from another workspace must have its id and version fields removed first.`
        );
        continue;
      }
      if (bySource.get(id) !== "agent") {
        errors.push(
          `${file}: id belongs to a recorder-owned tour, which this API cannot update. Re-record it or edit it in the dashboard.`
        );
        continue;
      }
      plan.push({ file, mode: "update", id });
    } else {
      const collision = remoteNames.get(body.name?.trim?.() ?? "");
      if (collision && bySource.get(collision) !== undefined) {
        errors.push(
          `${file}: a tour named "${body.name}" already exists remotely (id ${collision}). Pull that id into the draft to update it, or rename.`
        );
        continue;
      }
      plan.push({ file, mode: "create" });
    }
  }
  return { plan, errors };
}

/** Contained regular files only; no symlinks, specials, or oversized drafts. */
async function readDraftsSafely(folder) {
  const folderStat = await lstat(folder).catch(() => null);
  if (!folderStat || folderStat.isSymbolicLink() || !folderStat.isDirectory()) {
    return { error: `Draft folder not found or not a plain directory: ${folder}` };
  }
  const drafts = [];
  const problems = [];
  const entries = await readdir(folder, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.endsWith(".json") || entry.name.startsWith("_")) continue;
    const path = join(folder, entry.name);
    if (!entry.isFile()) {
      problems.push(`${entry.name}: not a regular file (symlinks and specials are refused).`);
      continue;
    }
    const fileStat = await lstat(path);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      problems.push(`${entry.name}: not a regular file (symlinks and specials are refused).`);
      continue;
    }
    if (fileStat.size > MAX_DRAFT_BYTES) {
      problems.push(`${entry.name}: larger than ${MAX_DRAFT_BYTES} bytes.`);
      continue;
    }
    try {
      drafts.push({ file: entry.name, path, body: JSON.parse(await readFile(path, "utf8")) });
    } catch {
      problems.push(`${entry.name}: not valid JSON.`);
    }
  }
  return { drafts, problems };
}

/** Same-directory temp file + atomic rename; never follows a swapped symlink. */
async function persistDraft(path, body) {
  const temp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  await writeFile(temp, JSON.stringify(body, null, 2) + "\n", { flag: "wx" });
  await rename(temp, path);
}

async function main() {
  const TOKEN = process.env.CLICKALONG_AGENT_TOKEN ?? "";
  const redact = makeRedactor(TOKEN);
  const say = (text) => console.log(redact(text));
  const sayError = (text) => console.error(redact(text));
  const bail = (text) => {
    sayError(text);
    process.exitCode = 1;
  };

  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) return bail(parsed.error);
  const args = parsed.args;

  if (!TOKEN) {
    return bail(
      "CLICKALONG_AGENT_TOKEN is not set. Generate a token in Clickalong → Settings → Coding agent API token and pass it to THIS command only — do not export it into the general shell or write it into the repository."
    );
  }
  if (!TOKEN_RE.test(TOKEN)) {
    return bail("CLICKALONG_AGENT_TOKEN does not look like a cka_… agent token. Regenerate it in Settings.");
  }
  const baseResolved = resolveApiBase(process.env.CLICKALONG_API_BASE, args.allowCustomBase);
  if (baseResolved.error) return bail(baseResolved.error);
  const BASE = baseResolved.base;

  async function api(method, path, body) {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      redirect: "error",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* non-JSON body */
    }
    return { status: response.status, payload };
  }

  const inventory = await api("GET", "/api/agent/tours");
  if (inventory.status === 401) {
    return bail("The API rejected the token (401). Regenerate it in Clickalong → Settings.");
  }
  if (inventory.status !== 200 || !inventory.payload?.workspace?.id) {
    return bail(`Could not reach the Agent API (${inventory.status}): ${JSON.stringify(inventory.payload)}`);
  }
  const { workspace, tours } = inventory.payload;
  say(`Workspace: ${workspace.name} (id ${workspace.id})`);
  say(`Existing tours: ${tours.length}`);

  if (args.list) {
    for (const tour of tours) {
      say(`- [${tour.source}] ${tour.name} (${tour.steps.length} steps, v${tour.version}) id=${tour.id}`);
    }
    return;
  }

  if (args.apply && workspace.id !== args.expectWorkspace) {
    return bail(
      `REFUSING TO WRITE: the token resolves to workspace ${workspace.id} ("${workspace.name}"), not the pinned --expect-workspace ${args.expectWorkspace}. Confirm the right token and workspace with the operator.`
    );
  }

  if (args.deleteId) {
    const target = tours.find((tour) => tour.id === args.deleteId);
    if (!target) return bail(`No live tour with id ${args.deleteId} in this workspace.`);
    if (target.source !== "agent") {
      return bail(`Tour "${target.name}" is recorder-owned; delete it in the dashboard instead.`);
    }
    const { status, payload } = await api("DELETE", `/api/agent/tours/${args.deleteId}`);
    if (status !== 200) return bail(`Delete failed (${status}): ${payload?.error ?? "unknown error"}`);
    return say(`✓ Deleted "${target.name}" (${args.deleteId}).`);
  }

  const folder = resolve(args.folder ?? "clickalong-tours");
  const read = await readDraftsSafely(folder);
  if (read.error) return bail(read.error);
  for (const problem of read.problems) sayError(`✗ ${problem}`);
  if (read.drafts.length === 0) return bail(`No usable tour drafts (*.json) in ${folder}`);

  // Blocking validation of the exact objects that would be sent.
  const validation = await validateTours(folder);
  for (const message of validation.errors) sayError(`ERROR   ${message}`);
  for (const message of validation.warnings) sayError(`warning ${message}`);
  if (validation.errors.length > 0) return bail("Validation errors block the push.");
  if (validation.warnings.length > 0 && !args.allowWarnings) {
    return bail(
      "Validation warnings block the push until the operator reviews them (re-run with --allow-warnings after explicit approval)."
    );
  }

  const { plan, errors } = planBundle(read.drafts, tours);
  for (const message of errors) sayError(`✗ ${message}`);
  if (errors.length > 0 || read.problems.length > 0) return bail("Preflight failed; nothing was pushed.");

  if (!args.apply) {
    for (const entry of plan) {
      const draft = read.drafts.find((candidate) => candidate.file === entry.file);
      say(`· ${entry.file}: would ${entry.mode} — "${draft.body.name}" (${draft.body.steps?.length ?? 0} steps)`);
    }
    return say(
      "Plan only — nothing was written. Re-run with --apply --expect-workspace " +
        `${workspace.id} after the operator confirms the workspace and the drafts.`
    );
  }

  let failures = 0;
  for (const entry of plan) {
    const draft = read.drafts.find((candidate) => candidate.file === entry.file);
    const { id: _localId, version: localVersion, ...body } = draft.body;
    if (entry.mode === "create") {
      // Persist a locally minted id BEFORE the POST: the server treats it as
      // an idempotency key, so a lost response or crash re-runs safely.
      const mintedId = crypto.randomUUID();
      await persistDraft(draft.path, { id: mintedId, ...body });
      const { status, payload } = await api("POST", "/api/agent/tours", { id: mintedId, ...body });
      const tour = payload?.tour;
      if ((status === 201 || status === 200) && tour && tour.id === mintedId) {
        await persistDraft(draft.path, { id: mintedId, version: tour.version, ...body });
        say(`✓ ${entry.file}: created "${tour.name}" v${tour.version} id=${tour.id}`);
      } else {
        failures += 1;
        sayError(`✗ ${entry.file}: ${status} ${payload?.error ?? "unexpected response"}`);
      }
    } else {
      const update = {
        ...(Number.isInteger(localVersion) && localVersion >= 1
          ? { expectedVersion: localVersion }
          : {}),
        ...body,
      };
      const { status, payload } = await api(
        "PUT",
        `/api/agent/tours/${encodeURIComponent(entry.id)}`,
        update
      );
      const tour = payload?.tour;
      if (status === 200 && tour && tour.id === entry.id) {
        await persistDraft(draft.path, { id: entry.id, version: tour.version, ...body });
        say(`✓ ${entry.file}: updated "${tour.name}" v${tour.version}`);
      } else {
        failures += 1;
        sayError(`✗ ${entry.file}: ${status} ${payload?.error ?? "unexpected response"}`);
      }
    }
  }
  if (failures > 0) return bail(`${failures} tour(s) failed. Nothing above contains your token.`);
  say("Done. Review the tours in Clickalong → Tours.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const redact = makeRedactor(process.env.CLICKALONG_AGENT_TOKEN ?? "");
  try {
    await main();
  } catch (error) {
    console.error(redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
    process.exitCode = 1;
  }
}
