import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateTours } from "../skills/generate-clickalong-tours/scripts/validate-tours.mjs";
import {
  makeRedactor,
  parseArgs,
  planBundle,
  resolveApiBase,
} from "../skills/generate-clickalong-tours/scripts/push-tours.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "clickalong-tours-"));
  for (const [name, draft] of Object.entries(files)) {
    await writeFile(
      join(root, name),
      typeof draft === "string" ? draft : JSON.stringify(draft, null, 2),
      "utf8"
    );
  }
  return root;
}

// Assembled at runtime so this file never contains a literal secret-shaped
// string (GitHub push protection precedent from scan-doc-safety.test.mjs).
const fake = (...parts) => parts.join("");
const STRIPE_KEY = fake("sk_live", "_", "abcDEF123abcDEF123abcDEF");
const AGENT_TOKEN = fake("cka", "_", "ab12".repeat(16));
const OPENAI_PROJECT_KEY = fake("sk-proj-", "abcDEF123abcDEF123");
const GITHUB_PAT = fake("github_pat", "_", "abcDEF123abcDEF123");

const goodTour = {
  name: "Export products",
  description: "Choose which products to export and download them as CSV.",
  start: { kind: "same-origin", pathname: "/products" },
  steps: [
    {
      selector: '[data-testid="clickalong-products-export"]',
      title: "Open the Export panel",
      description: "Click **Export** in the top bar.",
      advanceOn: "manual",
      route: "/products",
      fallbackLocators: [{ kind: "role", role: "button", name: "Export" }],
    },
  ],
};

test("passes a clean draft bundle, including the push envelope", async (t) => {
  const root = await fixture({
    "export-products.json": { id: crypto.randomUUID(), version: 3, ...goodTour },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { errors, warnings } = await validateTours(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("secret-shaped values fail in every outbound field, and findings never quote them", async (t) => {
  const root = await fixture({
    "bad.json": {
      name: "Billing",
      description: `Use ${STRIPE_KEY} to authenticate.`,
      start: { kind: "same-origin", pathname: "/billing" },
      audience: { attributes: { note: OPENAI_PROJECT_KEY } },
      steps: [
        {
          selector: `#${AGENT_TOKEN}`,
          title: "Open the order",
          annotation: GITHUB_PAT,
          advanceOn: "manual",
          fallbackLocators: [{ kind: "text", tag: "button", text: STRIPE_KEY.slice(0, 40) }],
        },
      ],
    },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { errors, warnings } = await validateTours(root);
  const everything = JSON.stringify({ errors, warnings });
  assert.ok(errors.filter((error) => error.includes("secret-shaped")).length >= 3);
  for (const leak of [STRIPE_KEY, AGENT_TOKEN, AGENT_TOKEN.slice(4), OPENAI_PROJECT_KEY, GITHUB_PAT]) {
    assert.ok(!everything.includes(leak), "findings must never contain the secret");
  }
});

test("record-shaped paths and selectors fail; normalization escapes are caught", async (t) => {
  const root = await fixture({
    "paths.json": {
      name: "Paths",
      start: { kind: "shopify-app", pathname: "/app/review/6a6a1364aa11" },
      steps: [{ selector: "#order-1234567890", title: "Open", advanceOn: "manual" }],
    },
    "escape.json": {
      name: "Escape",
      start: { kind: "same-origin", pathname: "/a/../admin" },
      steps: [{ selector: "#ok", title: "Open", advanceOn: "manual" }],
    },
    "backslash.json": {
      name: "Backslash",
      start: { kind: "same-origin", pathname: "/\\evil.example/x" },
      steps: [{ selector: "#ok2", title: "Open", advanceOn: "manual" }],
    },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { errors } = await validateTours(root);
  assert.ok(errors.some((error) => error.includes("store-portable")));
  assert.ok(errors.some((error) => error.includes("account/record-shaped value")));
  assert.ok(errors.some((error) => error.includes("normalization") || error.includes("backslashes")));
});

test("shape violations are findings, never exceptions", async (t) => {
  const root = await fixture({
    "null.json": "null",
    "shape.json": {
      name: "",
      bogus: true,
      audience: "all",
      steps: Array.from({ length: 26 }, (_, index) => ({
        selector: `#step-${index}`,
        title: `Step ${index}`,
      })),
    },
    "locators.json": {
      name: "Locators",
      steps: [
        {
          selector: "#a",
          title: "One",
          advanceOn: "manual",
          fallbackLocators: [{ kind: "role" }, { kind: "nope" }, { locator: "object" }],
        },
      ],
    },
    "screenshot.json": {
      name: "Screenshot smuggling",
      steps: [
        {
          selector: "#b",
          title: "One",
          advanceOn: "manual",
          screenshot: { key: "not-yours", width: 1, height: 1 },
        },
      ],
    },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { errors } = await validateTours(root);
  assert.ok(errors.some((error) => error.startsWith("null.json: must be a JSON object")));
  assert.ok(errors.some((error) => error.includes('unknown field "bogus"')));
  assert.ok(errors.some((error) => error.includes("audience must be an object")));
  assert.ok(errors.some((error) => error.includes("1–25 steps")));
  assert.ok(errors.some((error) => error.includes("needs a valid role")));
  assert.ok(errors.some((error) => error.includes("kind must be css, role, or text")));
  assert.ok(errors.some((error) => error.includes("server-owned")));
});

test("missing advanceOn is an error; routes without a start are errors; nth/duplicates warn", async (t) => {
  const root = await fixture({
    "warny.json": {
      name: "Warny",
      steps: [
        { selector: "#a", title: "One", advanceOn: "manual" },
        { selector: "#a", title: "Two", advanceOn: "manual" },
        { selector: "div:nth-last-child(3) > button", title: "Three" },
        { selector: "#c", title: "Four", advanceOn: "manual", route: "/somewhere" },
      ],
    },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { errors, warnings } = await validateTours(root);
  assert.ok(errors.some((error) => error.includes("advanceOn is required")));
  assert.ok(errors.some((error) => error.includes("route requires the tour to declare a start")));
  assert.ok(warnings.some((warning) => warning.includes("repeats an earlier step's selector")));
  assert.ok(warnings.some((warning) => warning.includes(":nth-*")));
});

test("BEM classes pass while framework-generated classes warn", async (t) => {
  const root = await fixture({
    "classes.json": {
      name: "Classes",
      steps: [
        { selector: ".toolbar__button", title: "BEM ok", advanceOn: "manual" },
        { selector: ".css-1q2w3e", title: "Generated", advanceOn: "manual" },
      ],
    },
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { warnings } = await validateTours(root);
  const generated = warnings.filter((warning) => warning.includes("build-generated"));
  assert.equal(generated.length, 1);
  assert.ok(generated[0].includes("steps[1]"));
});

test("symlinked drafts are refused", async (t) => {
  const root = await fixture({ "real.json": goodTour });
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(join(root, "real.json"), join(root, "link.json"));
  const { errors } = await validateTours(root);
  assert.ok(errors.some((error) => error.startsWith("link.json: not a regular file")));
});

test("duplicate tour names across files are an error", async (t) => {
  const root = await fixture({ "a.json": goodTour, "b.json": { ...goodTour } });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { errors } = await validateTours(root);
  assert.ok(errors.some((error) => error.includes("duplicate tour name")));
});

// --- push-tours pure helpers -----------------------------------------------

test("redactor strips the token, its reconstructable tail, and token shapes", () => {
  const redact = makeRedactor(AGENT_TOKEN);
  const noisy = `err ${AGENT_TOKEN} tail ${AGENT_TOKEN.slice(4)} other ${fake("cka_", "deadbeef")}`;
  const clean = redact(noisy);
  assert.ok(!clean.includes(AGENT_TOKEN));
  assert.ok(!clean.includes(AGENT_TOKEN.slice(4)));
  assert.ok(!clean.includes("deadbeef"));
});

test("API base is allowlisted: overrides need the flag, https, and origin-only form", () => {
  assert.equal(resolveApiBase(undefined, false).base, "https://clickalong.ai");
  assert.ok(resolveApiBase("https://attacker.example", false).error);
  assert.ok(resolveApiBase("http://staging.clickalong.ai", true).error);
  assert.ok(resolveApiBase("https://user:pw@staging.clickalong.ai", true).error);
  assert.ok(resolveApiBase("https://staging.clickalong.ai/path", true).error);
  assert.equal(resolveApiBase("https://staging.clickalong.ai", true).base, "https://staging.clickalong.ai");
});

test("argv parsing rejects unknown flags and enforces the apply/expect-workspace pairing", () => {
  assert.ok(parseArgs(["--dry-rnu"]).error);
  assert.ok(parseArgs(["--apply"]).error);
  assert.ok(parseArgs(["--delete", "not-a-uuid", "--apply"]).error);
  const ok = parseArgs(["clickalong-tours", "--apply", "--expect-workspace", crypto.randomUUID()]);
  assert.equal(ok.error, undefined);
  assert.equal(ok.args.apply, true);
});

test("bundle preflight hard-fails foreign, recorder, duplicate, and name-colliding drafts", () => {
  const agentId = crypto.randomUUID();
  const recorderId = crypto.randomUUID();
  const inventory = [
    { id: agentId, name: "Mine", source: "agent" },
    { id: recorderId, name: "Recorded", source: "recorder" },
  ];
  const { plan, errors } = planBundle(
    [
      { file: "ok.json", body: { id: agentId, name: "Mine" } },
      { file: "foreign.json", body: { id: crypto.randomUUID(), name: "Foreign" } },
      { file: "recorded.json", body: { id: recorderId, name: "Recorded" } },
      { file: "dupe.json", body: { id: agentId, name: "Mine again" } },
      { file: "collide.json", body: { name: "Recorded" } },
      { file: "fresh.json", body: { name: "Brand new" } },
      { file: "traversal.json", body: { id: "../documents", name: "Sneaky" } },
    ],
    inventory
  );
  assert.deepEqual(
    plan.map((entry) => `${entry.file}:${entry.mode}`),
    ["ok.json:update", "fresh.json:create"]
  );
  assert.equal(errors.length, 5);
  assert.ok(errors.some((error) => error.includes("not in this workspace")));
  assert.ok(errors.some((error) => error.includes("recorder-owned")));
  assert.ok(errors.some((error) => error.includes("already used by")));
  assert.ok(errors.some((error) => error.includes("already exists remotely")));
  assert.ok(errors.some((error) => error.includes("not a UUID")));
});
