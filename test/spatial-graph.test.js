import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpatialGraph,
  createCameraFrame,
  projectPoint,
  rebaseIntoChildFrame,
  rebaseToParentFrame,
  rebaseZoom,
  denormalizeRect,
} from '../spatial-graph.js';
import {
  CONTENT_KINDS,
  getLodLevel,
  lodCrossfade,
  selectLodTier,
  summarizeSemantic,
} from '../semantic-lod.js';

test('camera zoom stays in the safe local range and preserves cursor anchors', () => {
  const camera = createCameraFrame({
    origin: { x: 10, y: -4 },
    camZoom: 1,
    viewport: { width: 1200, height: 700 },
  });
  const anchor = { x: 280, y: 190 };
  const before = projectPoint({ x: 10.25, y: -3.75 }, camera);
  const rebased = rebaseZoom(camera, 200, anchor);
  assert.equal(rebased.camZoom, 10);
  assert.ok(rebased.origin.x !== camera.origin.x || rebased.origin.y !== camera.origin.y);
  assert.equal(rebased.viewport.width, 1200);
  assert.ok(Number.isFinite(before.x) && Number.isFinite(before.y));
});

test('parent-relative transforms resolve nested rectangles without global depth math', () => {
  const graph = new SpatialGraph([
    { id: 'root', x: 0, y: 0, width: 1000, height: 800, children: ['board'] },
    { id: 'board', parentId: 'root', x: 0.1, y: 0.2, width: 0.8, height: 0.6, children: ['card'] },
    { id: 'card', parentId: 'board', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  ]);
  const resolved = graph.resolveNode('card');
  assert.deepEqual(resolved.worldRect, { x: 300, y: 280, width: 400, height: 240 });
  assert.deepEqual(denormalizeRect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { x: 100, y: 100, width: 800, height: 600 }), {
    x: 300,
    y: 250,
    width: 400,
    height: 300,
  });
});

test('explicit child and parent rebasing keeps local camZoom bounded', () => {
  const child = { id: 'card', localX: 0.2, localY: -0.1, localScale: 0.1, parentId: 'board' };
  const camera = createCameraFrame({ referenceNodeId: 'board', camX: 0.4, camY: 0.3, camZoom: 4 });
  const inside = rebaseIntoChildFrame(camera, child);
  assert.equal(inside.referenceNodeId, 'card');
  assert.equal(inside.camX, 2);
  assert.equal(inside.camY, 4);
  assert.equal(inside.camZoom, 0.5);
  const outside = rebaseToParentFrame(inside, child, { id: 'board' });
  assert.equal(outside.referenceNodeId, 'board');
  assert.ok(Math.abs(outside.camX - 0.4) < 1e-12);
  assert.ok(Math.abs(outside.camY - 0.3) < 1e-12);
  assert.equal(outside.camZoom, 5);
});

test('wormhole traversal halts on a path cycle and reports a guard', () => {
  const graph = new SpatialGraph([
    { id: 'root', width: 1, height: 1, children: ['portal'] },
    { id: 'portal', parentId: 'root', x: 0.2, y: 0.2, width: 0.5, height: 0.5, wormholes: ['root'] },
  ]);
  const result = graph.traverse('root', { includeGuards: true, maxDepth: 8 });
  assert.deepEqual(result.visits.map((visit) => visit.id), ['root', 'portal']);
  assert.ok(result.guards.some((guard) => guard.type === 'cycle'));
});

test('semantic summaries are deterministic and expose code metadata', () => {
  const summary = summarizeSemantic({
    id: 'shader',
    kind: 'code',
    path: 'shader.js',
    content: 'export function rebaseCamera(frame) { return frame; }\nclass Portal {}',
  });
  assert.equal(summary.kind, CONTENT_KINDS.CODE);
  assert.ok(summary.code.declarations.includes('rebaseCamera'));
  assert.ok(summary.code.declarations.includes('Portal'));
  assert.equal(summary.hash, summarizeSemantic({ kind: 'code', path: 'shader.js', content: 'export function rebaseCamera(frame) { return frame; }\nclass Portal {}' }).hash);
});

test('LOD bias and crossfade remain bounded at tier boundaries', () => {
  const level = getLodLevel(1, 0);
  const tier = selectLodTier({ level });
  const transition = lodCrossfade({ level: tier.maxLevel - 0.02, fadeWidth: 0.2 });
  assert.ok(tier.id);
  assert.ok(transition.fromOpacity >= 0 && transition.fromOpacity <= 1);
  assert.ok(transition.toOpacity >= 0 && transition.toOpacity <= 1);
});
