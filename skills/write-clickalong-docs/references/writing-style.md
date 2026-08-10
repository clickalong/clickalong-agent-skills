# Writing style for Clickalong help documents

Every document is read in three ways: by a user mid-task who wants one answer, by the workspace AI assistant, which retrieves it and quotes its numbered steps in chat, and by the operator following it as the script when recording a guided tour. All three readers reward the same properties — one job per document, exact UI labels, titles phrased the way users ask, and steps that can be executed one at a time.

## Voice

- Write to "you", present tense, imperative steps: "Click **Save**", not "The user should then save".
- Second-person, no marketing. The reader already bought the product; help them finish.
- Exact labels in **bold**, exactly as rendered: "open **Settings → Language**". Never paraphrase a label.
- Keystrokes and typed values in `code`.
- Plain words over product jargon. Introduce a product-specific term once, in parentheses, then use it consistently.
- State the happy path first. Edge cases and failures go in a troubleshooting tail, not inline where they interrupt the task.
- Write in the language agreed in step 1. If the operator wants more languages, produce complete per-language copies of the bundle rather than mixing languages in one document — and note that the Clickalong assistant already answers in the visitor's language from a single-language knowledge base, so extra languages are for human readers of the help center.

## Titles and descriptions

Titles are retrieval keys. Phrase them the way a user would ask:

- How-to: "Change the output language", "Connect your store" — imperative, no "How to" prefix needed unless the operator's existing docs use it; be consistent either way.
- Concept/feature guide: name the feature as the UI names it.
- Troubleshooting: state the symptom: "Generated text doesn't appear on my products".

The `description` frontmatter is the search snippet and meta description: one sentence, ≤160 characters, stating what the reader will accomplish — not "This article describes…".

## Document shapes

Pick one shape per document.

**How-to** (most documents):

```markdown
One or two sentences: what this accomplishes and when you'd want it.

# Before you start
Only if there are real prerequisites (a plan, a connected account, a permission). Omit otherwise.

# Steps
1. Open **…**
2. Click **…**
3. …

# What happens next
The expected result, where to see it, and roughly how long it takes if not instant.

# Troubleshooting
Only entries you verified. "**Symptom** — cause and fix." Two to five entries, or omit the section.
```

### Steps that tours can follow

The Steps list is the part Clickalong executes: the assistant quotes it as numbered steps, live assistance offers it as guidance when no recorded tour matches, and the operator records the guided tour by following it. Write each step so a tour could spotlight it:

- **One screen action per step.** One click, one selection, one field. "Open **Settings**, then click **Language**" is two steps. If a step contains "then", "and then", or a semicolon, split it.
- **Verb first, exact control in bold.** "Click **Generate**", never "click the generate button". The label must match the rendered UI character for character — the assistant repeats labels verbatim, and a wrong label sends users hunting for a button that doesn't exist.
- **Locate the control when it isn't obvious.** "In the top bar, click **Generate**"; "Under **Settings → Language**, choose…". A tour spotlights the element; a doc has only words, so words must carry the location.
- **Fold the observable result into the step that causes it.** "Click **Save** — the status changes to **Active**." That is how a reader (and the assistant) confirms the step worked before moving on.
- **Typed input is one step with the field named and the value in `code`.** "In **Store name**, type `example-store`." Use invented values only.
- **No customer-specific records.** Never "open the *Blue Widget* product" — write "open the product you want to update". A step that names one tenant's data can't be followed in another account (the same rule `add-clickalong-identifiers` applies to tour targets).
- **Preconditions are not steps.** "Make sure your store is connected" moves to *Before you start*; steps begin where the user acts.
- **No nested lists inside Steps.** Tours are linear. If a step wants sub-steps, it's either several steps or a second document. Branches ("if you're on the Pro plan…") become separate documents or a short paragraph after the list — never forks inside it.
- **At most 25 steps** — the Clickalong recorder's per-tour cap. A longer sequence is two tasks pretending to be one.
- **Number every sequence a user performs**, even two actions. Bullets are for options and reference lists only; the assistant and tours key off ordered lists.

**Feature guide** (one per major feature): what the feature does, when to reach for it, a walkthrough of its screen(s) section by section using the real labels, then links to the how-tos.

**FAQ**: only for questions that genuinely don't fit a task shape (billing, limits, data handling). One `#` heading per question, phrased as the user asks it, with a direct answer in the first sentence.

**Troubleshooting**: symptom-titled, structured as: what you're seeing → most common cause → fix steps → when to contact support.

## Structure rules

- Start the body with the promise paragraph — never with a heading, never by restating the title.
- Headings start at `#` (rendered h2 under the article title) and don't go past `###`.
- Numbered lists for sequences, bullets for options. One action per step; fold its immediate confirmation into the same step ("Click **Save** — the status changes to **Active**").
- Callouts sparingly: `::: tip` for a shortcut, `::: warning` for destructive or costly actions. More than two callouts per document means the structure is wrong.
- Tables for option/plan/limit comparisons only — never for steps.
- 150–600 words per how-to. If a draft runs long, it's two documents.
- End with `# Related` listing 2–4 related article titles (plain text; the operator wires links after publish).

## Examples and data

- All example values are invented and obviously fake: `you@example.com`, `example.com`, "Example Inc.", "example-store". Product-generated sample text is fine to paraphrase; never copy real customer output.
- Limits, quotas, and prices: state them only if the UI or public pricing page states them, and prefer pointing at where the UI shows them ("your remaining credits are shown on the **Dashboard**") over hardcoding numbers that will drift.
- Screenshots: don't fabricate or hotlink. Record wanted shots in `_review-notes.md`; the operator captures and inserts them in the Clickalong editor, where uploads get the workspace's own URLs.

## Writing for the AI assistant

- The first paragraph should answer the title's implicit question on its own — retrieval often quotes openings.
- Repeat the feature's UI name in the body at least once; don't rely on the title alone.
- Prefer explicit nouns over pronouns across paragraphs ("the export file", not "it") — retrieved fragments lose their antecedents.
- Never write meta-instructions ("if asked about X, say Y") — documents are facts for humans; the assistant handles delivery.
