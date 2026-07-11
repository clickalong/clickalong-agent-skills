import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditClickalongIds } from "../skills/add-clickalong-identifiers/scripts/audit-clickalong-ids.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "clickalong-id-audit-"));
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
  return root;
}

test("accepts unique literal IDs in common template forms", async (t) => {
  const root = await fixture({
    "src/Settings.tsx": `
      <button id="clickalong-settings-invite-member">Invite</button>
      <Button id={'clickalong-settings-save-profile'}>Save</Button>
      <button id={\`clickalong-billing-open-portal\`}>Billing</button>
    `,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongIds(root);
  assert.deepEqual(
    result.occurrences.map((item) => item.id),
    [
      "clickalong-billing-open-portal",
      "clickalong-settings-invite-member",
      "clickalong-settings-save-profile",
    ]
  );
  assert.equal(result.errors.length, 0);
});

test("rejects duplicates and invalid names", async (t) => {
  const root = await fixture({
    "src/Desktop.tsx": `<button id="clickalong-team-invite">Invite</button>`,
    "src/Mobile.tsx": `<button id="clickalong-team-invite">Invite</button>`,
    "src/Profile.vue": `<button id="clickalong-Profile_Save">Save</button>`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongIds(root);
  assert.equal(result.errors.filter((item) => item.type === "duplicate").length, 1);
  assert.equal(result.errors.filter((item) => item.type === "invalid").length, 1);
});

test("rejects interpolated and concatenated IDs", async (t) => {
  const root = await fixture({
    "src/Rows.tsx": `
      <button id={\`clickalong-row-${"${row.id}"}\`}>Open</button>
      <button id={"clickalong-row-" + index}>Open</button>
    `,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongIds(root);
  assert.equal(result.errors.filter((item) => item.type === "dynamic").length, 2);
});

test("ignores dependencies, tests, stories, and generated output", async (t) => {
  const generatedBundle = `<button id="clickalong-home-start-tour">Start</button>${"x".repeat(
    31_000
  )}`;
  const root = await fixture({
    "src/App.tsx": `<button id="clickalong-home-start-tour">Start</button>`,
    "src/App.test.tsx": `<button id="clickalong-home-start-tour">Start</button>`,
    "src/App.stories.tsx": `<button id="clickalong-home-start-tour">Start</button>`,
    "node_modules/pkg/index.js": `<button id="clickalong-home-start-tour">Start</button>`,
    "dist/app.js": `<button id="clickalong-home-start-tour">Start</button>`,
    "public/widget.js": generatedBundle,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongIds(root);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((item) => item.type === "generated-file").length, 1);
});
