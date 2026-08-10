import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditDocSteps } from "../skills/write-clickalong-docs/scripts/audit-doc-steps.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "clickalong-doc-steps-"));
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
  return root;
}

test("passes a how-to with atomic, labeled, bounded steps", async (t) => {
  const root = await fixture({
    "features/change-language.md": `---
title: Change the output language
type: how-to
---
Generated content follows the language you pick in settings.

# Steps
1. Open **Settings → Language**.
2. Choose a language from the **Output language** dropdown.
3. Click **Save** — the status changes to **Active**.

# Related
Connect your store
`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditDocSteps(root);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.documents, [
    { file: "features/change-language.md", type: "how-to", lists: 1, steps: 3 },
  ]);
});

test("requires ordered steps for task-shaped documents but not for faq or feature-guide", async (t) => {
  const root = await fixture({
    "stepless-default.md": `---
title: Export your data
---
You can export from the dashboard whenever you like.
`,
    "billing-faq.md": `---
title: Billing questions
type: faq
---
# How do I change my plan?
Open **Settings → Billing** and pick a plan.
`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditDocSteps(root);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].type, "missing-steps");
  assert.equal(result.errors[0].file, "stepless-default.md");
});

test("warns on compound, vague, unlabeled, long, and nested steps", async (t) => {
  const longStep = `Click **Save** ${"and wait for the page ".repeat(12)}`;
  const root = await fixture({
    "messy.md": `---
title: Messy guide
---
Intro.

1. Open **Settings**, then click **Language**.
2. Make sure your store is connected.
3. Click the save button.
4. ${longStep}
  1. A nested sub-step.
`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditDocSteps(root);
  assert.equal(result.errors.length, 0);
  const byType = Object.fromEntries(
    result.findings.map((finding) => [finding.type, finding.line]),
  );
  assert.equal(byType["compound-step"], 6);
  assert.equal(byType["vague-step"], 7);
  assert.equal(byType["unlabeled-action"], 8);
  assert.equal(byType["long-step"], 9);
  assert.equal(byType["nested-steps"], 10);
});

test("warns when one list exceeds the 25-step tour cap", async (t) => {
  const steps = Array.from({ length: 26 }, (_, i) => `${i + 1}. Click **Next**.`).join("\n");
  const root = await fixture({ "marathon.md": `---\ntitle: Marathon\n---\nGo.\n\n${steps}\n` });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditDocSteps(root);
  assert.ok(result.warnings.some((finding) => finding.type === "too-many-steps"));
});

test("ignores numbered lines inside fenced code blocks and underscore files", async (t) => {
  const root = await fixture({
    "_review-notes.md": "1. not a step doc",
    "cli.md": `---
title: Use the command line
type: feature-guide
---
Run the tool from your terminal.

\`\`\`
1. this is program output, not a step
\`\`\`
`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditDocSteps(root);
  assert.equal(result.files, 1);
  assert.deepEqual(result.findings, []);
  assert.equal(result.documents[0].steps, 0);
});

test("flags an unknown document type", async (t) => {
  const root = await fixture({
    "odd.md": `---
title: Odd
type: walkthrough
---
1. Click **Start**.
`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditDocSteps(root);
  assert.ok(result.warnings.some((finding) => finding.type === "unknown-type"));
});
