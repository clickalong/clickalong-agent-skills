import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanDocSafety } from "../skills/write-clickalong-docs/scripts/scan-doc-safety.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "clickalong-doc-safety-"));
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
  return root;
}

// Credential fixtures are assembled at runtime so this file never contains a
// literal secret-shaped string: GitHub push protection (and any customer's
// own scanner) would rightly block it — the very leak class the scanner
// under test exists to catch.
const fake = (...parts) => parts.join("");
const STRIPE_KEY = fake("sk_live", "_", "abcDEF123abcDEF123abcDEF");
const SHOPIFY_TOKEN = fake("shpat", "_", "0123456789abcdef0123456789abcdef");
const AWS_KEY_ID = fake("AKIA", "IOSFODNN7EXAMPLE");
const GITHUB_TOKEN = fake("ghp", "_", "abcDEF123abcDEF123abcDEF123abcDEF12");
const JWT = fake("eyJ", "hbGciOiJIUzI1NiJ9.", "eyJ", "zdWIiOiIxMjM0In0.", "abcDEF123-_abcDEF123");
const PEM_HEADER = fake("-----BEGIN RSA ", "PRIVATE KEY-----");
const MONGO_URL = fake("mongodb+srv://", "appuser", ":", "hunter22", "@cluster0.example.mongodb.net/db");

test("passes a clean, well-formed help document", async (t) => {
  const root = await fixture({
    "getting-started/change-language.md": `---
title: Change the output language
description: Pick the language your generated content is written in.
public: true
---
Generated content follows the language you pick in settings.

# Steps
1. Open **Settings → Language**.
2. Choose a language from the **Output language** dropdown.
3. Click **Save** — the status changes to **Active**.

::: tip
You can override the language per item from the item editor.
:::

# Related
Connect your store

Questions? Write to you@example.com or visit [our site](https://example.com).
`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  assert.equal(result.files, 1);
  assert.deepEqual(result.findings, []);
});

test("flags credential shapes as errors and redacts them from the report", async (t) => {
  const root = await fixture({
    "leaky.md": [
      `Use ${STRIPE_KEY} to authenticate.`,
      `Shopify token: ${SHOPIFY_TOKEN}`,
      `AWS: ${AWS_KEY_ID}`,
      `JWT: ${JWT}`,
      PEM_HEADER,
    ].join("\n"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  const types = result.errors.map((finding) => finding.type);
  assert.ok(types.includes("stripe-key"));
  assert.ok(types.includes("shopify-token"));
  assert.ok(types.includes("aws-access-key-id"));
  assert.ok(types.includes("jwt"));
  assert.ok(types.includes("private-key-block"));

  const stripeFinding = result.errors.find((finding) => finding.type === "stripe-key");
  assert.ok(!stripeFinding.preview.includes(STRIPE_KEY));
  assert.ok(stripeFinding.preview.endsWith("redacted)"));
});

test("flags URLs with embedded credentials", async (t) => {
  const root = await fixture({
    "db.md": `Connect with ${MONGO_URL}`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  assert.ok(result.errors.some((finding) => finding.type === "url-credentials"));
});

test("flags secret-named assignments but ignores placeholder values", async (t) => {
  const root = await fixture({
    "config.md": [
      "MY_CLIENT_SECRET=supersecretvalue123",
      '"apiKey": "abcd1234efgh5678"',
      "CLICKALONG_API_KEY=<your-api-key>",
      "OTHER_API_KEY=your-key-here",
      "WEBHOOK_TOKEN_URL=https://example.com/hooks",
    ].join("\n"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  const assignments = result.errors.filter(
    (finding) => finding.type === "secret-assignment",
  );
  assert.equal(assignments.length, 2);
  assert.deepEqual(
    assignments.map((finding) => finding.line),
    [1, 2],
  );
});

test("warns on internal endpoints, local paths, admin URLs, and foreign emails", async (t) => {
  const root = await fixture({
    "internal.md": [
      "Visit http://localhost:3000/settings to preview.",
      "The file lives at /Users/jane/projects/app/README.md",
      "Admins go to https://app.example.com/admin/users",
      "Contact support@acme-widgets.com for help.",
    ].join("\n"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  assert.equal(result.errors.length, 0);
  const types = result.warnings.map((finding) => finding.type);
  assert.ok(types.includes("internal-endpoint"));
  assert.ok(types.includes("filesystem-path"));
  assert.ok(types.includes("suspicious-url-path"));
  assert.ok(types.includes("email-address"));
});

test("--allow-domain clears the product's own email addresses", async (t) => {
  const root = await fixture({
    "contact.md": "Write to support@acme-widgets.com or billing@mail.acme-widgets.com.",
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const flagged = await scanDocSafety(root);
  assert.equal(
    flagged.warnings.filter((finding) => finding.type === "email-address").length,
    2,
  );

  const allowed = await scanDocSafety(root, { allowDomains: ["acme-widgets.com"] });
  assert.equal(
    allowed.warnings.filter((finding) => finding.type === "email-address").length,
    0,
  );
});

test("warns on high-entropy machine-generated strings without double-reporting known tokens", async (t) => {
  const root = await fixture({
    "entropy.md": [
      "Paste aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7d into the field.",
      `Token: ${GITHUB_TOKEN}`,
    ].join("\n"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  const entropyFindings = result.warnings.filter(
    (finding) => finding.type === "high-entropy-string",
  );
  assert.equal(entropyFindings.length, 1);
  assert.equal(entropyFindings[0].line, 1);
  assert.ok(result.errors.some((finding) => finding.type === "github-token"));
});

test("scans only text formats and reports scanned file count", async (t) => {
  const root = await fixture({
    "guide.md": "A clean guide body.",
    "notes.txt": "Clean notes.",
    "image.png": STRIPE_KEY,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await scanDocSafety(root);
  assert.equal(result.files, 2);
  assert.deepEqual(result.findings, []);
});
