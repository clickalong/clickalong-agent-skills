# Framework patterns and edge cases

Read only sections relevant to the target codebase.

## React, Next.js, Remix, and React Router

- Put `data-testid` directly on a native target when possible.
- Confirm custom components spread or explicitly forward the attribute to the intended native node.
- With Radix/shadcn `asChild`, inspect the rendered DOM; the child determines where the attribute lands.
- Do not use `useId()` or route/record data for the value.
- Pass the value from a unique call site when a component is reusable:

```tsx
<Button data-testid="clickalong-billing-open-portal" onClick={openPortal}>
  Manage billing
</Button>
```

## Vue

Attribute fallthrough works only when the component has a suitable root and has not disabled inheritance. Inspect the DOM; explicitly forward `$attrs` or a prop when necessary.

```vue
<AppButton data-testid="clickalong-team-invite-member" @click="invite">
  Invite member
</AppButton>
```

## Svelte and SvelteKit

Put the attribute on the native target or expose an explicit component prop. Verify rest props land on the correct node. Never compute it from an each-block index.

```svelte
<button data-testid="clickalong-settings-save-profile" on:click={save}>
  Save
</button>
```

## Angular

Put the attribute on the actual native control in the template. An attribute on a custom-element host does not identify an inner button.

```html
<button data-testid="clickalong-reports-export-csv" (click)="exportCsv()">
  Export CSV
</button>
```

## Astro, server templates, and plain HTML

Emit a literal attribute in production markup. Do not interpolate tenant, locale, record, route, or build values. For repeated partials, pass the value only at a singleton usage site.

## Component libraries

Prove where the attribute lands. Common failures:

- unknown props are dropped;
- the attribute lands on a layout wrapper rather than the click owner;
- trigger and popup reuse the same prop;
- `asChild` changes the target node;
- one reusable component creates runtime duplicates.

Use rendered DOM or a component test, not assumptions.

## Portals, responsive variants, and repeated UI

- Same-document portals are queryable when present for that step.
- Hidden responsive copies still make the target ambiguous.
- A single literal inside a reusable component can render many times.
- Do not target repeated/virtualized records by appending database IDs or indexes. Target a stable list/picker/toolbar or change the instruction to “choose your item.”

## Shadow DOM and iframes

`document.querySelector` does not cross a shadow root or iframe boundary.

- Target a web-component host only if its rectangle and interaction represent the intended control.
- Run Clickalong in the same iframe document as the target.
- Never claim an unreachable inner node is verified.

## Build and test tooling

Some applications strip `data-testid` in production. Disable stripping for intentional `clickalong-*` values or configure the transform to preserve them. Confirm against built output or a deployed staging page.

Generic test IDs may remain for the app's tests, but Clickalong tour targets use a separate literal `clickalong-*` value. If the same native node already has a non-Clickalong `data-testid`, coordinate the migration with the owning test suite rather than assuming the generic hook is a permanent cross-account contract.
