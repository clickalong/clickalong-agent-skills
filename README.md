# Clickalong Agent Skills

Open Agent Skills for [Clickalong](https://clickalong.ai) customers:

| Skill | Job |
| --- | --- |
| `add-clickalong-identifiers` | Make guided tours reliable across accounts and UI refactors with durable `data-testid` targets, and make the app legible to the AI assist guide with real accessible names, navigation opt-ins, and privacy opt-outs. |
| `write-clickalong-docs` | Research your product's user-facing features in its own codebase and write leak-safe, tour-ready step-by-step help docs for your Clickalong workspace. |

## Install

Install a skill into the current project and choose your coding agent when prompted:

```bash
npx skills add clickalong/clickalong-agent-skills --skill add-clickalong-identifiers
```

```bash
npx skills add clickalong/clickalong-agent-skills --skill write-clickalong-docs
```

Install globally for every supported agent by adding `--agent '*' --global --yes`.

The open [Agent Skills format](https://agentskills.io/specification) works with Codex, Claude Code, Cursor, GitHub Copilot, and other compatible coding agents. The installer is the open-source [skills CLI](https://github.com/vercel-labs/skills).

## add-clickalong-identifiers

Ask your agent:

> Use `$add-clickalong-identifiers` to add reliable tour targets for our onboarding flow.

Or provide an existing Clickalong flow/recorder export:

> Use `$add-clickalong-identifiers` to replace the fragile or account-specific targets in this flow and verify every target in the production build.

The skill makes the agent:

1. Trace a concrete journey to the actual interactive DOM nodes.
2. Separate fixed application controls from customer-specific records.
3. Add stable, unique, production-preserved `data-testid` attributes.
4. Detect duplicates, interpolation, Shopify/record IDs, prop-forwarding failures, responsive copies, and stripped production attributes.
5. Verify uniqueness, visibility, and behavior in the rendered workflow.
6. Apply the AI-assist semantic contract: accessible names that equal visible labels, unique names per view, `data-clickalong-action="navigation"` opt-ins on reversible custom navigation, `data-clickalong-private` exclusions for sensitive regions, and truthful `autocomplete` on credential fields.

## Target contract

New tour targets use the familiar `data-testid` attribute with a Clickalong-namespaced, semantic value:

```tsx
<button data-testid="clickalong-settings-invite-member">
  Invite member
</button>
```

```css
[data-testid="clickalong-settings-invite-member"]
```

Values remain identical across customers and releases. They never include database records, Shopify GIDs, array indexes, translated copy, timestamps, hashes, or generated framework values. Repeated customer-data rows are not made “portable” by appending an ID; tours target a stable picker/container or ask the visitor to choose their own item.

The bundled zero-dependency scanner validates literal `clickalong-*` `data-testid` declarations. Runtime verification remains mandatory because static analysis cannot prove component multiplicity, visibility, or production attribute retention.

Recorded tours are one of two targeting systems. Clickalong's AI assist guide never reads `data-testid` — it resolves controls by accessible name, role, and safety classification, and it fails closed on missing or ambiguous names. The skill therefore also carries the semantic contract (accessible names, name uniqueness, navigation opt-ins, privacy opt-outs, `autocomplete` fencing) with a second zero-dependency scanner that errors on misused `data-clickalong-action` markup and warns on placeholder-named fields and password inputs without `autocomplete`.

## write-clickalong-docs

Ask your agent:

> Use `$write-clickalong-docs` to write help guides for our main features and get them into our Clickalong workspace.

The skill makes the agent:

1. Propose a topic list from your product's user-facing surface and get it approved.
2. Research each topic from the UI only — exact labels, flows, and on-screen limits — never from secrets, infrastructure, or admin code.
3. Draft reviewable markdown into a local `clickalong-docs/` bundle in Clickalong's help-center grammar, with every task written as tour-ready numbered steps: one screen action per step, the exact control in bold, the observable result folded in, no nesting, at most 25 steps.
4. Run two bundled zero-dependency gates: a safety scanner that blocks credential shapes, URLs with embedded credentials, and secret-valued assignments (warning on internal endpoints, local paths, admin URLs, non-example emails, and high-entropy strings), and a step audit that fails task docs without numbered steps and flags compound, vague, unlabeled, nested, or over-long steps.
5. Hand the finished bundle to you for review, then help publish it through the Clickalong dashboard, verify the AI assistant answers task questions as numbered steps from the new docs, and list which docs to record as guided tours next.

Steps matter beyond reading: Clickalong's assistant quotes them in chat, live assistance falls back from a recorded tour to an ordered public document, and operators record tours by following the doc as the script — so this skill pairs naturally with `add-clickalong-identifiers` for durable tour targets.

The skill runs inside your proprietary codebase, so its security boundary is explicit: the agent never opens secret-bearing files, every example value is fake, nothing publishes without your approval, and the safety scanner is a blocking gate — its error reports are redacted so even the findings can't leak the secret they found.

## License

MIT
