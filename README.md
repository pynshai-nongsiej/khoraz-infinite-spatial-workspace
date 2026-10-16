# KhoraZ

KhoraZ is a zero-dependency, browser-native spatial workspace for navigating a
deep knowledge graph as a continuous scale-space. It is a deliberately small
buildathon project: the visual shell is plain HTML/CSS/Canvas2D, the spatial
math is an ES module, and every check runs offline with Node's built-in test
runner.

The name comes from *khōra*, a receptive space or interval, combined with ZUI
(zoomable user interface). The interface treats scale as the primary
navigation axis: a signal can be selected, edited locally, and entered with a
double-click. The demo universe is a five-level autonomous-systems workspace
with a visible portal loop called **The Liminal Gate**.

## What is included

- `index.html` — the app shell, spatial canvas, HUD, inspector, minimap,
  semantic-bias scrubber, command palette, and editor portal.
- `styles.css` — the obsidian glass interface theme.
- `spatial-graph.js` — normalized parent-relative rectangles, camera framing,
  cursor-anchored zoom, screen projection, culling, and guarded wormhole
  traversal.
- `semantic-lod.js` — deterministic offline content detection, summaries,
  keyword extraction, LOD tier selection, and smooth crossfades.
- `renderer.js` — high-DPI Canvas2D renderer, procedural grid, links, portal
  glyphs, hit testing, and camera animation.
- `app.js` — the demo data model, interaction wiring, editing flow, command
  palette, breadcrumbs, and minimap.
- `non-euclidean-infinite-canvas-prompt.md` — the complete implementation
  brief, including the rebasing equations and the browser download snippet.
- `test/spatial-graph.test.js` — offline math, traversal, and summarizer tests.

## Requirements

- Node.js `22.14.0` or newer. The expected version is pinned in `.nvmrc`.
- A browser with ES module and Canvas2D support.

There are no runtime or development npm dependencies. `package-lock.json` is
kept so a clean checkout has a reproducible npm project shape.

## Setup

```sh
git clone <your-repository-url> khoraz
cd khoraz
nvm use
npm ci
```

`npm ci` is offline-safe because the project has no dependency packages. If
you do not use nvm, install Node `22.14.0` manually and continue.

## Run locally

```sh
npm start
```

Then open <http://localhost:4173>.

The static server is `server.mjs`; it is intentionally bundled instead of
requiring a global CLI. You can change the port without changing source:

```sh
PORT=8080 npm start
```

## Test and check

The single project test command is:

```sh
make test
```

It runs `npm test -- --test-reporter=spec`, which exercises the spatial camera
range, nested transforms, cursor-safe rebasing behavior, wormhole cycle guard,
semantic code summaries, and LOD crossfades. Syntax checks are available with:

```sh
make check
```

## Docker

The Docker image installs the pinned Node runtime, performs an offline npm
install, copies the project, and serves the app:

```sh
docker build -t khoraz .
docker run --rm -p 4173:4173 khoraz
```

Open <http://localhost:4173> after the container starts.

## Interaction guide

- **Drag** the field to pan.
- **Scroll** over any point to zoom around that cursor ray.
- **Click** a node to inspect it.
- **Double-click** a node to dive into it; the portal sends you through its
  referenced branch.
- **Backspace** returns to the active node's parent.
- **Enter** dives into the selected node; **E** opens the editor.
- **Cmd/Ctrl + K** opens the spatial command palette.
- **0** frames the active location; `+` and `-` adjust scale.
- The bottom-right minimap reframes the camera when clicked.
- The bottom-right LOD bias slider shifts semantic density from quiet to dense.

## Architecture notes

### Local coordinates and rebasing

`SpatialGraph` resolves each node through its parent rectangle rather than
accumulating a single global magnification. `createCameraFrame` maintains a
small local `camZoom`; `rebaseZoom` preserves the world point under a pointer
when changing scale. Traversal receives a copied path set so a portal can loop
back into an ancestor without recursing forever.

The current demo renderer intentionally presents the graph as a navigable
flat field so it stays legible at first launch. The reusable graph module is
ready for a hierarchical renderer: supply normalized `x`, `y`, `width`, and
`height` values to `SpatialGraph` and use `resolveNode`/`cull` for portal
placement and screen-space pruning.

### Semantic LOD

`semantic-lod.js` is deterministic and client-side. Markdown headings and
paragraphs, prose sentences, and code declarations are summarized without a
network call. The renderer uses compact glyphs and labels while the editor
overlay provides the crisp DOM editing path described in the brief.

## Repository workflow

This repository is designed to rebuild on a clean Linux machine:

1. Use the pinned Node runtime.
2. Run `npm ci` without global installs.
3. Run `make test` before and after changes.
4. Keep the lockfile, Dockerfile, README, and `.env.example` in sync.
5. Commit each working step with a conventional message such as
   `feat: add guarded spatial graph core`.

No credentials are required for the demo. Local edits are ephemeral by
design; there is no external sync service or telemetry.
