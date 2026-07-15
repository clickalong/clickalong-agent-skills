---
name: add-clickalong-identifiers
description: Add, audit, and verify production-stable data-testid contracts for Clickalong guided-tour targets. Use when instrumenting a web app for Clickalong tours, replacing fragile CSS/nth-of-type/generated-ID selectors, fixing account-specific Shopify GID or record selectors, hardening a walkthrough across tenants and redesigns, or reviewing tour targets in React, Vue, Svelte, Angular, Astro, or plain HTML.
---

# Add Clickalong Identifiers

Make every known tour target resolve to one deliberate production DOM element without coupling the tour to copy, layout, generated IDs, or customer records.

## Use the data-testid contract

Author a normal, production-preserved `data-testid` on the real target:

```html
<button data-testid="clickalong-settings-invite-member">Invite member</button>
```

Clickalong stores this internally as:

```css
[data-testid="clickalong-settings-invite-member"]
```

Follow these rules:

- Reuse an existing `data-testid` only when it already follows this Clickalong contract, is a source literal, is unique in the rendered document, and ships in production.
- Otherwise add `data-testid="clickalong-<surface>-<object>-<action>"`. Clickalong intentionally rejects non-namespaced test IDs because the recorder cannot prove that a generic test hook is a permanent product contract.
- Use lowercase ASCII kebab-case matching `^clickalong-[a-z0-9]+(?:-[a-z0-9]+)*$`; keep it at most 96 characters.
- Name user intent, not presentation. Prefer `clickalong-billing-open-portal`; reject `blue-button`, `sidebar-item-3`, and `invite-text`.
- Never derive the value from translated copy, an array index, route params, a Shopify GID, a database/customer/store/tenant/user ID, a UUID, a long number, a timestamp, a hash, a token, random data, or a framework-generated ID.
- Put the attribute on the actual interactive DOM node Clickalong should highlight and observe—not an icon, text child, layout wrapper, Fragment, or custom-component host unless that host is deliberately the target.
- Require exactly one match in the whole target document for the state in which the step runs, including hidden responsive copies.
- Instrument known tour targets only. Do not add test IDs indiscriminately.
- Preserve the value through redesigns. Search saved/source-controlled flows before renaming or deleting it.
- Confirm the production build does not strip `data-testid`.

The recorder can prove that the attribute matched exactly one clicked element in the recorded state. It cannot prove from DOM syntax alone that a value was source-literal or identical in another customer account. Source inspection, the static audit, a production build, and cross-account/runtime verification are therefore part of the contract—not optional polish.

Do not author `data-clickalong-id`, raw `id="clickalong-*"`, generated CSS classes, DOM-position selectors, or record-specific test IDs as the tour contract.

## Follow the workflow

### 1. Establish the target inventory

Read the repository instructions. Detect the framework, component library, test conventions, router, and production transform rules.

Find targets from, in priority order:

1. Supplied Clickalong flow/recorder data.
2. Existing selectors in source, fixtures, or configuration.
3. A named journey whose actions can be traced unambiguously.

If no concrete journey exists, ask for it instead of blanket-instrumenting the app.

Track:

| Logical action | Route/state | Actual DOM node | Current target | Prerequisite |
| --- | --- | --- | --- | --- |

Include state created by earlier steps: route, modal, selected tab, role, feature flag, and loaded data.

### 2. Classify fixed UI versus customer data

Instrument fixed application controls: navigation, buttons, tabs, fields, dialogs, and stable singleton regions.

Do not make a customer-data row portable by embedding its identity. For products, collections, orders, users, files, or other repeated records:

- target a stable picker/list/container or page-level action; or
- change the instruction to let the visitor choose their own item.

If the requested step truly means one particular record, report that the tour is account-specific instead of inventing a portable identifier.

### 3. Trace component props to rendered DOM

Follow abstractions to the native node. Confirm custom components forward `data-testid` to the correct element. Read [framework patterns](references/framework-patterns.md) for custom components, portals, repeated UI, shadow DOM, or iframes.

Prefer:

- Click: actual button, link, tab, menu item, label, or click owner.
- Typing/manual: actual input, select, or textarea.
- Explanation: smallest stable singleton region representing the concept.

For a reusable component, accept an optional test ID from the unique usage site. Never hard-code one value inside a component that may render multiple times.

### 4. Implement the smallest scoped change

Add attributes only to the inventory. Preserve semantics, accessibility relationships, handlers, keyboard behavior, styling, and existing tests. Product logic and CSS must not depend on the new test ID.

Search for each proposed value before adding it. If an existing test hook changes, update its tests. If source-controlled flow data is in scope, replace its target with the exact `[data-testid="..."]` selector. For dashboard-only flows, return the mapping needed to re-record; never claim remote data changed when it did not.

### 5. Run the static audit

Resolve `<skill-root>` as this skill directory, then run:

```bash
node <skill-root>/scripts/audit-clickalong-ids.mjs <repository-root>
```

Add `--json` for machine-readable output. Fix invalid values, interpolation, and duplicate literal declarations.

The audit ignores generated output, dependencies, tests, stories, and fixtures. It cannot prove that a reusable component renders once; runtime verification remains mandatory.

### 6. Verify the rendered production contract

Use the existing E2E setup or a browser against the closest production-like build. Enter the state created by the previous tour step and evaluate each target. When tenant-specific rendering exists, repeat the journey in at least two accounts with different records; one account cannot establish portability:

```js
const selector = '[data-testid="clickalong-settings-invite-member"]';
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

Require `count: 1`, `connected: true`, and `visible: true`. Verify after the relevant rerender, route transition, menu/modal opening, data load, and supported responsive breakpoint. Click it and confirm the real action still occurs.

Test applicable roles, permissions, feature flags, empty/data-rich states, and localization. A stable attribute cannot repair an impossible prerequisite or a control that never renders.

### 7. Run repository checks

Run focused tests, formatter, typecheck, production build, and relevant E2E checks. Verify built markup retains the attribute. Do not claim success from source inspection alone.

## Handle boundaries explicitly

- Responsive copies: do not render two simultaneous copies with the same test ID. Prefer conditional rendering.
- Repeated/virtualized rows: target a singleton control or change tour intent; never append record IDs or indexes.
- Portals/modals: same-document portals work when the step prerequisite opens them.
- Shadow DOM: Clickalong cannot query inside a shadow root. Target a meaningful host or redesign the step.
- Iframes: the widget and target must be in the same document.
- Full navigation: a stable target does not itself preserve an active tour across a document reload.

Report limitations instead of hiding them with a selector that works in one development state.

## Return a durable handoff

Summarize:

| Action | data-testid | Source | Verified states |
| --- | --- | --- | --- |

Then list checks run and unresolved timing, role, responsive, iframe, shadow-DOM, or virtualized-content constraints.
