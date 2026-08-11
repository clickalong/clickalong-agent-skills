# Assist semantics: make the app legible to the AI guide

Clickalong runs two targeting systems with different contracts:

- **Recorded tours** resolve the `data-testid` contract in `SKILL.md`.
- **The AI guide (Live Assistance)** never reads `data-testid`. It builds a semantic
  index of the live page — accessible name, role, and a safety classification per
  control — and plans spotlights, instructions, and (when a workspace opts in)
  reversible clicks against that index.

Every signal below is what the shipped widget actually honors. When the index is
ambiguous or a name is missing, the guide fails closed: no spotlight, a plain-text
step, or a refused target. Ambiguity and placeholder-only names are therefore the
main cause of "the AI didn't highlight it".

## How the guide sees a control

- Candidates: `button`, `a[href]`, `input`, `select`, `textarea`, `label`,
  `summary`, editable regions, any `[role]` element, and
  `[data-clickalong-action='navigation']`.
- Accessible name resolution, in order: `aria-label` → `aria-labelledby` (first
  three ids). For `input`/`select`/`textarea` it then falls to associated
  `<label>` elements → `placeholder`; for everything else to `alt`/`title` →
  the element's own text content. Editable regions are deliberately unnamed
  (their contents are visitor data). Placeholder is the last resort for fields:
  a field whose only name is its placeholder is known to the AI by its example
  text ("Definition Name"), not its visible caption ("Name"), so spotlight
  matching and step wording both degrade.
- Context: each control carries its section's heading (section- and
  document-scoped, not nearest-ancestor) and its landmark region. That context
  grounds "highlight the whole card" scopes and drives safety fencing — a
  control whose name or surrounding context reads as credentials, card data, or
  a destructive/permission action is never targeted at all, while money-adjacent
  context (a "Billing" heading) stays spotlightable for guidance but is fenced
  from automated clicking. The fence keys on a finite vocabulary, not every
  synonym — it is a guardrail, not the authorization model.
- Scan scope: the document the widget runs in (for an embedded app, that is the
  app's own frame), descendant same-origin iframes a few levels deep, and
  **open** shadow roots. Closed shadow roots and cross-origin frames are
  invisible. Recorded tours differ: their stored selectors live in the document
  tree, but a tour can target a shadow HOST and spotlight a unique interactive
  control inside its open shadow root — so shadow-heavy UI usually needs the
  tour targeted at the host element.

## The semantic contract

1. **The visible label leads the accessible name.** Give every interactive
   control a programmatic name that starts with — ideally equals — its
   on-screen caption, via real label association (`<label for>`, a wrapping
   label, or the framework's label prop with its visually-hidden option) or
   `aria-label`. Extending the name for disambiguation is fine
   (`aria-label="Edit shipping address"` on a visible "Edit" button). Never
   ship a field whose only name is its placeholder, and never ship an empty
   label prop (`label=""`) with the visible caption as detached sibling text.
   This matches WCAG 2.5.3 (Label in Name — the visible text must be contained
   in the accessible name), so it is an accessibility fix, not a
   Clickalong-specific hook.
2. **Names are unique per rendered view.** Duplicate names break every
   name-based path: heuristic spotlights, re-acquisition after a re-render, and
   steps planned for pages the visitor has not reached yet all require exactly
   one match and refuse on ambiguity. (Only a spotlight pre-bound to a specific
   element on the current page survives duplicates.) Add context to repeated
   controls (`aria-label="Edit shipping address"`) or scope the step to a
   singleton container.
3. **Opt reversible custom navigation in with
   `data-clickalong-action="navigation"`.** `"navigation"` is the only
   recognized value. It marks a scripted control (a `div`/`button` acting as a
   link, a custom tab) as safe reversible navigation the guide may spotlight and,
   in do-it-for-me mode, click. Use it only for genuinely reversible moves —
   open a panel, switch a tab, go to a page. It is **inert on form fields and
   submit buttons**: inputs, selects, textareas, checkbox/radio roles, and
   submit buttons are classified before the attribute is consulted and are
   never navigation targets — and a `<button>` **without a `type` attribute is
   a submit button by HTML default**, so a button-tag opt-in requires an
   explicit `type="button"`. Natively recognized without the attribute:
   same-origin `http(s)` links with a real `href` (no `download`, no
   `target` other than `_self`), `role="tab"`, `<summary>`, and
   `aria-expanded` toggles with a button/menuitem/link role. An `<a>` without
   `href` is not a link.
4. **Opt sensitive regions out with `data-clickalong-private` or
   `data-clickalong-no-automate`.** Either attribute excludes the whole subtree:
   its text is never read into names or context, and nothing inside is ever
   targeted. `aria-hidden="true"`, `hidden`, and `inert` subtrees are excluded
   the same way — so keep hidden responsive or navigation mirrors genuinely
   marked hidden, or they create duplicate names that break rule 2.
5. **Declare credential fields with truthful `autocomplete` tokens.**
   `password`, `file`, and `hidden` inputs are never spotlighted. Beyond that,
   the fence keys on autocomplete: `cc-*`, `one-time-code`, `current-password`,
   and `new-password` are hard-blocked even on `type="text"` lookalikes. Correct
   tokens make the safety fence deterministic (and improve browser autofill);
   their absence leaves it to context heuristics.
6. **Disabled means untargetable, by design.** A control with `disabled` or
   `aria-disabled="true"` is still seen (its disabled state is reported to the
   planner) but is neither clickable nor spotlightable until it enables. Do not
   fake enablement to help the AI — keep the control's name stable so the
   spotlight lands the moment it becomes real.
7. **Use real landmarks and headings.** `<form aria-label>`,
   `<section aria-label>`, and accurate headings are what let the guide ring an
   enclosing card and reason about where a control lives.

## Verify the rendered names

Static checks cannot compute accessible names. In the rendered app, for each
control a guide step should target, approximate the widget's resolution order
and require the name to start with the visible caption and be unique:

```js
const nameOf = (el) => {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const refs = el.getAttribute("aria-labelledby")?.trim().split(/\s+/).slice(0, 3) ?? [];
  const byRef = refs
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  if (byRef) return byRef;
  if (el.matches("input,select,textarea")) {
    const labels = [...(el.labels ?? [])]
      .map((label) => label.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    return labels || el.getAttribute("placeholder") || "";
  }
  const alt = el.getAttribute("alt") || el.getAttribute("title");
  return (alt || el.textContent || "").trim().replace(/\s+/g, " ");
};
const el = document.querySelector("<the control>");
const expected = nameOf(el);
({
  name: expected,
  duplicates: [
    ...document.querySelectorAll("button,a[href],input,select,textarea,summary,[role]"),
  ].filter((candidate) => nameOf(candidate) === expected).length,
});
```

This is an approximation, not the widget: the real index also scrubs
record-like values, caps text length, skips hidden and private subtrees, spans
same-origin frames and open shadow roots, and deliberately leaves editable
regions unnamed. Treat its output as guidance; require the visible caption to
lead `name` and `duplicates: 1`, and re-check in the states earlier steps
create (modals open, tabs selected, data loaded).

## What this contract cannot do

- A control disabled at planning time cannot receive an exact pre-bound
  spotlight; the AI recovers by name at step time, which is why rule 1 matters.
- Steps on pages the visitor has not reached yet are always name-matched, never
  pre-bound.
- Clean semantics make the page deterministic for the AI; they do not remove
  model variance in wording. Report residual flakiness instead of adding
  Clickalong-specific hacks to product markup.

## Framework notes

- **Shopify Polaris**: `label="Name" labelHidden` — never `label=""` with the
  caption as sibling text.
- **Radix/shadcn**: `<Label htmlFor>` pairs, or `aria-label` on icon-only
  triggers.
- **MUI/Chakra/Mantine**: the `label` prop renders a real association; keep it
  populated even when visually hidden.
- **Plain templates (Vue/Svelte/Rails/Liquid)**: `<label for>` with matching
  `id`, or `aria-label` on the control itself.
