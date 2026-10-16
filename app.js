import { createSpatialRenderer } from "./renderer.js";

// These modules are optional adapters. A host can provide them beside this shell;
// the built-in demo remains usable when the project is served as a standalone folder.
const [spatialGraph, semanticLod] = await Promise.all([
  import("./spatial-graph.js").catch(() => null),
  import("./semantic-lod.js").catch(() => null),
]);

const $ = (selector) => document.querySelector(selector);
const canvas = $("#spaceCanvas");
const workspace = $("#workspace");
const renderer = createSpatialRenderer(canvas);
const universe = buildUniverse();
const nodeById = new Map(universe.nodes.map((node) => [node.id, node]));
const graphInstance = spatialGraph?.SpatialGraph ? new spatialGraph.SpatialGraph(universe.nodes) : null;
const semanticCache = new Map();

let activeId = "khora";
let selectedId = null;
let lodBias = 0;
let dragging = false;
let dragMoved = false;
let pointerStart = { x: 0, y: 0 };
let toastTimer = 0;
let paletteIndex = 0;
let filteredCommands = [];

const commands = [
  { label: "Dive into selected node", hint: "open a deeper layer", glyph: "↘", shortcut: "↵", run: () => selectedId && diveInto(nodeById.get(selectedId)) },
  { label: "Return to parent", hint: "move one layer up", glyph: "↖", shortcut: "⌫", run: () => goToParent() },
  { label: "Frame current location", hint: "center active node", glyph: "◎", shortcut: "0", run: () => frameActive() },
  { label: "Zoom in", hint: "increase spatial scale", glyph: "+", shortcut: "+", run: () => zoomAtCenter(1.26) },
  { label: "Zoom out", hint: "decrease spatial scale", glyph: "−", shortcut: "−", run: () => zoomAtCenter(.79) },
  { label: "Edit selected node", hint: "change its signal note", glyph: "✎", shortcut: "E", run: () => openEditor() },
  { label: "Focus LOD bias", hint: "tune semantic detail", glyph: "◒", shortcut: "L", run: () => { $("#lodBias").focus(); } },
  { label: "Keyboard shortcuts", hint: "show navigation keys", glyph: "⌘", shortcut: "?", run: () => showToast("Drag to pan · scroll to zoom · double-click to dive") },
];

function node(id, title, parentId, depth, x, y, kind, subtitle, description, extra = {}) {
  return { id, title, parentId, depth, x, y, kind, subtitle, description, radius: depth === 0 ? 18 : depth === 1 ? 14 : depth === 2 ? 11 : depth === 3 ? 8 : 6, ...extra };
}

function buildUniverse() {
  const nodes = [
    node("khora", "KhoraZ", null, 0, 0, 0, "universe", "THE LIVING UNIVERSE", "A non-Euclidean field of ideas, signals, and remembered places.", { color: "#65e5e8" }),
    node("observatory", "The Observatory", "khora", 1, -330, -185, "constellation", "SIGNAL / 01", "A listening station for patterns that have not found language yet."),
    node("memory-reef", "Memory Reef", "khora", 1, 320, -185, "reef", "ARCHIVE / 02", "Soft structures for the things that refuse to stay in one shape."),
    node("cinder-archive", "Cinder Archive", "khora", 1, -265, 235, "archive", "HISTORY / 03", "A warm, indexed underworld of fragments and durable evidence."),
    node("wormhole", "The Liminal Gate", "khora", 1, 350, 228, "portal", "WORMHOLE / ∞", "A shortcut through adjacent meanings. The other side is always changing.", { portalTo: "observatory" }),

    node("observatory-blueprint", "Blueprint Room", "observatory", 2, -490, -285, "chamber", "ROOM / 01", "Plans for impossible instruments and the people who build them."),
    node("observatory-signal", "Signal Garden", "observatory", 2, -220, -350, "constellation", "ROOM / 02", "A cultivated field of pulses, held in bloom by attention."),
    node("observatory-relay", "Far Relay", "observatory", 2, -115, -95, "chamber", "ROOM / 03", "The last station before a thought becomes a transmission."),
    node("reef-tide", "Tide Library", "memory-reef", 2, 160, -310, "reef", "POOL / 01", "Index cards drifting in a slow blue current."),
    node("reef-mirror", "Mirror Kelp", "memory-reef", 2, 455, -315, "reef", "POOL / 02", "Reflections that remember more than the object."),
    node("reef-sleep", "Sleepers", "memory-reef", 2, 500, -80, "chamber", "POOL / 03", "Quiet, unfinished memories waiting for a visitor."),
    node("archive-ember", "Ember Index", "cinder-archive", 2, -465, 155, "archive", "STACK / 01", "The smallest sparks from the oldest fire."),
    node("archive-vault", "Deep Vault", "cinder-archive", 2, -190, 390, "archive", "STACK / 02", "A protected record of what survived the first forgetting."),
    node("archive-lens", "Evidence Lens", "cinder-archive", 2, -55, 175, "chamber", "STACK / 03", "A room for looking closely without collapsing the thing observed."),

    node("blueprint-loom", "Topology Loom", "observatory-blueprint", 3, -565, -385, "artifact", "DEVICE", "A loom that weaves exits before rooms."),
    node("blueprint-maps", "Folded Maps", "observatory-blueprint", 3, -410, -185, "artifact", "ATLAS", "Routes recorded by travelers who never returned."),
    node("blueprint-key", "Aster Key", "observatory-blueprint", 3, -560, -170, "artifact", "TOKEN", "A small key with a very large destination."),
    node("signal-choir", "Choir of Small Suns", "observatory-signal", 3, -300, -455, "artifact", "COLLECTION", "Twenty-seven signals, harmonized by distance."),
    node("signal-seed", "First Seed", "observatory-signal", 3, -120, -330, "artifact", "ORIGIN", "The first pulse to answer itself."),
    node("relay-antenna", "Night Antenna", "observatory-relay", 3, -80, -35, "artifact", "RELAY", "It only receives messages from places that do not exist."),
    node("tide-index", "Index of Returning", "reef-tide", 3, 95, -390, "artifact", "LEDGER", "A list of moments that came back altered."),
    node("mirror-prism", "Prism Witness", "reef-mirror", 3, 545, -420, "artifact", "WITNESS", "A prism that keeps the angle of every gaze."),
    node("sleepers-echo", "Echo Bed", "reef-sleep", 3, 570, -25, "artifact", "RELIC", "A soft place where lost conversations can rest."),
    node("ember-catalog", "Ash Catalog", "archive-ember", 3, -550, 100, "artifact", "CATALOG", "Every entry is warm to the touch."),
    node("vault-witness", "Witness Stone", "archive-vault", 3, -280, 475, "artifact", "RECORD", "A record that cannot be copied, only approached."),
    node("lens-aperture", "Aperture", "archive-lens", 3, 25, 105, "artifact", "FOCUS", "The smallest opening with the widest consequence."),

    node("loom-thread", "Thread 00", "blueprint-loom", 4, -625, -435, "artifact", "FRAGMENT", "A single route through folded space."),
    node("loom-shadow", "Shadow Diagram", "blueprint-loom", 4, -515, -445, "artifact", "FRAGMENT", "The diagram cast by a path not taken."),
    node("map-margin", "Margin Note", "blueprint-maps", 4, -365, -145, "artifact", "ANNOTATION", "Someone left a door here."),
    node("choir-low", "Low Harmonic", "signal-choir", 4, -340, -505, "artifact", "TONE", "The sound beneath the song."),
    node("seed-loop", "Answer Loop", "signal-seed", 4, -80, -370, "artifact", "TONE", "A pulse that arrives before it leaves."),
    node("antenna-note", "Night Note", "relay-antenna", 4, -20, 25, "artifact", "NOTE", "The moon answered at 03:17."),
    node("returning-card", "Card 17", "tide-index", 4, 45, -445, "artifact", "CARD", "The same tide, one year later."),
    node("prism-face", "Blue Face", "mirror-prism", 4, 610, -470, "artifact", "FACE", "An angle that does not belong to light."),
    node("echo-thread", "Threaded Echo", "sleepers-echo", 4, 635, 20, "artifact", "ECHO", "It remembers the voice, not the words."),
    node("ash-letter", "Ash Letter", "ember-catalog", 4, -610, 55, "artifact", "LETTER", "The alphabet after the fire."),
    node("stone-imprint", "Imprint", "vault-witness", 4, -350, 545, "artifact", "IMPRINT", "A hand left without a body."),
    node("aperture-dot", "Point of Seeing", "lens-aperture", 4, 90, 70, "artifact", "POINT", "A point is a room when you get close enough."),
  ];
  const links = [
    { from: "wormhole", to: "observatory", kind: "wormhole" },
    { from: "memory-reef", to: "cinder-archive", kind: "resonance" },
    { from: "observatory", to: "memory-reef", kind: "resonance" },
  ];
  return { nodes, links };
}

function callGraphChildren(parentId) {
  const graph = spatialGraph || {};
  if (graphInstance) {
    try {
      const visits = graphInstance.traverse(parentId, { maxDepth: 1, includeRoot: false, includeWormholes: false });
      if (Array.isArray(visits)) {
        return visits.map((visit) => nodeById.get(visit.id)).filter(Boolean);
      }
    } catch {
      // Fall through to a direct export if a host graph uses a custom shape.
    }
  }
  const fn = graph.childrenOf || graph.getChildren || graph.children;
  if (typeof fn !== "function") return null;
  try {
    const result = fn(parentId, universe.nodes);
    if (!Array.isArray(result)) return null;
    return result.map((item) => typeof item === "string" ? nodeById.get(item) : item).filter(Boolean);
  } catch {
    return null;
  }
}

function childrenOf(parentId) {
  return callGraphChildren(parentId) || universe.nodes.filter((item) => item.parentId === parentId);
}

function semanticLevel(item) {
  const lod = semanticLod || {};
  const fn = lod.getLOD || lod.resolveLOD || lod.computeLOD || lod.semanticLOD || lod.levelOfDetail;
  if (typeof fn === "function") {
    try {
      const result = fn(item, { zoom: renderer.view.zoom, bias: lodBias });
      if (Number.isFinite(result)) return result;
      if (result && Number.isFinite(result.level)) return result.level;
    } catch {
      // Optional adapters are allowed to have a different signature.
    }
  }
  return Math.max(0, 4 - item.depth) + lodBias;
}

function semanticPayload(item) {
  const cacheKey = `${item.id}:${item.description || item.title || ""}`;
  if (semanticCache.has(cacheKey)) return semanticCache.get(cacheKey);
  const summarize = semanticLod?.summarizeSemantic || semanticLod?.summarizeContent || semanticLod?.semanticSummary;
  if (typeof summarize === "function") {
    try {
      const result = summarize({ id: item.id, kind: item.contentKind || "prose", content: item.description || item.title || "" }, { maxLength: 120 });
      semanticCache.set(cacheKey, result);
      return result;
    } catch {
      // The visual shell remains usable if a host swaps in an incompatible adapter.
    }
  }
  const fallback = { summary: item.description || item.title || "", keywords: [item.title || item.id] };
  semanticCache.set(cacheKey, fallback);
  return fallback;
}

function visibleNodes() {
  const active = nodeById.get(activeId);
  if (!active) return [];
  const children = childrenOf(active.id);
  return [active, ...children].map((item) => {
    const summary = semanticPayload(item);
    const childCount = childrenOf(item.id).length;
    return {
      ...item,
      semanticSummary: summary,
      childCount,
      keyword: item.keyword || summary.keywords?.[0] || item.subtitle || item.title,
      bullets: item.bullets || [summary.summary || item.description, `Depth ${item.depth} spatial signal`, `${childCount} nested signals`],
      footprint: item.footprint || (item.depth === 0 ? 420 : item.depth === 1 ? 270 : item.depth === 2 ? 210 : 150),
      semanticLevel: semanticLevel(item),
    };
  });
}

function visibleLinks(nodes) {
  const ids = new Set(nodes.map((item) => item.id));
  const links = nodes.filter((item) => item.parentId && ids.has(item.parentId)).map((item) => ({ from: item.parentId, to: item.id }));
  universe.links.forEach((link) => { if (ids.has(link.from) && ids.has(link.to)) links.push(link); });
  return links;
}

function render() {
  const nodes = visibleNodes();
  renderer.setScene({ nodes, links: visibleLinks(nodes), activeId, selectedId, lodBias });
  renderer.render();
  renderBreadcrumb();
  renderInspector();
  renderMinimap();
  updateHUD(nodes);
  positionEditor();
}

function renderBreadcrumb() {
  const trail = [];
  let cursor = nodeById.get(activeId);
  while (cursor) { trail.unshift(cursor); cursor = cursor.parentId ? nodeById.get(cursor.parentId) : null; }
  const crumb = $("#breadcrumb");
  crumb.replaceChildren();
  trail.forEach((item, index) => {
    const span = document.createElement("span");
    span.className = `crumb-item${index === trail.length - 1 ? " current" : ""}`;
    span.textContent = item.title;
    crumb.append(span);
    if (index < trail.length - 1) {
      const slash = document.createElement("span");
      slash.className = "crumb-slash";
      slash.textContent = "/";
      crumb.append(slash);
    }
  });
}

function renderInspector() {
  const content = $("#inspectorContent");
  const status = $("#selectionStatus");
  const selected = selectedId ? nodeById.get(selectedId) : null;
  if (!selected) {
    content.innerHTML = `<div class="empty-inspector"><div class="empty-orbit"><span></span></div><strong>Select a node</strong><p>Click a constellation to inspect its signal.</p></div>`;
    status.textContent = "No selection";
    return;
  }
  content.innerHTML = `<div class="inspected-type">${escapeHtml(selected.kind)} · L${selected.depth}</div><div class="inspected-title">${escapeHtml(selected.title)}</div><p class="inspected-description">${escapeHtml(selected.description || "No signal note has been recorded.")}</p><div class="inspected-meta"><div class="meta-item"><span class="meta-label">Parent</span><span class="meta-value">${escapeHtml(selected.parentId ? nodeById.get(selected.parentId)?.title || "—" : "origin")}</span></div><div class="meta-item"><span class="meta-label">Children</span><span class="meta-value">${childrenOf(selected.id).length} signals</span></div></div>`;
  status.textContent = selected.id === activeId ? "Active location" : "Selected signal";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function updateHUD(nodes) {
  $("#scaleReadout").textContent = `${Math.round(renderer.view.zoom * 100)}%`;
  $("#lodValue").textContent = `${lodBias >= 0 ? "+" : ""}${lodBias.toFixed(1)}`;
  $("#mapDepth").textContent = `L${nodeById.get(activeId)?.depth || 0}`;
  const stats = renderer.getStats?.() || { rendered: nodes.length, culled: 0 };
  $("#nodeCount").textContent = `${stats.rendered} rendered · ${stats.culled} culled`;
  const relativeScale = `1 : ${Math.max(1, Math.round(1 / Math.max(renderer.view.zoom, 0.01)))}x`;
  const depthReadout = $("#depthReadout");
  if (depthReadout) depthReadout.textContent = `DEPTH L${nodeById.get(activeId)?.depth || 0} · RELATIVE SCALE ${relativeScale}`;
}

function renderMinimap() {
  const map = $("#minimap");
  const context = map.getContext("2d");
  const width = map.width;
  const height = map.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(4,8,15,.9)";
  context.fillRect(0, 0, width, height);
  const pad = 18;
  const minX = Math.min(...universe.nodes.map((item) => item.x)) - 55;
  const maxX = Math.max(...universe.nodes.map((item) => item.x)) + 55;
  const minY = Math.min(...universe.nodes.map((item) => item.y)) - 55;
  const maxY = Math.max(...universe.nodes.map((item) => item.y)) + 55;
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const mapPoint = (item) => ({ x: pad + (item.x - minX) * scale, y: pad + (item.y - minY) * scale });
  const pointForId = (id) => mapPoint(nodeById.get(id));
  context.strokeStyle = "rgba(101,229,232,.16)";
  context.lineWidth = 1;
  universe.nodes.forEach((item) => {
    if (!item.parentId) return;
    const a = mapPoint(item);
    const b = mapPoint(nodeById.get(item.parentId));
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
  });
  universe.links.forEach((link) => {
    const a = pointForId(link.from); const b = pointForId(link.to);
    context.strokeStyle = "rgba(250,115,189,.5)"; context.setLineDash([2, 2]);
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); context.setLineDash([]);
  });
  universe.nodes.forEach((item) => {
    const point = mapPoint(item);
    const active = item.id === activeId;
    const color = item.kind === "portal" ? "#fa73bd" : item.depth === 0 ? "#65e5e8" : item.depth === 1 ? "#a3b4dc" : "#566783";
    context.fillStyle = color;
    context.globalAlpha = active ? 1 : item.depth === 1 ? .85 : .5;
    context.beginPath(); context.arc(point.x, point.y, active ? 3.7 : item.depth <= 1 ? 2.4 : 1.4, 0, Math.PI * 2); context.fill();
    if (active) { context.strokeStyle = "rgba(101,229,232,.7)"; context.globalAlpha = 1; context.beginPath(); context.arc(point.x, point.y, 7, 0, Math.PI * 2); context.stroke(); }
  });
  const view = renderer.getView();
  const worldWidth = view.width / view.zoom;
  const worldHeight = view.height / view.zoom;
  context.strokeStyle = "rgba(229,241,255,.35)";
  context.lineWidth = 1;
  context.strokeRect(pad + (view.x - worldWidth / 2 - minX) * scale, pad + (view.y - worldHeight / 2 - minY) * scale, worldWidth * scale, worldHeight * scale);
  context.globalAlpha = 1;
}

function localPointer(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function selectAt(x, y) {
  const hit = renderer.hitTest(x, y);
  selectedId = hit?.id || null;
  render();
}

async function diveInto(target) {
  if (!target || target.id === activeId) return;
  closeEditor();
  const flash = $("#warpFlash");
  flash.classList.remove("is-active");
  void flash.offsetWidth;
  flash.classList.add("is-active");
  document.body.classList.add("is-diving");
  await renderer.animateTo({ x: target.x, y: target.y, zoom: Math.max(1.25, renderer.view.zoom * 1.55) }, 390, () => renderer.render());
  const destinationId = target.portalTo || target.id;
  activeId = destinationId;
  selectedId = null;
  const destination = nodeById.get(destinationId);
  if (destination) renderer.focus(destination.x, destination.y, destinationId === target.id ? renderer.view.zoom : .88);
  render();
  document.body.classList.remove("is-diving");
  showToast(target.portalTo ? `Through the liminal gate · ${destination?.title || "unknown shore"}` : `Entered ${target.title}`);
}

function goToParent() {
  const active = nodeById.get(activeId);
  if (!active?.parentId) return showToast("Already at the origin layer");
  const parent = nodeById.get(active.parentId);
  activeId = parent.id;
  selectedId = null;
  renderer.focus(parent.x, parent.y, Math.max(.8, renderer.view.zoom * .72));
  render();
  showToast(`Returned to ${parent.title}`);
}

function frameActive() {
  const active = nodeById.get(activeId);
  if (!active) return;
  renderer.animateTo({ x: active.x, y: active.y, zoom: active.depth === 0 ? .82 : 1.05 }, 360, render);
  showToast(`Framed ${active.title}`);
}

function zoomAtCenter(factor) {
  renderer.zoomAt(renderer.width / 2, renderer.height / 2, factor);
  render();
}

function openEditor() {
  const selected = selectedId ? nodeById.get(selectedId) : nodeById.get(activeId);
  if (!selected) return showToast("Select a node before editing");
  selectedId = selected.id;
  $("#editorTitle").value = selected.title;
  $("#editorNotes").value = selected.description || "";
  $("#editorOverlay").hidden = false;
  render();
  positionEditor();
  $("#editorTitle").focus();
  $("#editorTitle").select();
}

function positionEditor() {
  const overlay = $("#editorOverlay");
  if (overlay.hidden || !selectedId) return;
  const selected = nodeById.get(selectedId);
  if (!selected) return;
  const point = renderer.worldToScreen(selected.x, selected.y);
  const halfWidth = 122;
  const x = Math.max(halfWidth + 8, Math.min(renderer.width - halfWidth - 8, point.x));
  const y = Math.max(170, Math.min(renderer.height - 20, point.y));
  overlay.style.left = `${x}px`;
  overlay.style.top = `${y}px`;
}

function saveEditor() {
  const selected = selectedId ? nodeById.get(selectedId) : null;
  if (!selected) return closeEditor();
  selected.title = $("#editorTitle").value.trim() || selected.title;
  selected.description = $("#editorNotes").value.trim() || "No signal note has been recorded.";
  closeEditor();
  render();
  showToast("Signal committed locally");
}

function closeEditor() {
  $("#editorOverlay").hidden = true;
}

function openPalette() {
  const palette = $("#commandPalette");
  const backdrop = $("#paletteBackdrop");
  palette.hidden = false;
  backdrop.hidden = false;
  $("#paletteInput").value = "";
  filterCommands("");
  requestAnimationFrame(() => $("#paletteInput").focus());
}

function closePalette() {
  $("#commandPalette").hidden = true;
  $("#paletteBackdrop").hidden = true;
}

function filterCommands(query) {
  const normalized = query.trim().toLowerCase();
  const nodeCommands = universe.nodes
    .filter((item) => `${item.title} ${item.subtitle || ""} ${item.description || ""}`.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((item) => ({
      label: `Dive: ${item.title}`,
      hint: item.subtitle || `level ${item.depth}`,
      glyph: item.kind === "portal" ? "∞" : "◈",
      shortcut: "↵",
      searchText: `${item.title} ${item.subtitle || ""} ${item.description || ""}`,
      run: () => diveInto(item),
    }));
  filteredCommands = [...commands, ...nodeCommands].filter((command) => `${command.label} ${command.hint} ${command.searchText || ""}`.toLowerCase().includes(normalized));
  paletteIndex = Math.min(paletteIndex, Math.max(0, filteredCommands.length - 1));
  const list = $("#commandList");
  list.replaceChildren();
  filteredCommands.forEach((command, index) => {
    const button = document.createElement("button");
    button.className = `command-item${index === paletteIndex ? " is-active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="command-glyph">${command.glyph}</span><span class="command-label">${escapeHtml(command.label)}</span><span class="command-hint">${escapeHtml(command.hint)}</span><kbd>${escapeHtml(command.shortcut)}</kbd>`;
    button.addEventListener("click", () => executeCommand(index));
    list.append(button);
  });
  if (!filteredCommands.length) list.innerHTML = `<div class="command-hint" style="padding:16px 12px">No command found in this layer.</div>`;
}

function executeCommand(index = paletteIndex) {
  const command = filteredCommands[index];
  if (!command) return;
  closePalette();
  command.run();
}

function showToast(message) {
  const toast = $("#toast");
  $("#toastText").textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType !== "touch") return;
  dragging = true;
  dragMoved = false;
  pointerStart = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (Math.hypot(dx, dy) > 3) dragMoved = true;
  renderer.panBy(dx, dy);
  pointerStart = { x: event.clientX, y: event.clientY };
  render();
});

canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove("is-dragging");
  if (!dragMoved) { const point = localPointer(event); selectAt(point.x, point.y); }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => { dragging = false; canvas.classList.remove("is-dragging"); });

canvas.addEventListener("dblclick", (event) => {
  const point = localPointer(event);
  const hit = renderer.hitTest(point.x, point.y);
  if (hit) { selectedId = hit.id; render(); diveInto(hit); }
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const point = localPointer(event);
  renderer.zoomAt(point.x, point.y, Math.exp(-event.deltaY * .0011));
  render();
}, { passive: false });

$("#minimap").addEventListener("click", (event) => {
  const map = $("#minimap");
  const rect = map.getBoundingClientRect();
  const minX = Math.min(...universe.nodes.map((item) => item.x)) - 55;
  const maxX = Math.max(...universe.nodes.map((item) => item.x)) + 55;
  const minY = Math.min(...universe.nodes.map((item) => item.y)) - 55;
  const maxY = Math.max(...universe.nodes.map((item) => item.y)) + 55;
  const pad = 18;
  const scale = Math.min((map.width - pad * 2) / (maxX - minX), (map.height - pad * 2) / (maxY - minY));
  const world = { x: (event.clientX - rect.left - pad) / scale + minX, y: (event.clientY - rect.top - pad) / scale + minY };
  renderer.focus(world.x, world.y, renderer.view.zoom);
  render();
});

$("#lodBias").addEventListener("input", (event) => { lodBias = Number(event.target.value); render(); });
$("#zoomIn").addEventListener("click", () => zoomAtCenter(1.25));
$("#zoomOut").addEventListener("click", () => zoomAtCenter(.8));
$("#homeButton").addEventListener("click", () => { activeId = "khora"; selectedId = null; frameActive(); render(); });
$("#commandButton").addEventListener("click", openPalette);
$("#closePalette").addEventListener("click", closePalette);
$("#paletteBackdrop").addEventListener("click", closePalette);
$("#paletteInput").addEventListener("input", (event) => { paletteIndex = 0; filterCommands(event.target.value); });
$("#paletteInput").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, filteredCommands.length - 1); filterCommands(event.target.value); }
  if (event.key === "ArrowUp") { event.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); filterCommands(event.target.value); }
  if (event.key === "Enter") { event.preventDefault(); executeCommand(); }
  if (event.key === "Escape") closePalette();
});
$("#closeEditor").addEventListener("click", closeEditor);
$("#cancelEditor").addEventListener("click", closeEditor);
$("#saveEditor").addEventListener("click", saveEditor);
$("#editorTitle").addEventListener("keydown", (event) => { if (event.key === "Enter") saveEditor(); });

window.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); return; }
  if (event.key === "Escape") { if (!$("#commandPalette").hidden) closePalette(); else if (!$("#editorOverlay").hidden) closeEditor(); return; }
  if (typing) return;
  if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAtCenter(1.22); }
  else if (event.key === "-") { event.preventDefault(); zoomAtCenter(.82); }
  else if (event.key === "0") { event.preventDefault(); frameActive(); }
  else if (event.key === "Backspace") { event.preventDefault(); goToParent(); }
  else if (event.key.toLowerCase() === "e") { event.preventDefault(); openEditor(); }
  else if (event.key === "Enter") { event.preventDefault(); diveInto(selectedId ? nodeById.get(selectedId) : null); }
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const amount = 60;
    const delta = { ArrowUp: [0, amount], ArrowDown: [0, -amount], ArrowLeft: [amount, 0], ArrowRight: [-amount, 0] }[event.key];
    renderer.panBy(delta[0], delta[1]); render();
  }
});

window.addEventListener("resize", () => { renderer.resize(); render(); });

// Set the initial framing after layout has established canvas dimensions.
renderer.focus(0, 0, .78);
render();
requestAnimationFrame(() => { renderer.resize(); renderer.focus(0, 0, .78); render(); });
