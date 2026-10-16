const TAU = Math.PI * 2;

const PALETTE = {
  universe: { fill: "#65e5e8", edge: "#b3ffff", glow: "rgba(101,229,232,.72)" },
  constellation: { fill: "#6ce3e2", edge: "#b1ffff", glow: "rgba(101,229,232,.62)" },
  reef: { fill: "#ae8cff", edge: "#d7c8ff", glow: "rgba(174,140,255,.65)" },
  archive: { fill: "#ffc56b", edge: "#ffe2a9", glow: "rgba(255,197,107,.62)" },
  chamber: { fill: "#83b9ef", edge: "#c0ddff", glow: "rgba(131,185,239,.52)" },
  artifact: { fill: "#9ba8c7", edge: "#d0d8ea", glow: "rgba(131,159,206,.42)" },
  portal: { fill: "#fa73bd", edge: "#ffc2e3", glow: "rgba(250,115,189,.78)" },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function colorFor(node) {
  if (node.color) return { fill: node.color, edge: node.color, glow: `${node.color}99` };
  return PALETTE[node.kind] || PALETTE.artifact;
}

/**
 * Small canvas renderer for the spatial shell. The scene format is deliberately
 * plain: { nodes: [{ id, x, y, radius, kind, title }], links: [{ from, to }] }.
 * A graph implementation can feed it directly without taking over view state.
 */
export class SpatialRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.view = { x: 0, y: 0, zoom: 1 };
    this.scene = { nodes: [], links: [], activeId: null, lodBias: 0 };
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.lastFrame = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  setScene(scene = {}) {
    this.scene = {
      nodes: scene.nodes || [],
      links: scene.links || [],
      activeId: scene.activeId || null,
      selectedId: scene.selectedId || null,
      lodBias: Number(scene.lodBias || 0),
    };
  }

  setView(next = {}) {
    if (Number.isFinite(next.x)) this.view.x = next.x;
    if (Number.isFinite(next.y)) this.view.y = next.y;
    if (Number.isFinite(next.zoom)) this.view.zoom = clamp(next.zoom, 0.08, 5);
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.view.x) * this.view.zoom + this.width / 2,
      y: (y - this.view.y) * this.view.zoom + this.height / 2,
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.width / 2) / this.view.zoom + this.view.x,
      y: (y - this.height / 2) / this.view.zoom + this.view.y,
    };
  }

  panBy(screenDx, screenDy) {
    this.view.x -= screenDx / this.view.zoom;
    this.view.y -= screenDy / this.view.zoom;
  }

  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.view.zoom = clamp(this.view.zoom * factor, 0.08, 5);
    const after = this.screenToWorld(screenX, screenY);
    this.view.x += before.x - after.x;
    this.view.y += before.y - after.y;
  }

  focus(x, y, zoom = this.view.zoom) {
    this.setView({ x, y, zoom });
  }

  fitToNodes(nodes = [], padding = 170) {
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y));
    const spanX = Math.max(300, maxX - minX + padding * 2);
    const spanY = Math.max(220, maxY - minY + padding * 2);
    this.setView({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: clamp(Math.min(this.width / spanX, this.height / spanY), 0.08, 2),
    });
  }

  hitTest(screenX, screenY) {
    let hit = null;
    let nearest = Infinity;
    for (const node of this.scene.nodes) {
      const point = this.worldToScreen(node.x, node.y);
      const radius = this.nodeRadius(node) + 10;
      const distance = Math.hypot(point.x - screenX, point.y - screenY);
      if (distance <= radius && distance < nearest) {
        hit = node;
        nearest = distance;
      }
    }
    return hit;
  }

  nodeRadius(node) {
    const base = node.radius || (node.depth === 0 ? 18 : node.depth === 1 ? 13 : node.depth === 2 ? 10 : 7);
    return clamp(base * Math.pow(this.view.zoom, 0.25), 3.2, 22);
  }

  animateTo(target, duration = 420, onFrame = () => {}) {
    const start = { ...this.view };
    const end = {
      x: Number.isFinite(target.x) ? target.x : start.x,
      y: Number.isFinite(target.y) ? target.y : start.y,
      zoom: Number.isFinite(target.zoom) ? clamp(target.zoom, 0.08, 5) : start.zoom,
    };
    const startTime = performance.now();
    return new Promise((resolve) => {
      const tick = (time) => {
        const progress = clamp((time - startTime) / duration, 0, 1);
        const eased = easeInOutCubic(progress);
        this.setView({
          x: start.x + (end.x - start.x) * eased,
          y: start.y + (end.y - start.y) * eased,
          zoom: start.zoom + (end.zoom - start.zoom) * eased,
        });
        onFrame();
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  drawGrid(ctx) {
    const zoom = this.view.zoom;
    const rawStep = 72 / zoom;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
    const choices = [1, 2, 5, 10];
    const step = choices.find((choice) => rawStep <= choice * magnitude) * magnitude;
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.width, this.height);
    const startX = Math.floor(topLeft.x / step) * step;
    const startY = Math.floor(topLeft.y / step) * step;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(132,159,204,.055)";
    ctx.beginPath();
    for (let x = startX; x <= bottomRight.x + step; x += step) {
      const screen = this.worldToScreen(x, 0).x;
      ctx.moveTo(Math.round(screen) + 0.5, 0);
      ctx.lineTo(Math.round(screen) + 0.5, this.height);
    }
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      const screen = this.worldToScreen(0, y).y;
      ctx.moveTo(0, Math.round(screen) + 0.5);
      ctx.lineTo(this.width, Math.round(screen) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawLink(ctx, link, lookup) {
    const from = lookup.get(link.from);
    const to = lookup.get(link.to);
    if (!from || !to) return;
    const a = this.worldToScreen(from.x, from.y);
    const b = this.worldToScreen(to.x, to.y);
    const isPortal = link.kind === "wormhole" || from.kind === "portal" || to.kind === "portal";
    ctx.save();
    if (isPortal) {
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const bend = Math.min(100, Math.hypot(dx, dy) * 0.23);
      const length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length;
      const ny = dx / length;
      ctx.strokeStyle = "rgba(250,115,189,.4)";
      ctx.shadowColor = "rgba(250,115,189,.65)";
      ctx.shadowBlur = 12;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 8]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(midX + nx * bend, midY + ny * bend, b.x, b.y);
      ctx.stroke();
    } else {
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gradient.addColorStop(0, "rgba(101,229,232,.34)");
      gradient.addColorStop(0.5, "rgba(141,169,220,.16)");
      gradient.addColorStop(1, "rgba(174,140,255,.32)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(168,191,238,.45)";
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * .58, a.y + (b.y - a.y) * .58, 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawPortal(ctx, x, y, radius, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.lastFrame / 5000);
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.beginPath();
      ctx.ellipse(0, 0, radius + 5 + ring * 4, radius * .54 + ring * 2.3, ring * .32, 0, TAU);
      ctx.strokeStyle = ring === 0 ? color.edge : color.fill;
      ctx.globalAlpha = .82 - ring * .18;
      ctx.lineWidth = ring === 0 ? 1.5 : 1;
      ctx.shadowColor = color.glow;
      ctx.shadowBlur = 12;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNode(ctx, node) {
    const point = this.worldToScreen(node.x, node.y);
    const radius = this.nodeRadius(node);
    if (point.x < -radius * 4 || point.x > this.width + radius * 4 || point.y < -radius * 4 || point.y > this.height + radius * 4) return;
    const color = colorFor(node);
    const selected = node.id === this.scene.selectedId;
    const active = node.id === this.scene.activeId;
    ctx.save();
    ctx.translate(point.x, point.y);
    if (node.kind === "portal") this.drawPortal(ctx, 0, 0, radius, color);
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = active ? 25 : selected ? 20 : 13;
    const gradient = ctx.createRadialGradient(-radius * .25, -radius * .35, 1, 0, 0, radius * 1.3);
    gradient.addColorStop(0, color.edge);
    gradient.addColorStop(.42, color.fill);
    gradient.addColorStop(1, "#172238");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color.edge;
    ctx.globalAlpha = .9;
    ctx.lineWidth = active ? 1.4 : 1;
    ctx.stroke();
    if (node.kind === "universe") {
      ctx.strokeStyle = "rgba(226,255,255,.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, radius * .52, 0, TAU);
      ctx.stroke();
    } else if (node.kind === "archive") {
      ctx.strokeStyle = "rgba(41,25,7,.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-radius * .35, 0); ctx.lineTo(radius * .35, 0);
      ctx.moveTo(0, -radius * .35); ctx.lineTo(0, radius * .35);
      ctx.stroke();
    } else if (node.kind === "artifact") {
      ctx.fillStyle = "rgba(234,241,255,.8)";
      ctx.fillRect(-1, -1, 2, 2);
    }
    if (active || selected) {
      ctx.strokeStyle = active ? "rgba(101,229,232,.55)" : "rgba(255,255,255,.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash(active ? [2, 4] : [1, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6 + (active ? Math.sin(this.lastFrame / 380) * 1.8 : 0), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const labelThreshold = 8 - this.scene.lodBias * 2;
    const shouldLabel = node.labelVisible !== false && (radius >= labelThreshold || node.depth <= 1 || selected || active);
    if (shouldLabel) {
      const title = node.title || node.name || node.id;
      const fontSize = node.depth <= 1 ? 11 : 10;
      ctx.font = `${node.depth <= 1 ? 600 : 500} ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = active ? "#e7ffff" : selected ? "#f2f5ff" : "rgba(197,210,236,.82)";
      ctx.shadowColor = "rgba(3,5,10,.95)";
      ctx.shadowBlur = 5;
      ctx.fillText(title, 0, radius + 8);
      if (node.subtitle && (active || selected || node.depth <= 1) && this.view.zoom > .32) {
        ctx.font = "9px Inter, system-ui, sans-serif";
        ctx.fillStyle = "rgba(126,143,178,.86)";
        ctx.fillText(node.subtitle, 0, radius + 22);
      }
    }
    ctx.restore();
  }

  render(time = performance.now()) {
    this.lastFrame = time;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const background = ctx.createRadialGradient(this.width * .5, this.height * .47, 0, this.width * .5, this.height * .47, Math.max(this.width, this.height) * .8);
    background.addColorStop(0, "rgba(18,30,49,.28)");
    background.addColorStop(.55, "rgba(7,11,19,.1)");
    background.addColorStop(1, "rgba(2,4,8,.32)");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid(ctx);
    const lookup = new Map(this.scene.nodes.map((node) => [node.id, node]));
    for (const link of this.scene.links) this.drawLink(ctx, link, lookup);
    [...this.scene.nodes].sort((a, b) => (a.depth || 0) - (b.depth || 0)).forEach((node) => this.drawNode(ctx, node));
    if (this.scene.animate) requestAnimationFrame((nextTime) => this.render(nextTime));
  }

  getView() {
    return { ...this.view, width: this.width, height: this.height };
  }
}

export function createSpatialRenderer(canvas) {
  return new SpatialRenderer(canvas);
}
