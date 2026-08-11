import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditClickalongSemantics } from "../skills/add-clickalong-identifiers/scripts/audit-clickalong-semantics.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "clickalong-semantics-audit-"));
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
  return root;
}

test("accepts valid navigation opt-ins and labeled fields", async (t) => {
  const root = await fixture({
    "src/Nav.tsx": `
      <div role="button" data-clickalong-action="navigation" aria-label="Open reports">Reports</div>
      <button type="button" data-clickalong-action="navigation">Switch workspace</button>
      <TextField label="Name" labelHidden placeholder="Definition Name" />
      <input type="password" autocomplete="current-password" />
    `,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.warnings.filter((item) => item.type !== "no-identifiers"), []);
});

test("errors on unrecognized data-clickalong-action values", async (t) => {
  const root = await fixture({
    "src/Bad.tsx": `<button data-clickalong-action="click">Save</button>`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].type, "invalid-action-value");
  assert.match(result.errors[0].message, /honors only the value navigation/);
});

test("errors when the navigation opt-in sits on a field or submit button", async (t) => {
  const root = await fixture({
    "src/Field.tsx": `<input type="text" data-clickalong-action="navigation" />`,
    "src/Submit.tsx": `<button type="submit" data-clickalong-action="navigation">Save</button>`,
    "src/Select.vue": `<select data-clickalong-action="navigation"><option>1</option></select>`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.every((item) => item.type === "inert-action-placement"));
});

test("errors on type-less button and toggle-role opt-ins (HTML defaults buttons to submit)", async (t) => {
  const root = await fixture({
    "src/Bare.tsx": `<button data-clickalong-action="navigation">Open reports</button>`,
    "src/Toggle.tsx": `<div role="checkbox" data-clickalong-action="navigation">Sync</div>`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((item) => item.type === "inert-action-placement"));
  const bare = result.errors.find((item) => item.file === "src/Bare.tsx");
  assert.match(bare.message, /defaults to submit/);
});

test("skips dynamic framework bindings instead of judging their expressions", async (t) => {
  const root = await fixture({
    "src/Dynamic.vue": `<button type="button" :data-clickalong-action="mode">Go</button>`,
    "src/Angular.html": `<button type="button" [attr.data-clickalong-action]="mode">Go</button>`,
    "src/Selector.ts": `const hit = document.querySelector("[data-clickalong-action='custom']");`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 0);
});

test("parses JSX tags with arrow-function props past the arrow's angle bracket", async (t) => {
  const root = await fixture({
    "src/Arrow.tsx": `
      <TextField label="" onChange={(value) => setValue(value)} placeholder="Definition Name" />
    `,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  const empties = result.warnings.filter((item) => item.type === "empty-label");
  assert.equal(empties.length, 1);
  // The placeholder AFTER the arrow prop must be seen, so the message names
  // the placeholder fall-through, not the nameless variant.
  assert.match(empties[0].message, /falls through to the placeholder/);
});

test("warns on empty labels without aria-label, silent when aria-label present", async (t) => {
  const root = await fixture({
    "src/Placeholder.tsx": `<TextField label="" placeholder="Definition Name" />`,
    "src/Nameless.tsx": `<TextField label="" />`,
    "src/Covered.tsx": `<TextField label="" aria-label="Name" placeholder="Definition Name" />`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 0);
  const empties = result.warnings.filter((item) => item.type === "empty-label");
  assert.equal(empties.length, 2);
  const byFile = Object.fromEntries(empties.map((item) => [item.file, item.message]));
  assert.match(byFile["src/Placeholder.tsx"], /falls through to the placeholder/);
  assert.match(byFile["src/Nameless.tsx"], /cannot target it by name at all/);
});

test("warns on password inputs without autocomplete", async (t) => {
  const root = await fixture({
    "src/Login.tsx": `<input type="password" name="pw" />`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 0);
  const passwords = result.warnings.filter((item) => item.type === "password-without-autocomplete");
  assert.equal(passwords.length, 1);
  assert.match(passwords[0].message, /current-password or new-password/);
});

test("ignores comment-only lines and unbounded markup", async (t) => {
  const root = await fixture({
    "src/Commented.tsx": `
      // <input type="password" />
      <!-- <TextField label="" placeholder="x" /> -->
      /* <input type="password" name="old" /> */
      {/* <TextField label="" /> */}
    `,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await auditClickalongSemantics(root);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});
