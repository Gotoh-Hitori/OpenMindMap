import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramToState } from './mermaid-import.js';

function flowDiagram(vertices, edges, extra = {}) {
  return {
    getType: () => 'flowchart-v2',
    db: {
      getVertices: () => new Map(vertices.map((vertex) => [vertex.id, vertex])),
      getEdges: () => edges,
      getSubGraphs: () => extra.subgraphs || [],
      getData: () => ({ nodes: extra.dataNodes || [], edges: extra.dataEdges || [] }),
    },
  };
}

test('imports complete flowcharts, labels, styles, shapes, cycles, and parallel edges', () => {
  const diagram = flowDiagram(
    [
      {
        id: 'A',
        text: 'Root #amp; #quot;#lt;tag#gt; #35; #91;',
        type: 'circle',
        styles: ['stroke:#123456'],
      },
      { id: 'B', text: 'B', type: 'diamond' },
      { id: 'C', text: 'C', type: 'round' },
      { id: 'alone', text: 'Detached' },
    ],
    [
      { id: 'L1', start: 'A', end: 'B', text: 'yes #amp; sure', arrowTypeEnd: 'arrow_point' },
      { id: 'L2', start: 'A', end: 'B', text: 'parallel' },
      { id: 'L3', start: 'B', end: 'B', text: 'loop' },
      { id: 'L4', start: 'C', end: 'A', text: '' },
    ],
  );

  const state = diagramToState(diagram);
  assert.equal(state.mode, 'flowchart');
  assert.equal(state.rootId, 'A');
  assert.deepEqual(
    state.nodes.map((node) => node.id),
    ['A', 'B', 'C', 'alone'],
  );
  assert.equal(state.nodes[0].label, 'Root & "<tag> # [');
  assert.equal(state.nodes[0].shape, 'circle');
  assert.equal(state.nodes[0].color, '#123456');
  assert.equal(state.nodes[1].shape, 'diamond');
  assert.equal(state.nodes[2].shape, 'rounded');
  assert.equal(state.edges.length, 4);
  assert.equal(state.edges[0].label, 'yes & sure');
  assert.equal(state.edges[0].mermaidArrowEnd, 'arrow_point');
  assert.equal(state.edges[2].source, state.edges[2].target);
  assert.equal(new Set(state.nodes.map(({ x, y }) => `${x},${y}`)).size, state.nodes.length);
});

test('decodes Mermaid parser entity sentinels for quoted and numeric entities', () => {
  const label = 'A\uFB02°quot¶ßB\uFB02°°35¶ßC\uFB02°lt¶ßtag\uFB02°gt¶ß';
  const state = diagramToState(flowDiagram([{ id: 'A', text: label }], []));
  assert.equal(state.nodes[0].label, 'A"B#C<tag>');
});

test('uses parser computed styles and rejects unsafe color values', () => {
  const diagram = flowDiagram(
    [{ id: 'A', text: 'A', styles: ['stroke:url(javascript:alert(1))', 'color:#222222'] }],
    [],
    {
      dataNodes: [
        { id: 'A', borderColor: 'url(javascript:alert(1))', cssStyles: ['stroke:#abcdef'] },
      ],
    },
  );
  const state = diagramToState(diagram);
  assert.equal(state.nodes[0].color, '#abcdef');
  assert.doesNotMatch(state.nodes[0].color, /url|javascript/i);
});

test('normalizes supported CSS colors to canvas hex values', () => {
  const diagram = flowDiagram(
    [{ id: 'A', text: 'A', styles: ['stroke:rgb(10, 20, 30);fill:#abc'] }],
    [],
  );
  assert.equal(diagramToState(diagram).nodes[0].color, '#0a141e');
});

test('imports Mermaid mindmap trees and keeps node shape', () => {
  const diagram = {
    type: 'mindmap',
    db: {
      getMindmap: () => ({
        nodeId: 'root',
        descr: 'Root',
        type: 3,
        children: [{ nodeId: 'child', descr: 'Child #quot;ok#quot;', type: 2, children: [] }],
      }),
    },
  };
  const state = diagramToState(diagram);
  assert.equal(state.mode, 'mindmap');
  assert.equal(state.rootId, 'root');
  assert.equal(state.nodes[0].shape, 'circle');
  assert.equal(state.nodes[1].shape, 'rect');
  assert.equal(state.nodes[1].label, 'Child "ok"');
  assert.deepEqual(
    state.edges.map(({ source, target }) => [source, target]),
    [['root', 'child']],
  );
});

test('preserves existing coordinates and custom metadata by ID or label', () => {
  const previous = {
    mode: 'flowchart',
    rootId: 'oldRoot',
    nodes: [
      { id: 'oldRoot', label: 'Root', x: 812, y: 217, note: 'keep root metadata' },
      { id: 'oldChild', label: 'Child', x: 1040, y: 540, note: 'keep child metadata' },
    ],
    edges: [{ id: 'L1', source: 'oldRoot', target: 'oldChild', note: 'edge metadata' }],
  };
  const diagram = flowDiagram(
    [
      { id: 'root', text: 'Root' },
      { id: 'child', text: 'Child' },
    ],
    [{ id: 'L1', start: 'root', end: 'child', text: 'next' }],
  );
  const state = diagramToState(diagram, previous);
  assert.deepEqual(
    state.nodes.map(({ x, y }) => [x, y]),
    [
      [812, 217],
      [1040, 540],
    ],
  );
  assert.equal(state.nodes[0].note, 'keep root metadata');
  assert.equal(state.nodes[1].note, 'keep child metadata');
  assert.equal(state.edges[0].note, 'edge metadata');
});

test('rejects unsupported subgraphs and other diagram types clearly', () => {
  assert.throws(
    () => diagramToState(flowDiagram([{ id: 'A', text: 'A' }], [], { subgraphs: [{ id: 'sg' }] })),
    /subgraphs cannot be edited/,
  );
  assert.throws(() => diagramToState({ type: 'sequence', db: {} }), /type is not editable/);
});
