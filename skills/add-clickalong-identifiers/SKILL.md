---
name: add-clickalong-identifiers
description: Add, audit, and validate production-stable HTML identifiers for Clickalong guided-tour targets. Use when instrumenting a web app for Clickalong tours, replacing fragile recorder selectors such as nth-of-type paths, hardening an onboarding or product walkthrough, reviewing tour-target IDs, or adding reliable DOM hooks in React, Vue, Svelte, Angular, Astro, or plain HTML.
---

# Add Clickalong Identifiers

Make every known tour target resolve to one production-stable DOM element without coupling the tour to copy, layout, generated values, or component internals.

## Use the compatible selector contract

Treat tour selectors as a public API. Clickalong's current and cached recorders prefer a unique HTML `id`, and the runtime resolves steps with `document.querySelector`. Use a stable ID as the v1 contract:

```html
<button id="clickalong-settings-invite-member">Invite member</button>
```

```css
#clickalong-settings-invite-member
```

Follow these rules:

- Reuse an existing ID only when it is semantic, immutable, globally unique, and present in production.
- Otherwise add `id="clickalong-<surface>-<object>-<action>"`.
- Use lowercase ASCII kebab-case matching `^clickalong-[a-z0-9]+(?:-[a-z0-9]+)*$` and keep it at most 96 characters.
- Name user intent, not presentation. Prefer `clickalong-billing-open-portal`; reject `blue-button`, `sidebar-item-3`, and `invite-text`.
- Never derive an ID from translated copy, an array index, a database ID, a tenant or user value, a timestamp, a hash, CSS-module output, a random value, or framework-generated IDs such as React `useId()`.
- Put the ID on the actual interactive DOM node Clickalong should highlight and observe. Do not put it on an icon, text child, wrapper, Fragment, or custom component host unless that host is deliberately the target.
- Require exactly one matching element in the whole document, including hidden responsive variants.
- Instrument known tour targets only. Do not add IDs to every control.
- Preserve an ID when moving or restyling the same action. Search saved flow definitions before renaming or deleting it.

Do not invent `data-clickalong` as the sole hook. Current and cached recorders do not prioritize it. A supported `data-testid`, `data-test`, `data-cy`, or `data-qa` is only a fallback when the target has no competing unstable ID and the production build preserves the attribute.

## Follow the workflow

### 1. Establish the target inventory

Read the repository instructions first. Detect the UI framework, router, component library, test conventions, and production build configuration.

Find the target list from, in priority order:

1. Clickalong flow or recorder JSON supplied by the user.
2. Existing selectors in source, fixtures, documentation, or configuration.
3. A named user journey whose actions can be traced unambiguously through the UI.

If no concrete flow or journey exists, ask for it rather than blanket-instrumenting the application.

Track this working inventory before editing:

| Logical action | Route/state | Actual DOM node | Current selector/ID | Prerequisite |
| --- | --- | --- | --- | --- |

Include the state created by the preceding step: open menu, selected tab, role, feature flag, modal, route, or loaded data.

### 2. Trace each action to rendered DOM

Follow component abstractions to the native element. Confirm that custom components forward `id` to that element. A prop added to `<Button>` is useless if `<Button>` drops it or attaches it to the wrong wrapper.

Read [framework patterns](references/framework-patterns.md) when the target uses custom components, portals, repeated UI, shadow DOM, or iframes.

Prefer the node that owns the interaction:

- Click step: `button`, link, tab, menu item, label, or other real click target.
- Typing/manual step: the actual `input`, `select`, or `textarea`.
- Explanatory step: the smallest stable singleton region that visually represents the concept.

### 3. Stabilize existing IDs before adding alternatives

Clickalong's recorder chooses an element's unique ID before supported test attributes. If the target already has a generated or state-dependent ID, adding `data-testid` will not fix future recordings.

Pass an explicit stable ID to the underlying control or replace the generated ID safely. When an ID participates in accessibility or behavior, update and verify every matching reference, including `htmlFor`, `aria-controls`, `aria-labelledby`, fragment links, CSS, tests, and application code.

For reusable components, accept an optional ID from the unique usage site. Do not hard-code one ID inside a component that can render more than once.

### 4. Implement the smallest scoped change

Add or stabilize only the inventory's targets. Preserve existing semantics, event handlers, keyboard behavior, styling, and test hooks. Do not make product logic or CSS depend on a new Clickalong ID.

Search the repository for every proposed ID before adding it. Search for every replaced ID before changing it.

When a supplied flow JSON or source-controlled flow definition is in scope, replace its old selectors with the new `#clickalong-*` selectors. For a flow that exists only in the Clickalong dashboard, return the exact mapping needed to edit or rerecord it; do not claim the remote flow changed unless it was actually updated.

### 5. Run the static audit

Resolve `<skill-root>` as the directory containing this `SKILL.md`, then run:

```bash
node <skill-root>/scripts/audit-clickalong-ids.mjs <repository-root>
```

Add `--json` for machine-readable output. Fix invalid literal IDs, dynamic IDs, and duplicate source declarations.

The audit intentionally ignores generated output, dependencies, tests, stories, and fixtures. It cannot prove that a reusable component renders once; runtime verification remains mandatory.

### 6. Verify runtime behavior

Use the existing E2E setup or a browser against the closest production-like build. For every selector, enter the state created by the prior tour step and evaluate:

```js
const selector = "#clickalong-settings-invite-member";
const matches = [...document.querySelectorAll(selector)];
const target = matches[0];
({
  count: matches.length,
  connected: target?.isConnected ?? false,
  visible:
    matches.length === 1 &&
    target.getClientRects().length > 0 &&
    getComputedStyle(target).visibility !== "hidden",
});
```

Require `count: 1`, `connected: true`, and `visible: true`. Verify again after the relevant rerender, menu/modal opening, route transition, and responsive breakpoint. Click the target and confirm the app's real action still occurs.

Test the roles, permissions, feature flags, and data states in which the tour can run. Clickalong currently waits about three seconds for a step target; identifiers do not repair slow loading or an impossible prerequisite.

### 7. Run repository checks

Run the formatter, focused tests, typecheck, and production build appropriate to the changed files. Check that production tooling does not rewrite or strip IDs. Do not claim success from source inspection alone.

## Handle unsupported or unsafe targets explicitly

- Responsive copies: never give desktop and mobile copies the same ID. Ensure only the intended selector exists for the tour's supported layout.
- Repeated or virtualized rows: prefer a page-level singleton action. Do not encode record IDs or indexes merely to force uniqueness.
- Portals and modals: same-document portals work, but the target must exist when its step begins.
- Shadow DOM: current tours cannot query inside a shadow root. Target the host only if its bounds and click semantics are correct.
- Iframes: a parent-document tour cannot query inside a frame. The Clickalong widget must run in the same document as the target.
- Full document navigation: stable IDs do not preserve an active tour across a page reload.

Do not hide these constraints with a selector that happens to match in one development state. Report the limitation and the smallest product or tour change needed.

## Return a durable handoff

Summarize changes in this form:

| Action | Selector | Source | Verified states |
| --- | --- | --- | --- |

Then list repository checks run and unresolved constraints. Mention any selector that depends on timing, role, responsive layout, iframe, shadow DOM, or virtualized content.
