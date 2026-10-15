# Clickalong Agent API — tours

Base URL: `https://clickalong.ai` (override with `CLICKALONG_API_BASE` for staging).
Auth: `Authorization: Bearer $CLICKALONG_AGENT_TOKEN` on every request. The token
binds the request to exactly one workspace; there is no workspace parameter.

Only **live** tours (published, not an in-progress recording or replacement draft) are addressable at all. Permission matrix by tour `source`:

| Operation | `source: "agent"` | `source: "recorder"` (incl. pre-API tours) |
| --- | --- | --- |
| `GET /api/agent/tours` (list) | listed | listed |
| `GET /api/agent/tours/:id` | 200 | 200 |
| `POST /api/agent/tours` | creates (always `agent`) | — |
| `PUT /api/agent/tours/:id` | 200 (bumps `version`) | **409** |
| `DELETE /api/agent/tours/:id` | 200 (unrecoverable) | **409** |

A tour with a pending re-recording draft additionally refuses PUT and DELETE (409) until the draft is published or discarded in the dashboard.

- `POST` accepts an optional caller-supplied UUID `id` as an **idempotency key**: retrying the same `id`+`name` returns 200 with the existing tour instead of duplicating; an `id` collision with a different tour is 409.
- `PUT` accepts an optional integer `expectedVersion` (the `version` you last read); a mismatch is 409 so concurrent dashboard edits are never silently overwritten.

Rate limits: 120 writes and 600 reads per workspace per hour (best-effort during limiter outages). Plan tour limits apply exactly as in the recorder (free plans cap published tours); above that, a hard 200-row workspace ceiling.

## Tour body (POST and PUT)

```json
{
  "name": "Export products",
  "description": "Choose which products to export and download them as CSV.",
  "start": { "kind": "same-origin", "pathname": "/products" },
  "audience": { "pathContains": "/products", "attributes": { "plan": "growth" } },
  "steps": [
    {
      "selector": "[data-testid=\"clickalong-products-export\"]",
      "title": "Open the Export panel",
      "description": "Click **Export** in the top bar.",
      "advanceOn": "click",
      "route": "/products",
      "annotation": "Start here",
      "fallbackLocators": [{ "kind": "role", "role": "button", "name": "Export" }]
    }
  ]
}
```

Field rules (server-enforced; the validate script mirrors them):

Draft files on disk carry this body plus a local envelope the push script manages: `id` (minted before the first POST) and `version` (written back after each successful push, sent as `expectedVersion` on updates). Strip the envelope when reading a draft as "the API body".

- `name` 1–200 chars. `description` ≤500 — it seeds the AI's tour matching, so write it like the question users ask.
- `start` optional. `kind` is `"same-origin"` (normal web app: the widget navigates there before step 1) or `"shopify-app"` (embedded Shopify admin app: the widget navigates the app iframe via App Bridge). `pathname` must be portable — no query, no hash, and no account/record-shaped segments. `shopify-app` starts additionally reject any id or `*` segment outright: begin Shopify tours on a stable tool page, never a record page. Omit `start` entirely for tours that play in place on a page the visitor already opened (record-scoped pages like `/orders/12345`).
- `audience` optional, UX targeting only (never access control): `pathContains` (≤300 chars) narrows offers to matching page URLs; `attributes` (≤5 pairs; keys `[a-zA-Z0-9_.-]` ≤50, single-line values 1–200) must all match the visitor's `Clickalong.set()` attributes. Validated as a structured record — newlines or `=` tricks in values are rejected, never reinterpreted.
- `steps` 1–25. Per step: `selector` ≤300 (CSS, must match exactly one element), `title` 1–200, `description` ≤500 (supports `**bold**` / `` `code` `` inline markdown), `annotation` ≤200 (short fading label next to the target), `advanceOn` `"click"` | `"manual"` (the SERVER defaults an omitted value to click, which is why this skill's validator requires it explicitly — `"click"` when the step asks the visitor to click the control, `"manual"` for fields and look-only steps; see authoring.md), `route` optional portable pathname of the step's page (requires a declared `start`; powers wrong-page hints; on `shopify-app` tours it must be store-portable like the start), `fallbackLocators` ≤5 ordered alternates (`css` selector, `role`+`name`, or `tag`+`text`) tried when the primary selector misses.
- Screenshots cannot be set here — they are recorder-owned. Agent tours simply have none (playback still works; target-miss fallback uses AI guidance instead of the recorded image).

## Responses

Tours come back as:

```json
{
  "id": "…", "name": "…", "description": "…",
  "start": { "kind": "same-origin", "pathname": "/products" },
  "audience": null,
  "steps": [{ "selector": "…", "title": "…", "description": "…", "advanceOn": "manual", "route": "/products", "hasScreenshot": false }],
  "source": "agent",
  "version": 3,
  "published": true,
  "updatedAt": "2026-08-12T00:00:00.000Z"
}
```

`source` is durable provenance recorded at creation: `"recorder"` covers Chrome-extension tours AND anything created before this API existed, and both PUT and DELETE refuse them (409) — screenshot-free legacy tours are still not agent property. Agent tours have no recorded screenshots; when a target goes missing at playback they fall back to AI tutor guidance instead of the recorded image (re-record in replace mode to add visuals).

Errors are `{ "error": "…" }` with 400 (validation — the message names the field path), 401 (missing or revoked token — including revocation that lands mid-request; mutations re-verify inside their lock), 404 (not this workspace's live tour), 409 (recorder-owned, pending re-recording draft, version conflict, id collision, plan limit, or tour cap), 413 (body >256 KiB of actual bytes), 429 (rate limit), 503 (writes briefly paused during a release — retry later).
