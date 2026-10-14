# Layerlens

A board of live, cross-origin iframe previews you inspect like a design tool. The brief is [BRIEF.md](BRIEF.md) (requirements R1–R6). The full design write-up is [README.md](README.md). Read both before changing behaviour.

## Commands

```
npm install && npm run dev      # backend :4000 (API) / :4001 (pages), app :5173
npm test                        # unit (Vitest) then e2e (Playwright)
npm run test:unit               # ~2s
npm run test:e2e                # ~45s, starts its own servers on 4100 / 4101 / 5273
npm run screenshots             # regenerates docs/screenshots/*.png
cd frontend && npx tsc -b && npx oxlint   # must both be clean
```

First time e2e: `npx playwright install chromium`.

## Rules from the brief (don't break)

- Preview pages (`backend/pages/page-*.html`) may only get **one added `<script>` tag**. Nothing else in them changes. All page-side logic lives in `backend/pages/figr-bridge.js`.
- Every failure reaches `report()` **exactly once** with `{ region, screenId, elementKey? }`. A retry that fails again is a new report. A request cancelled because the user moved on is **not** a failure: no error shown, no report.
- A late response for a region that's gone changes nothing and reports nothing.
- The selection must **never jump** to a different element. Losing it is acceptable; guessing is not.

## How the code is organised

- `frontend/src/state.ts`: the one store. **Only `frontend/src/actions/` writes to it.** Components read with `useStore(selector)` (return stored references, not fresh objects) and call actions.
- `frontend/src/actions/`: `pages` (connections, page messages, watching), `board` (mode, camera), `selection` (hover, selection, keys), `layers` (tree, search), `dev` (fault triggers).
- `frontend/src/connection.ts`: one `Connection` per iframe. All timeouts (`CONNECT_TIMEOUT`, `HIT_TIMEOUT`, `ROW_TIMEOUT`) are defined here and nowhere else.
- `frontend/src/protocol.ts` mirrors the message shapes in `figr-bridge.js`. Change both together.
- **The bridge owns element identity.** The app only holds opaque ids (`"n42"`). Re-binding after a re-render must match exactly one node at every locator step, or the id is reported `gone`.
- **Errors go through regions** (`components/Region.tsx`). Use `raise(error)` for caught errors, `guard(fn)` for callbacks (timers, listeners, promise handlers), and `run(fn)` for event handlers. Don't swallow errors with a bare `catch`, except where the reason is commented (stale hover, dev triggers).
- Row loads and search keep their error in tree state and call `report()` themselves. The top-level load fails the whole layers panel.
- Anything tied to one page load is keyed by `docId`. A navigation gets a new `docId`, and the old state is dropped, not migrated.

## Gotchas

- After turning a file into a folder (e.g. `actions.ts` → `actions/`), **restart the Vite dev server**. It keeps serving the cached old module.
- E2E: clicking the centre of a table row or list item hits its child (`td`, `span`). Click, wait for that label, then press `Shift+Enter` to step up.
- E2E: wait for a click's selection to land before pressing keys, or the keys act on the old selection.
- E2E: the bridge's `message` listener is registered first, so a listener added later from a test can't block it. To make a page unresponsive, use the route-wrapped bridge in `e2e/r6-unresponsive.spec.ts`.
- `report()` calls are read in e2e from the console (`[report #N]`). Keep that log format.
- New failure kinds need a Dev faults menu trigger (R6.7), an e2e test, and a README line.

## When changing behaviour

Update the README's "Decisions" or "Where this breaks" sections if the change affects them. Run `npm test`, `tsc` and `oxlint` before committing.
