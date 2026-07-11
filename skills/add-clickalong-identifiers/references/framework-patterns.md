# Framework patterns and edge cases

Read only the sections relevant to the target codebase.

## React, Next.js, Remix, and React Router

- Put `id` directly on a native element whenever possible.
- Verify that custom components spread or explicitly forward `id` to the intended native node.
- With Radix or shadcn `asChild`, verify the compiled DOM. Attribute forwarding is expected but the child still determines the target.
- Never use `useId()` as a tour identifier. Its purpose is hydration-safe relationships, not a permanent external selector.
- If an explicit stable ID replaces a generated accessibility ID, update `htmlFor`, `aria-controls`, `aria-labelledby`, and related tests together.
- For a reusable component, pass the Clickalong ID from the unique call site:

```tsx
<Button id="clickalong-billing-open-portal" onClick={openPortal}>
  Manage billing
</Button>
```

## Vue

- Native elements accept `id` directly.
- Attribute fallthrough works for a suitable single-root component, but multi-root components and `inheritAttrs: false` require explicit forwarding.
- Inspect the rendered element rather than assuming `$attrs` lands on the button.

```vue
<AppButton id="clickalong-team-invite-member" @click="invite">
  Invite member
</AppButton>
```

## Svelte and SvelteKit

- Put `id` on the native target or expose an explicit component prop.
- If a component uses rest props, verify that the props are spread onto the correct element.
- Do not compute the identifier from route data or each-block indexes.

```svelte
<button id="clickalong-settings-save-profile" on:click={save}>
  Save
</button>
```

## Angular

- Put the ID in the component template on the real native control.
- An ID on a custom component host does not help when Clickalong records an inner button.
- Avoid binding the tour ID to mutable component data.

```html
<button id="clickalong-reports-export-csv" (click)="exportCsv()">
  Export CSV
</button>
```

## Astro, server templates, and plain HTML

- Emit the ID as a literal in production markup.
- Do not interpolate tenant, locale, record, or build values into the ID.
- For partials rendered multiple times, pass an optional ID only at the singleton usage site.

## Component libraries

Trace the prop to rendered DOM. Common failure modes are:

- the component drops unknown props;
- the ID lands on a layout wrapper while the inner button receives clicks;
- a trigger and its popup reuse the same prop;
- an `asChild` composition changes which element owns the attribute;
- the library already generates an ID that the recorder will prefer.

Use the browser's rendered DOM or an existing component test to prove the final location.

## Portals, responsive variants, and repeated UI

- Same-document portals are queryable. Verify the portal target appears within the step's timing window.
- Hidden responsive copies still count as duplicate IDs. Conditional rendering is safer than two simultaneous elements sharing one selector.
- A single literal ID inside a reusable component can create runtime duplicates even when a static search finds one source occurrence.
- Avoid targeting virtualized rows, carousels, or transient toast items unless the preceding step deterministically materializes one singleton.

## Shadow DOM and iframes

`document.querySelector` does not cross shadow-root or iframe boundaries.

- For a Web Component, target its light-DOM host only when the host's rectangle and interaction represent the intended control.
- Do not put the identifier inside a closed or open shadow root and claim it is reachable.
- For an iframe, run Clickalong in that frame or redesign the step around an element in the current document.

## Selector behavior to remember

- The recorder prefers unique IDs before supported test attributes.
- Runtime resolution takes the first `document.querySelector` match.
- Hidden elements are not excluded automatically.
- A target must appear within roughly three seconds.
- SPA node replacement is tolerable when the replacement preserves the same selector.
- IDs do not preserve an active tour across a full document reload.
