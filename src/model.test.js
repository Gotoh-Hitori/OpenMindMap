import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  connectNodes,
  createState,
  disconnectEdge,
  layoutState,
  normalizeState,
  removeNode,
  toMermaid,
  updateNode,
  validateState,
} from './model.js';

test('new state has one root and passes validation', () => {
  const state = createState('Idea');
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].id, state.rootId);
  assert.deepEqual(validateState(state), { valid: true, errors: [] });
});

test('legacy parentId saves migrate into explicit edges', () => {
  const migrated = normalizeState({
    rootId: 'root',
    nodes: [
      { id: 'root', label: 'Root', x: 1, y: 2 },
      { id: 'child', label: 'Child', parentId: 'root', x: 3, y: 4, color: 'teal' },
    ],
  });
  assert.equal(migrated.mode, 'mindmap');
  assert.deepEqual(
    migrated.edges.map(({ source, target }) => ({ source, target })),
    [{ source: 'root', target: 'child' }],
  );
  assert.equal(migrated.nodes[1].parentId, 'root');
  assert.equal(migrated.nodes[1].color, 'teal');
});

test('an explicit empty edge array stays empty after unlinking the last tree edge', () => {
  let state = addNode(createState(), { id: 'child', label: 'Child' });
  const edgeId = state.edges[0].id;
  state = disconnectEdge(state, edgeId);
  assert.deepEqual(state.edges, []);
  assert.equal(state.nodes.find(({ id }) => id === 'child').parentId, null);
  assert.deepEqual(normalizeState(state).edges, []);
  state = updateNode(state, 'child', { label: 'Detached' });
  assert.deepEqual(state.edges, []);
});

test('mindmap connections reject root parents, cycles, and multiple parents', () => {
  let state = createState();
  state = addNode(state, { id: 'a', label: 'A' });
  state = addNode(state, { id: 'b', label: 'B', parentId: 'a' });
  assert.throws(() => connectNodes(state, 'b', state.rootId), /root/);
  assert.throws(() => connectNodes(state, 'b', 'a'), /cycle/);
  assert.throws(() => connectNodes(state, state.rootId, 'b'), /one parent/);
});

test('flowchart mode permits cycles and multiple incoming edges', () => {
  let state = { ...createState(), mode: 'flowchart' };
  state = addNode(state, { id: 'a', label: 'A' });
  state = addNode(state, { id: 'b', label: 'B' });
  state = connectNodes(state, 'a', 'b');
  state = connectNodes(state, 'b', 'a');
  state = connectNodes(state, state.rootId, 'b');
  assert.equal(state.edges.length, 4);
  assert.equal(validateState(state).valid, true);
});

test('flowchart addNode connects to its requested parent', () => {
  let state = { ...createState(), mode: 'flowchart' };
  state = addNode(state, { id: 'parent', label: 'Parent', parentId: state.rootId });
  state = addNode(state, { id: 'child', label: 'Child', parentId: 'parent' });
  assert.deepEqual(
    state.edges.map(({ source, target }) => [source, target]),
    [
      [state.rootId, 'parent'],
      ['parent', 'child'],
    ],
  );
});

test('Mermaid output includes detached nodes and escapes syntax characters', () => {
  let state = createState('Root "idea"');
  state = addNode(state, {
    id: 'child',
    label: 'Line <one>\n& two | # [] {} ()',
    shape: 'diamond',
    color: '#abc',
  });
  state = addNode(state, { id: 'detached', label: 'Detached', parentId: null });
  state = disconnectEdge(state, state.edges[0].id);
  const source = toMermaid(state);
  assert.match(source, /Root #quot;idea#quot;/);
  assert.match(source, /Line #lt;one#gt;#10;#amp; two #124; #35; #91;#93; #123;#125; #40;#41;/);
  assert.match(source, /n1\{"Line/);
  assert.match(source, /style n1 fill:#ffffff,stroke:#abc,stroke-width:2px/);
  assert.match(source, /Detached/);
  const mindmap = toMermaid(state, 'mindmap');
  assert.match(mindmap, /disconnected\["未连接节点"\]/);
  assert.match(mindmap, /disconnected[\s\S]*n1\["Line/);
});

test('updates preserve node metadata and positions', () => {
  let state = addNode(createState(), {
    id: 'node-a',
    label: 'Before',
    x: 32,
    y: 48,
    shape: 'diamond',
    color: '#abc',
  });
  state = updateNode(state, 'node-a', { label: 'After' });
  const node = state.nodes.find((item) => item.id === 'node-a');
  assert.equal(node.label, 'After');
  assert.equal(node.x, 32);
  assert.equal(node.y, 48);
  assert.equal(node.shape, 'diamond');
  assert.equal(node.color, '#abc');
});

test('removeNode cascades in mindmap mode and filters graph incident edges', () => {
  let tree = createState();
  tree = addNode(tree, { id: 'a', label: 'A' });
  tree = addNode(tree, { id: 'b', label: 'B', parentId: 'a' });
  assert.deepEqual(
    removeNode(tree, 'a').nodes.map(({ id }) => id),
    [tree.rootId],
  );

  let graph = { ...createState(), mode: 'flowchart' };
  graph = addNode(graph, { id: 'a', label: 'A' });
  graph = addNode(graph, { id: 'b', label: 'B' });
  graph = connectNodes(graph, 'a', 'b');
  graph = removeNode(graph, 'a');
  assert.deepEqual(
    graph.nodes.map(({ id }) => id),
    [graph.rootId, 'b'],
  );
  assert.deepEqual(
    graph.edges.map(({ source, target }) => [source, target]),
    [[graph.rootId, 'b']],
  );
});

test('layout places all graph nodes and safely handles cycles', () => {
  let state = { ...createState(), mode: 'flowchart' };
  state = addNode(state, { id: 'a', label: 'A' });
  state = addNode(state, { id: 'b', label: 'B' });
  state = connectNodes(state, 'a', 'b');
  state = connectNodes(state, 'b', 'a');
  const laidOut = layoutState(state);
  assert.equal(laidOut.nodes.length, 3);
  assert.ok(laidOut.nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.equal(new Set(laidOut.nodes.map(({ x, y }) => `${x},${y}`)).size, laidOut.nodes.length);
});

test('flowchart layout separates converging branches and disconnected nodes', () => {
  let state = { ...createState(), mode: 'flowchart' };
  state = addNode(state, { id: 'left', label: 'Left' });
  state = addNode(state, { id: 'right', label: 'Right' });
  state = addNode(state, { id: 'shared', label: 'Shared' });
  state = addNode(state, { id: 'isolated', label: 'Isolated', parentId: null });
  state = connectNodes(state, state.rootId, 'left');
  state = connectNodes(state, state.rootId, 'right');
  state = connectNodes(state, 'left', 'shared');
  state = connectNodes(state, 'right', 'shared');

  const laidOut = layoutState(state);
  const rows = laidOut.nodes.map(({ y }) => y);
  assert.equal(new Set(rows).size, rows.length);
  assert.ok(laidOut.nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
});

test('untrusted imported states reject duplicate IDs and dangling edges', () => {
  const base = createState('Import');
  const node = { id: 'child', label: 'Child' };
  assert.equal(
    validateState({
      ...base,
      nodes: [...base.nodes, node, { ...node }],
    }).valid,
    false,
  );
  assert.equal(
    validateState({
      ...base,
      edges: [{ id: 'dangling', source: base.rootId, target: 'missing' }],
    }).valid,
    false,
  );
  assert.throws(
    () => normalizeState({ ...base, nodes: [...base.nodes, { id: 'bad', label: 17 }] }),
    /label/,
  );
});

test('normalization and updates preserve extra state, node, and edge metadata', () => {
  const state = normalizeState({
    ...createState('Root'),
    documentTag: { source: 'imported' },
    nodes: [
      { id: 'root', label: 'Root', x: 0, y: 0, note: 'keep me' },
      { id: 'child', label: 'Child', parentId: 'root', custom: 42 },
    ],
    rootId: 'root',
    edges: [{ id: 'custom-edge', source: 'root', target: 'child', relation: 'supports' }],
  });
  const updated = updateNode(state, 'child', { label: 'Updated' });
  assert.deepEqual(updated.documentTag, { source: 'imported' });
  assert.equal(updated.nodes[0].note, 'keep me');
  assert.equal(updated.nodes[1].custom, 42);
  assert.equal(updated.edges[0].relation, 'supports');
});

test('cycle detection finds a path through multiple outgoing edges', () => {
  let state = createState('Root');
  state = addNode(state, { id: 'a', label: 'A' });
  state = addNode(state, { id: 'b', label: 'B', parentId: 'a' });
  state = addNode(state, { id: 'c', label: 'C', parentId: 'b' });
  assert.throws(() => connectNodes(state, 'c', 'a'), /cycle/);
  assert.equal(state.edges.length, 3);
});
