/**
 * Spatial primitives for KhoraZ.
 *
 * A node's x/y/width/height are normalized to its parent's rectangle.  Root
 * nodes are expressed in the graph's world units.  The module deliberately
 * keeps the data model plain so a renderer can store its own metadata beside
 * the spatial fields.
 */

export const MIN_CAM_ZOOM = 0.5;
export const MAX_CAM_ZOOM = 10;
export const DEFAULT_CAM_ZOOM = 1;
export const DEFAULT_MAX_TRAVERSAL_DEPTH = 32;

const EPSILON = 1e-9;

const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const nonNegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));

const asPoint = (point, fallback = { x: 0, y: 0 }) => ({
  x: finite(point?.x, fallback.x),
  y: finite(point?.y, fallback.y),
});

const asSize = (size, fallback = { width: 1, height: 1 }) => ({
  width: nonNegative(size?.width, fallback.width),
  height: nonNegative(size?.height, fallback.height),
});

const asRect = (rect, fallback = { x: 0, y: 0, width: 1, height: 1 }) => ({
  x: finite(rect?.x, fallback.x),
  y: finite(rect?.y, fallback.y),
  width: nonNegative(rect?.width, fallback.width),
  height: nonNegative(rect?.height, fallback.height),
});

const cloneRect = (rect) => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

const clonePoint = (point) => ({ x: point.x, y: point.y });

const idOf = (id) => (id === undefined || id === null ? null : String(id));

const readRect = (value, fallback) => {
  if (value?.rect) return asRect(value.rect, fallback);
  const position = value?.position ?? value;
  const size = value?.size ?? value;
  return asRect(
    {
      x: position?.x,
      y: position?.y,
      width: size?.width,
      height: size?.height,
    },
    fallback,
  );
};

/** Keep a camera zoom within the supported range. */
export function clampCamZoom(zoom, fallback = DEFAULT_CAM_ZOOM) {
  const value = finite(zoom, fallback);
  return Math.min(MAX_CAM_ZOOM, Math.max(MIN_CAM_ZOOM, value));
}

/** Alias useful to callers that do not use the camera-specific name. */
export const clampZoom = clampCamZoom;

/**
 * Convert a world-space point into coordinates relative to a parent rect.
 * The result is normalized: (0, 0) is the parent's top-left and (1, 1) its
 * bottom-right.
 */
export function normalizePoint(point, parentRect) {
  const source = asPoint(point);
  const parent = asRect(parentRect);
  return {
    x: parent.width > EPSILON ? (source.x - parent.x) / parent.width : 0,
    y: parent.height > EPSILON ? (source.y - parent.y) / parent.height : 0,
  };
}

/** Convert a parent-relative normalized point back into world units. */
export function denormalizePoint(normalizedPoint, parentRect) {
  const source = asPoint(normalizedPoint);
  const parent = asRect(parentRect);
  return {
    x: parent.x + source.x * parent.width,
    y: parent.y + source.y * parent.height,
  };
}

/** Convert a world-space rectangle into a parent-relative normalized rect. */
export function normalizeRect(rect, parentRect) {
  const source = asRect(rect);
  const parent = asRect(parentRect);
  return {
    x: parent.width > EPSILON ? (source.x - parent.x) / parent.width : 0,
    y: parent.height > EPSILON ? (source.y - parent.y) / parent.height : 0,
    width: parent.width > EPSILON ? source.width / parent.width : 0,
    height: parent.height > EPSILON ? source.height / parent.height : 0,
  };
}

/** Convert a normalized child rectangle into world units. */
export function denormalizeRect(normalizedRect, parentRect) {
  const source = asRect(normalizedRect);
  const parent = asRect(parentRect);
  return {
    x: parent.x + source.x * parent.width,
    y: parent.y + source.y * parent.height,
    width: source.width * parent.width,
    height: source.height * parent.height,
  };
}

/**
 * Make a camera reference frame. `origin` is the world point at the center
 * of the viewport. Keeping that point explicit makes zoom-origin rebasing
 * independent of any renderer or DOM coordinate system.
 */
export function createCameraFrame(options = {}) {
  const viewport = asSize(
    options.viewport ?? {
      width: options.viewportWidth ?? options.width,
      height: options.viewportHeight ?? options.height,
    },
    { width: 1, height: 1 },
  );
  const origin = asPoint(options.origin ?? options.position ?? options.center ?? {
    x: options.x,
    y: options.y,
  });
  const camZoom = clampCamZoom(options.camZoom ?? options.zoom);
  return {
    origin,
    camZoom,
    viewport,
  };
}

export const createCamera = createCameraFrame;
export const createReferenceFrame = createCameraFrame;

/** Return a camera frame with an updated viewport, preserving its origin. */
export function resizeCamera(camera, viewportOrWidth, height) {
  const viewport =
    typeof viewportOrWidth === 'object'
      ? asSize(viewportOrWidth, camera?.viewport)
      : asSize({ width: viewportOrWidth, height }, camera?.viewport);
  return {
    ...createCameraFrame(camera),
    viewport,
  };
}

/**
 * Project a world point into viewport pixels. The camera origin maps to the
 * viewport center, which is stable even when the viewport is resized.
 */
export function projectPoint(worldPoint, camera) {
  const frame = createCameraFrame(camera);
  const point = asPoint(worldPoint);
  return {
    x: (point.x - frame.origin.x) * frame.camZoom + frame.viewport.width / 2,
    y: (point.y - frame.origin.y) * frame.camZoom + frame.viewport.height / 2,
  };
}

export const worldToScreen = projectPoint;
export const projectToScreen = projectPoint;

/** Convert viewport pixels into world coordinates. */
export function unprojectPoint(screenPoint, camera) {
  const frame = createCameraFrame(camera);
  const point = asPoint(screenPoint);
  return {
    x: frame.origin.x + (point.x - frame.viewport.width / 2) / frame.camZoom,
    y: frame.origin.y + (point.y - frame.viewport.height / 2) / frame.camZoom,
  };
}

export const screenToWorld = unprojectPoint;

/** Project an axis-aligned world rectangle into screen space. */
export function projectRect(worldRect, camera) {
  const rect = asRect(worldRect);
  const topLeft = projectPoint({ x: rect.x, y: rect.y }, camera);
  const bottomRight = projectPoint(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    camera,
  );
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  };
}

export const worldRectToScreen = projectRect;
export const projectToScreenRect = projectRect;

/**
 * Rebase a zoom around a screen-space anchor. The world point under the
 * anchor remains fixed, so wheel/pinch zoom feels attached to the cursor.
 * The returned frame is new; pass `{ mutate: true }` to update the input.
 */
export function rebaseZoom(camera, nextZoom, anchor, options = {}) {
  const frame = createCameraFrame(camera);
  const screenAnchor = asPoint(
    anchor ?? {
      x: frame.viewport.width / 2,
      y: frame.viewport.height / 2,
    },
  );
  const worldAnchor = unprojectPoint(screenAnchor, frame);
  const camZoom = clampCamZoom(nextZoom, frame.camZoom);
  const viewportCenter = {
    x: frame.viewport.width / 2,
    y: frame.viewport.height / 2,
  };
  const origin = {
    x: worldAnchor.x - (screenAnchor.x - viewportCenter.x) / camZoom,
    y: worldAnchor.y - (screenAnchor.y - viewportCenter.y) / camZoom,
  };
  const result = { ...frame, origin, camZoom };
  if (options.mutate && camera && typeof camera === 'object') {
    camera.origin = clonePoint(origin);
    camera.camZoom = camZoom;
    camera.viewport = { ...frame.viewport };
    return camera;
  }
  return result;
}

/** Zoom by a multiplicative factor while preserving the anchor. */
export function zoomCamera(camera, factor, anchor, options = {}) {
  const multiplier = finite(factor, 1);
  if (multiplier <= 0) return createCameraFrame(camera);
  return rebaseZoom(camera, createCameraFrame(camera).camZoom * multiplier, anchor, options);
}

export function zoomIn(camera, factor = 1.2, anchor, options = {}) {
  return zoomCamera(camera, Math.abs(factor), anchor, options);
}

export function zoomOut(camera, factor = 1.2, anchor, options = {}) {
  const multiplier = Math.abs(factor);
  return zoomCamera(camera, multiplier > EPSILON ? 1 / multiplier : 1, anchor, options);
}

/** Set an absolute zoom while retaining the screen point under the anchor. */
export const setCameraZoom = rebaseZoom;
export const zoomAt = zoomCamera;

/** A small, renderer-friendly rectangle intersection helper. */
export function rectIntersects(a, b, margin = 0) {
  const first = asRect(a);
  const second = asRect(b);
  const padding = Math.max(0, finite(margin));
  return (
    first.x < second.x + second.width + padding &&
    first.x + first.width > second.x - padding &&
    first.y < second.y + second.height + padding &&
    first.y + first.height > second.y - padding
  );
}

export function isRectVisible(worldRect, camera, margin = 0) {
  const frame = createCameraFrame(camera);
  const screenRect = projectRect(worldRect, frame);
  return rectIntersects(screenRect, {
    x: 0,
    y: 0,
    width: frame.viewport.width,
    height: frame.viewport.height,
  }, margin);
}

export function normalizeNode(node, fallbackId = 'node') {
  const source = node ?? {};
  const rect = readRect(source, { x: 0, y: 0, width: 1, height: 1 });
  const id = idOf(source.id) ?? fallbackId;
  const children = Array.isArray(source.children)
    ? source.children.map(idOf).filter((childId) => childId !== null)
    : [];
  const wormholes = source.wormholes ?? source.wormhole ?? source.portals ?? [];
  const wormholeList = Array.isArray(wormholes) ? wormholes : [wormholes];
  return {
    ...source,
    id,
    parentId: idOf(source.parentId ?? source.parent),
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    children,
    wormholes: wormholeList
      .map((entry) => (typeof entry === 'object' ? idOf(entry.targetId ?? entry.target ?? entry.id) : idOf(entry)))
      .filter((targetId) => targetId !== null),
  };
}

const childIdsFor = (nodes, node) => {
  const ids = [];
  for (const childId of node.children) {
    if (nodes.has(childId) && !ids.includes(childId)) ids.push(childId);
  }
  for (const [candidateId, candidate] of nodes) {
    if (candidate.parentId === node.id && !ids.includes(candidateId)) ids.push(candidateId);
  }
  return ids;
};

/**
 * A small mutable graph wrapper. It does not impose a rendering lifecycle;
 * callers can update nodes and ask for resolved/cullable visits each frame.
 */
export class SpatialGraph {
  constructor(nodes = []) {
    this.nodes = new Map();
    if (nodes instanceof Map) {
      for (const node of nodes.values()) this.addNode(node);
    } else if (Array.isArray(nodes)) {
      for (const node of nodes) this.addNode(node);
    } else if (nodes && typeof nodes === 'object') {
      for (const [id, node] of Object.entries(nodes)) this.addNode({ ...node, id: node?.id ?? id });
    }
  }

  addNode(node) {
    const fallbackId = `node-${this.nodes.size + 1}`;
    const normalized = normalizeNode(node, fallbackId);
    if (this.nodes.has(normalized.id)) throw new Error(`Spatial node already exists: ${normalized.id}`);
    this.nodes.set(normalized.id, normalized);
    return normalized;
  }

  upsertNode(node) {
    const fallbackId = `node-${this.nodes.size + 1}`;
    const normalized = normalizeNode(node, fallbackId);
    this.nodes.set(normalized.id, normalized);
    return normalized;
  }

  updateNode(id, patch) {
    const key = idOf(id);
    const current = this.nodes.get(key);
    if (!current) return undefined;
    const next = normalizeNode({ ...current, ...patch, id: key }, key);
    this.nodes.set(key, next);
    return next;
  }

  removeNode(id) {
    return this.nodes.delete(idOf(id));
  }

  getNode(id) {
    return this.nodes.get(idOf(id));
  }

  hasNode(id) {
    return this.nodes.has(idOf(id));
  }

  /** Resolve one node through its parent chain, guarding malformed cycles. */
  resolveNode(id, options = {}) {
    const key = idOf(id);
    const node = this.nodes.get(key);
    if (!node) return undefined;
    const maxDepth = Math.max(0, Math.floor(finite(options.maxDepth, DEFAULT_MAX_TRAVERSAL_DEPTH)));
    const chain = [];
    const path = new Set();
    let current = node;
    let depth = 0;
    let cycle = false;
    while (current) {
      if (path.has(current.id)) {
        cycle = true;
        break;
      }
      path.add(current.id);
      chain.push(current);
      if (current.parentId === null) break;
      if (depth >= maxDepth) break;
      current = this.nodes.get(current.parentId);
      if (!current) break;
      depth += 1;
    }
    let worldRect = asRect(chain[chain.length - 1]);
    for (let index = chain.length - 2; index >= 0; index -= 1) {
      worldRect = denormalizeRect(chain[index], worldRect);
    }
    return {
      id: node.id,
      node,
      worldRect,
      parentPath: chain.map((entry) => entry.id),
      depth: chain.length - 1,
      cycle,
      truncated: !cycle && chain.at(-1)?.parentId !== null && chain.at(-1)?.parentId !== undefined,
    };
  }

  /**
   * Visit a graph branch. The path set is copied at each branch so repeated
   * nodes are valid across independent paths while wormhole cycles are not.
   * Guard records are returned when `includeGuards` is enabled.
   */
  traverse(rootId, options = {}) {
    const root = idOf(rootId);
    const maxDepth = Math.max(0, Math.floor(finite(options.maxDepth, DEFAULT_MAX_TRAVERSAL_DEPTH)));
    const maxVisits = Math.max(1, Math.floor(finite(options.maxVisits, 10000)));
    const includeRoot = options.includeRoot !== false;
    const includeWormholes = options.includeWormholes !== false;
    const includeGuards = options.includeGuards === true;
    const visits = [];
    const guards = [];
    const visit = (id, depth, path, viaWormhole = false) => {
      if (visits.length >= maxVisits) {
        const guard = { type: 'max-visits', id, depth, path: [...path] };
        guards.push(guard);
        return;
      }
      if (path.has(id)) {
        const guard = { type: 'cycle', id, depth, path: [...path] };
        guards.push(guard);
        return;
      }
      if (depth > maxDepth) {
        const guard = { type: 'max-depth', id, depth, path: [...path] };
        guards.push(guard);
        return;
      }
      const node = this.nodes.get(id);
      if (!node) {
        const guard = { type: 'missing-node', id, depth, path: [...path] };
        guards.push(guard);
        return;
      }
      const nextPath = new Set(path);
      nextPath.add(id);
      const resolved = this.resolveNode(id, { maxDepth });
      const visitRecord = {
        ...resolved,
        depth,
        path: [...nextPath],
        viaWormhole,
      };
      if (includeRoot || depth > 0) visits.push(visitRecord);

      if (depth >= maxDepth) {
        if (childIdsFor(this.nodes, node).length || (includeWormholes && node.wormholes.length)) {
          guards.push({ type: 'max-depth', id, depth: depth + 1, path: [...nextPath] });
        }
        return;
      }
      for (const childId of childIdsFor(this.nodes, node)) {
        visit(childId, depth + 1, nextPath, false);
      }
      if (includeWormholes) {
        for (const targetId of node.wormholes) {
          visit(targetId, depth + 1, nextPath, true);
        }
      }
    };

    if (root !== null) visit(root, 0, new Set());
    if (includeGuards) return { visits, guards };
    return visits;
  }

  /** Resolve and project a branch, returning only screen-visible visits. */
  cull(camera, options = {}) {
    const rootId = options.rootId ?? options.root ?? [...this.nodes.keys()][0];
    const traversal = this.traverse(rootId, options);
    const visits = Array.isArray(traversal) ? traversal : traversal.visits;
    const margin = Math.max(0, finite(options.margin, 0));
    const frame = createCameraFrame(camera);
    const visible = visits
      .map((visit) => ({
        ...visit,
        screenRect: projectRect(visit.worldRect, frame),
      }))
      .filter((visit) => rectIntersects(visit.screenRect, {
        x: 0,
        y: 0,
        width: frame.viewport.width,
        height: frame.viewport.height,
      }, margin));
    if (Array.isArray(traversal)) return visible;
    return { visits: visible, guards: traversal.guards };
  }

  visible(camera, options = {}) {
    return this.cull(camera, options);
  }
}

export function createSpatialGraph(nodes = []) {
  return new SpatialGraph(nodes);
}

export default SpatialGraph;
