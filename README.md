# Clickalong Agent Skills

Open Agent Skills for making [Clickalong](https://clickalong.ai) guided tours reliable across accounts and UI refactors.

## Install

Install the skill into the current project and choose your coding agent when prompted:

```bash
npx skills add clickalong/clickalong-agent-skills --skill add-clickalong-identifiers
```

Install it globally for every supported agent:

```bash
npx skills add clickalong/clickalong-agent-skills \
  --skill add-clickalong-identifiers \
  --agent '*' \
  --global \
  --yes
```

The open [Agent Skills format](https://agentskills.io/specification) works with Codex, Claude Code, Cursor, GitHub Copilot, and other compatible coding agents. The installer is the open-source [skills CLI](https://github.com/vercel-labs/skills).

## Use

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

## License

MIT
