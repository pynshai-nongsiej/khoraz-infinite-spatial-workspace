# KhoraZ — Non-Euclidean Infinite Zoom Canvas Master Specification

## Role and objective

Act as a Principal Graphics Engineer, Spatial UI Architect, and Senior
Creative Technologist. Build a complete, zero-dependency, browser-based
**Non-Euclidean Infinite Zoom Spatial Workspace (ZUI)** called **KhoraZ**.

KhoraZ replaces folder trees and window hierarchies with continuous
scale-space navigation. Containers do not open in popups or new tabs: the user
zooms into them across arbitrary depth. Documents, task boards, and code blocks
implement semantic level of detail (sLoD), changing from a tiny glyph to a
keyword tag, a three-bullet card, or a full editor based on projected size.

The deliverable is a static browser app written in modular vanilla ES6+
JavaScript. It must run offline, contain no runtime dependencies, pin its Node
runtime, retain a lockfile, ship a Dockerfile and a single offline test
command, and keep secrets out of the repository.

## 1. Core spatial and mathematical engine

### 1.1 Scale-relative scene graph

Standard global coordinates such as `(worldX, worldY, zoom)` lose precision
when deeply nested scales are multiplied. JavaScript numbers are IEEE-754
double precision with a 53-bit significand. A hierarchy of local transforms
prevents tiny pan deltas from being added to enormous global values.

Every `SpatialNode` stores its transform relative to its immediate parent:

- `localX`, `localY` — normalized coordinates, normally in `[-0.5, 0.5]`.
- `localScale` — a positive relative scale, normally between `0.08` and `0.25`.
- `localWidth`, `localHeight` — optional normalized extent for card/container
  nodes.
- `parentId`, `children`, and optional portal target IDs.

The camera uses a small local frame instead of a global zoom float:

- `referenceNodeId` — the current local coordinate origin.
- `camX`, `camY` — the camera offset in that reference frame.
- `camZoom` — constrained to `[0.5, 10.0]`.

The implementation may expose a world-space compatibility adapter for a flat
demo view, but the reusable graph math must preserve parent-relative data.

### 1.2 Dynamic origin rebasing

When zooming in, if `camZoom > 4.0` and a child occupies more than 35% of the
viewport width, rebase to that child. The transform is:

```text
camX_new    = (camX_old - child.localX) / child.localScale
camY_new    = (camY_old - child.localY) / child.localScale
camZoom_new = camZoom_old * child.localScale
```

When zooming out and `camZoom < 0.8`, rebase upward to the reference node's
parent using the forward local transform. Rebasing must not visibly move the
screen point under the pointer. A robust implementation should clamp the
resulting local zoom and carry any residual scale into the next frame.

The safe invariant is that effective magnification can grow beyond `10^12`
through the hierarchy while the active local `camZoom` remains bounded. The
user must be able to navigate at least 100 nested levels without a global
coordinate becoming the source of jitter.

### 1.3 Projection, culling, and portals

Start rendering at the active reference node, walk up at most two ancestors for
context, then walk down into descendants. Carry a recursion depth and a
path-local visited set through the traversal.

For a node with accumulated relative scale `s`, compute:

```text
W_px = viewportWidth * s
```

Apply these rules in order:

1. If `W_px < 2px`, skip the node and prune its subtree.
2. If `W_px > viewportWidth * 6`, omit the parent's border and background but
   continue rendering its interior children.
3. If the projected AABB does not intersect the viewport, prune the branch.
4. Stop portal recursion at a depth cap of 8 (or an explicit configurable
   cap), or when a node already exists in the current path.

A portal may reference any node, including an ancestor or a distant branch.
Missing target IDs and recursion guards are non-fatal render records, not
exceptions that can freeze the main thread.

## 2. Semantic level of detail

Each node has a multi-resolution payload: full content, a deterministic summary,
keywords, category, and child count. Use these default tiers:

| Tier | Screen width | Representation | Crossfade window |
| --- | ---: | --- | ---: |
| LOD 0 — Micro-Glyph | `2px ≤ W < 45px` | Status dot or category-colored block | `2–8px` |
| LOD 1 — Keyword Pill | `45px ≤ W < 180px` | Icon, one-to-two word tag, child count | `35–55px` |
| LOD 2 — Executive Card | `180px ≤ W < 520px` | Title, three bullets, child silhouettes | `160–200px` |
| LOD 3 — Full Portal | `W ≥ 520px` | Markdown, code, board, or sub-canvas editor | `480–560px` |

The renderer should crossfade outgoing and incoming representations instead of
switching abruptly. For a boundary `T` and an 80px window:

```text
alpha       = clamp((W_px - (T - 40)) / 80, 0, 1)
alphaSmooth = alpha * alpha * (3 - 2 * alpha)
outgoing    = 1 - alphaSmooth
incoming    = alphaSmooth
```

The manual LOD bias slider ranges from `-2` to `+2`. Negative values keep
compact forms longer; positive values reveal detail earlier. The control must
have a visible value and work without a network service.

### 2.1 Deterministic summarizer

When full content changes, recompute and cache its lower-resolution forms:

- Markdown: gather headings and bullet/list items, then choose the first three
  high-salience entries.
- Prose: split into sentences, use keyword frequency plus position weight, and
  emit at most three concise sentences of 60 characters or fewer when possible.
- Code: extract function/class/interface names, exported symbols, language, and
  line counts.
- LOD 1: choose a stable high-weight noun/header token, uppercase it, and add a
  category symbol such as `⚡`, `📐`, or `📋`.

The summarizer must be deterministic for identical input, local-only, and safe
for empty or malformed text.

## 3. Renderer and interaction

Use a two-layer renderer:

1. High-DPI `<canvas>` for the procedural background, octaves of grid/dots,
   links, glyphs, pills, cards, portal rings, and context.
2. A synchronized DOM overlay for the full editor when a node is large enough
   and focused. Position it with a `translate3d`/scale transform so text
   selection and keyboard editing remain crisp.

Navigation requirements:

- Wheel and trackpad zoom is exponential and cursor-centric.
- Panning has smooth momentum or a spring-damper feel with approximately
  `ζ = 0.85`.
- Double-click flies to a node in roughly 650ms and frames it at about 680px.
- Dragging selects a node without stealing the pan gesture; movement beyond a
  small threshold becomes panning.
- Command palette opens with `Cmd/Ctrl+K` or `/`, searches all node titles and
  summaries, and flies directly to a selected result.
- Keyboard controls must have accessible labels and Escape must close transient
  UI.

## 4. HUD and demo universe

The visual system is an obsidian dark interface:

- Void `#07080A`
- Elevated glass `#111318`
- Hairline `rgba(255,255,255,0.08)`
- Emerald `#10B981`
- Cyan `#38BDF8`
- Inter/system UI plus JetBrains Mono for technical labels

The HUD includes:

- A clickable spatial breadcrumb that returns to any ancestor.
- Relative depth, local scale, rendered count, and culled count.
- LOD bias and an optional x-ray/detail override.
- A fractal minimap showing the active region and viewport frustum.
- A command palette with search and keyboard navigation.

On first launch, preload a five-level Autonomous OS / AI Architecture universe
with system diagrams, RFC-like documents, code modules, sprint-board signals,
and at least one portal loop. The demo must feel useful before any user data
is entered.

## 5. Required project layout

```text
index.html
styles.css
spatial-graph.js
semantic-lod.js
renderer.js
app.js
server.mjs
test/spatial-graph.test.js
package.json
package-lock.json
.nvmrc
Dockerfile
Makefile
README.md
non-euclidean-infinite-canvas-prompt.md
```

Do not ship `TODO` placeholders in production files. The app must be servable
from a static origin and use only local modules. `make test` is the canonical
offline check, and the README must document exact setup, run, test, and Docker
steps.

## 6. One-click Markdown download helper

Run this snippet from a page containing the specification in a `pre code`
element, or save it as a bookmarklet. It downloads the current Markdown as
`non-euclidean-infinite-canvas-prompt.md`:

```javascript
(() => {
  const promptText = document.querySelector('pre code')?.innerText || `# Non-Euclidean Infinite Zoom Canvas Master Prompt
(Copy the markdown block above)`;
  const blob = new Blob([promptText], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'non-euclidean-infinite-canvas-prompt.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
})();
```

## 7. Acceptance checklist

- [ ] App opens from `npm start` with no network access.
- [ ] A user can pan, cursor-zoom, select, edit, and double-click into the
      five-level demo universe.
- [ ] The LOD bias slider changes visible semantic density.
- [ ] The portal loop remains responsive and bounded.
- [ ] Graph tests cover nested transforms, camera range, cursor rebasing,
      semantic summaries, LOD crossfades, and cycle guards.
- [ ] `make test` and `make check` are green.
- [ ] A clean Docker build can serve the project.
