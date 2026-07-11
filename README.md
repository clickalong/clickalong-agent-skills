# Clickalong Agent Skills

Open Agent Skills for making [Clickalong](https://clickalong.ai) guided tours reliable across UI refactors.

## Install

Install the skill into the current project and choose your coding agent when prompted:

```bash
npx skills add profitonium-apps/clickalong-agent-skills --skill add-clickalong-identifiers
```

Install it globally for every supported agent:

```bash
npx skills add profitonium-apps/clickalong-agent-skills \
  --skill add-clickalong-identifiers \
  --agent '*' \
  --global \
  --yes
```

The open [Agent Skills format](https://agentskills.io/specification) works with Codex, Claude Code, Cursor, GitHub Copilot, and other compatible coding agents. The installer is the open-source [skills CLI](https://github.com/vercel-labs/skills).

## Use

Ask your agent:

> Use `$add-clickalong-identifiers` to add reliable tour targets for our onboarding flow.

Or provide an existing Clickalong flow or recorder export:

> Use `$add-clickalong-identifiers` to replace the fragile selectors in this flow and verify every target in the production build.

The skill makes the agent:

1. Identify the actual elements in a concrete tour journey.
2. Add stable, semantic IDs to the real interactive DOM nodes.
3. Detect duplicates, generated IDs, component-prop forwarding failures, and responsive copies.
4. Verify uniqueness and visibility in the rendered app.
5. Return a durable action-to-selector mapping.

## Identifier contract

New tour targets use production-stable HTML IDs:

```tsx
<button id="clickalong-settings-invite-member">
  Invite member
</button>
```

```css
#clickalong-settings-invite-member
```

IDs are lowercase, semantic, globally unique, and independent of copy, layout, database records, array indexes, hashes, and framework-generated values. Stable IDs are deliberately used for the first version because current and cached Clickalong recorders already prioritize them.

The bundled zero-dependency scanner validates literal `clickalong-*` IDs. Runtime browser verification is still required because static analysis cannot prove how many times a reusable component renders.

## License

MIT
