# Tour authoring guide

What separates a tour people finish from one they abandon.

## Shape

- **One tour per job, 3–8 steps.** "Set up auto-replies" is a tour; "Everything about settings" is not. The 25-step cap is a ceiling, not a target.
- **Name the tour like the question it answers** ("Categorize products with AI", not "Category feature tour") — the AI matches visitor questions against the name and description.
- **The description sells the outcome in one or two sentences** and states where the tour starts. It doubles as retrieval content for the AI assistant.

## Starts and routes

- Feature tours start on the feature's stable page: set `start` so the widget takes the visitor there first.
- Pages that exist only per record (a specific order, a job's review page) can't be navigated to generically. Give those tours **no `start`** and write the description so it's clear the visitor opens the page first ("On any job's review page…"). The AI will still offer them; the widget plays them in place.
- Set each step's `route` to the page it lives on. When the visitor wanders off, the widget uses it to say where to go.

## Steps

- **Anchor on the primary control, advance manually.** `advanceOn: "manual"` means the tooltip's Next button advances and the target stays clickable — a disabled button, an already-configured toggle, or a cautious visitor can never wedge the run. Use `"click"` only when clicking the target is exactly what the step asks and the control is never disabled.
- **Titles are imperative and short** ("Name your metafield"); descriptions are 1–2 sentences that quote the real on-screen label in **bold** ("Click **Run extraction** when you're ready"). If the label is dynamic ("Classify 12,770 products"), describe its stable part ("the **Classify** button shows how many products will be processed").
- **Never make a step depend on transient state** (a modal that only opens after another click, a row that needs data). If a control appears only conditionally, either make the preceding step produce it or cut the step and mention it in the neighboring step's description.
- **Order steps down the page and through the flow** the way a first-time user would actually move.
- Money-adjacent steps (plans, top-ups, checkout) are fine to point at and explain — but their copy should always note the user confirms the charge themselves.

## Selectors

- Exactly one match per page-state is a playback requirement, not a style preference: ambiguity fails closed.
- Prefer the host app's deliberate contracts: `[data-testid="clickalong-…"]` (see the `add-clickalong-identifiers` skill) or stable semantic `id`s the app maintains for tours.
- Add 1–2 `fallbackLocators` for the most load-bearing steps (a `role`+`name` fallback survives id refactors), but only when the fallback is also provably unique.
- Per-row/table controls make bad targets — a selector unique today matches nothing (or the wrong row) on another account. Point at the container or the stable page-level control instead, and tell the visitor what to click within it.

## After publishing

- Tours are live immediately and the AI starts offering them within minutes (recipe sync is a cron away).
- The dashboard's Tours page shows per-step miss rates and a suggested→run→completed funnel; the weekly digest flags tours needing repair. Revisit selectors that miss.
- Re-recording an agent tour with the Chrome extension (replace mode) upgrades it with screenshots and recorded fallbacks while keeping its id — worth doing for the highest-traffic tours once the copy has settled.
