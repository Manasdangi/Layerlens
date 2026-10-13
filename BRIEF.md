# Figr — Frontend Engineer Assignment

Role and brief: [doc.figr.design/frontend-engineer](https://doc.figr.design/frontend-engineer) · Submit: [join.figr.design/r/kdqVkj](https://join.figr.design/r/kdqVkj)

## Setting

You're building the viewer for a design tool. A board shows live previews of web pages. Each preview is an `<iframe>` showing a page served from a **different origin** than your app. Users point at elements inside any preview. Your app, the page that contains the previews (the "host"), draws the outlines and labels on top of each preview. It also shows a layers panel and an inspector for whatever is selected.

Use any framework, language, library, AI tool or workflow you like.

## What's in this kit

```
backend/
  server.js        mock API (:4000) and page server (:4001), no dependencies
  data/            screens.json, elements.json
  pages/           the preview pages
frontend/
  report.js        error reporter stub
```

Run the backend with Node 18+:

```
npm run backend
```

- **Pages** at `http://localhost:4001`: `page-1.html` to `page-6.html`, plus `page-6-next.html`, which page 6 links to. You may add **one `<script>` tag** to each page. You may not change anything else in them.
- **API** at `http://localhost:4000`. Every route accepts `?latency=<ms>&fail=<0..1>`. A failed request returns either a 5xx or a 200 with a malformed body.
  - `GET /screens` returns `[{ id, name, url }]`: 24 screens, which reuse the 6 pages.
  - `GET /elements/:key` returns `{ component, description, status, owner }` for elements that carry a `data-key` attribute. It returns `404` when there are no details for that key.
- **`report(error, context)`** in `frontend/report.js`: a stub error reporter that logs every call.

Build your app in `frontend/`, or anywhere else in the repo.

## Terms

- **Preview**: one iframe on the board.
- **Element**: any element inside a preview's page except `<html>` and `<body>`.
- **Active preview**: the preview the user last clicked in Select mode. The layers panel and inspector show the active preview.
- **Name**: an element's `data-name` if it has one, otherwise tag plus first class (`button.primary`) or tag plus id (`div#hero`), otherwise the tag alone.

## Requirements

### R1: Board

1. Show every screen from `GET /screens` as a preview, 1280×800 each, in a grid, with the screen name above it.
2. Dragging empty board space pans the board. The wheel over empty board space pans too.
3. **Ctrl/Cmd + wheel** zooms the board from 25% to 400%, centred on the pointer. This works **wherever the pointer is, including over a preview**.
4. The wheel over a preview scrolls that page, in both modes.
5. Two modes, switched from a toolbar toggle and the **V** key (Select) and **I** key (Interact):
   - **Select mode** (default): clicks select elements and never reach the page. Links don't navigate, buttons don't act, inputs don't get focus, forms don't submit.
   - **Interact mode**: the page behaves normally and no outlines are drawn.
     - The selection is kept but hidden, and it reappears when switching back to Select mode if the elements still exist.
     - The layers panel keeps updating as the page changes.

### R2: Hover (Select mode)

1. When the pointer is over an element, draw a **1px outline** exactly on that element's box, with a label showing its name.
2. Only one element on the whole board is hovered at a time.
3. Hover clears when the pointer leaves the preview or the window, or when the board starts panning or zooming.
4. **Every** element can be hovered and selected, including disabled buttons and inputs, images, SVG, and elements under a sticky header.
5. Page background (`<html>` / `<body>`) is never hovered. Pointing at it shows nothing.

### R3: Selection

1. Clicking selects the element under the pointer. Selected elements get a **2px outline** in a different colour from hover, plus a label.
2. **Shift + click** adds or removes an element in the same preview. Shift + click in a different preview replaces the selection with that element.
3. **Escape**, clicking page background, or clicking empty board space clears the selection.
4. Outlines and labels:
   - stay glued to their element while the user pans, zooms, scrolls inside the page (including scroll areas inside the page), resizes the window, or the element changes size or moves;
   - stay 1px or 2px thick and keep the same label size at every zoom level;
   - are clipped to the preview's edges. An element scrolled fully out of view has no outline but stays selected;
   - put the label below the element when there's no room above it inside the preview.
5. **Keyboard.** When several elements are selected, each of these keys acts on the most recently selected one and replaces the selection with the result.
   - **Enter** selects the first child.
   - **Shift + Enter** selects the parent. Nothing happens at the top level.
   - **Tab / Shift + Tab** selects the next or previous sibling, wrapping around.
6. **All shortcuts** (V, I, Escape, Enter, Tab, and so on) work even right after the user clicked inside a preview.
7. **The page re-renders itself:**
   - A selected element that still exists stays selected, even if the page rebuilt its DOM nodes or inserted new siblings before it.
   - A selected element that no longer exists is removed from the selection. If nothing remains selected, the inspector says **"This element no longer exists"** until the next selection.
   - The selection must never jump to a different element. If your approach can't guarantee this in some case, say which case in your README.
8. **A page navigates** (a link followed in Interact mode):
   - That preview's selection clears.
   - Select mode works on the new page with no reload of the board.
   - The layers panel shows the new page.

### R4: Layers panel

1. It shows the element tree of the active preview. With no active preview, it shows "Click something in a preview".
2. Each row shows indentation, the element's name, and a chevron if the element has children. Top-level rows are the children of `<body>`.
3. **Children load when a row is first expanded.** While loading, the row shows a loading state. If the page doesn't answer within 3 seconds, the row shows "Couldn't load" with a retry on that row only.
   - Collapsing and re-expanding a row, including while it's still loading, must never produce duplicate or missing children.
4. **Hover sync, both directions:**
   - Hovering a row draws the hover outline on that element in the preview.
   - Hovering an element in the preview highlights its row. If that row is inside a collapsed parent, highlight the nearest visible ancestor row instead. Hover never expands anything.
5. **Selection sync, both directions:**
   - Clicking a row selects that element.
   - Selecting an element in the preview expands every ancestor of its row (loading them if needed, even many levels deep), highlights the row, and scrolls the panel to show it.
6. Clicking a row whose element is out of view inside the page scrolls **only that page** to show the element. The board and the host page don't move.
7. **Multi-select:** Shift + click on a row adds or removes it, and all selected rows are highlighted.
8. **Keyboard while the panel has focus:**
   - **↑ / ↓** select the previous or next visible row.
   - **→** expands a row, or moves to its first child if it's already expanded.
   - **←** collapses a row, or moves to its parent if it's already collapsed.
9. **Expanded rows and panel scroll position are remembered per preview.** Switching the active preview to B and back to A restores A exactly as it was left, until A's page navigates or the board reloads.
10. **When the page changes its own DOM, the tree updates to match:**
    - Rows that still exist keep their expanded state and selection.
    - Removed rows disappear, and a removed hovered row clears the hover.
    - Rows the user is looking at don't jump. The scroll position holds steady.
11. **Search box:**
    - Typing shows only rows whose name contains the text, together with their ancestors.
    - Search covers the whole tree, including rows never loaded.
    - Clearing the search restores exactly the expanded state from before the search.
    - Selecting a search result selects the element and keeps the search open.

### R5: Inspector

1. With **one** element selected, it has two sections:
   - **Live** (read from the page): name, tag, id, classes, width × height (px, rounded), position within the page, the first 120 characters of text, text colour, background colour, font family, size and weight. Values update when the element changes.
   - **Details** (from `GET /elements/:key`): component, description, status, owner.
     - An element with no `data-key` shows "No details".
     - A `404` shows "No details for this element". A 404 is not an error.
2. With **several** elements selected, it shows "N elements", and each Live field shows either the value they all share or "Mixed". There is no Details section.
3. When the selection changes while Details are loading, only the latest selection's details are ever shown.

### R6: Failures

1. **Regions.** Each of these is its own region: the board, each preview, the layers panel, each row's child loading, and the inspector's Details section.
2. **A failure in a region shows an error with a Retry button in that region only.** Everything else keeps working.
   - `GET /screens` fails → the board shows the error.
   - A preview's page doesn't load, or its script doesn't respond within 10 seconds → "Couldn't connect to this preview" on that preview only.
   - `GET /elements/:key` fails or returns bad data → error in Details only. Live values still show.
   - A render error in the inspector → the inspector shows the error. The board and the layers panel keep working.
3. **Errors inside a page** are shown as a small "Page error" badge on that preview. Hovering the badge shows the message.
4. **Reporting:**
   - Every failure reaches `report()` **exactly once**, with `{ region, screenId, elementKey? }`.
   - A retry that fails again counts as a new failure.
   - A request that was cancelled or replaced because the user moved on is **not** a failure: no error is shown and nothing is reported.
5. **Where an error happens doesn't matter.** An error thrown while drawing, handling a click or key, handling a message from a preview, in a timer, or when a response arrives gets the same region error and the same single report.
6. **A response or error that arrives after its region is gone** changes nothing and reports nothing.
7. **A dev-only menu** can trigger each of these failures on demand, for the video.

### Out of scope

Editing pages, saving anything across a reload, auth, mobile, and more than one user.

## Deliverables

1. **A public GitHub repo** that runs the backend and your app with one command.
2. **A README** covering:
   - any requirement you found ambiguous or contradictory, and what you decided;
   - how state is organised: what lives where, and who is allowed to change it;
   - how the host and the pages talk to each other: the messages, and what happens when one side is slow, gone, or replaced;
   - **"where this breaks"**: the cases you know your build gets wrong.
3. **A 15-minute video** (Loom or any shareable link) explaining your code. We evaluate your system design calls mainly from this video, so talk through the *why*, not just the *what*.
   - **2 min**: what you built and the main calls you made.
   - **8 min**: walk through the code behind R1–R6, showing each part running. Cover your state model, the host ↔ page protocol, how you identify elements across re-renders and navigation, how the tree loads, and how failures are contained and reported.
   - **3 min**: where it breaks, and what you'd change with another week.
   - **2 min**: how you used AI, and where it got things wrong.

You may study any public product, Figr included. If you do, say what you took and why it works.

## Submitting

Submit your repo, video and resume here: **https://join.figr.design/r/kdqVkj**
