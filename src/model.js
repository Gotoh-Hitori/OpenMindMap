const MODES = new Set(['mindmap', 'flowchart']);
let idCounter = 0;

export function makeId(prefix = 'node') {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? `${prefix}-${random}`
    : `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
}

export function createState(label = '中心主题') {
  const rootId = makeId();
  return {
    mode: 'mindmap',
    rootId,
    nodes: [{ id: rootId, label: String(label), x: 0, y: 0, parentId: null }],
    edges: [],
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function edgeId(edge, index) {
  return typeof edge.id === 'string' && edge.id.length ? edge.id : `edge-${index + 1}`;
}

function normalizeEdges(rawEdges) {
  if (rawEdges == null) return [];
  if (!Array.isArray(rawEdges)) throw new TypeError('edges must be an array');
  return rawEdges.map((edge, index) => {
    if (!isObject(edge)) throw new TypeError(`edges[${index}] must be an object`);
    const source = edge.source ?? edge.sourceId;
    const target = edge.target ?? edge.targetId;
    if (typeof source !== 'string' || typeof target !== 'string') {
      throw new TypeError(`edges[${index}] must have string source and target IDs`);
    }
    return { ...edge, id: edgeId(edge, index), source, target };
  });
}

function canonicalize(input) {
  if (!isObject(input)) throw new TypeError('state must be an object');
  if (!Array.isArray(input.nodes)) throw new TypeError('nodes must be an array');

  const mode = input.mode ?? 'mindmap';
  if (!MODES.has(mode)) throw new TypeError(`unsupported mode: ${mode}`);

  const nodes = input.nodes.map((node, index) => {
    if (!isObject(node)) throw new TypeError(`nodes[${index}] must be an object`);
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new TypeError(`nodes[${index}].id must be a non-empty string`);
    }
    if (typeof node.label !== 'string')
      throw new TypeError(`nodes[${index}].label must be a string`);
    return { ...node, label: node.label };
  });

  const rootId = input.rootId;
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (typeof rootId !== 'string' || !nodeIds.has(rootId)) {
    throw new TypeError('rootId must identify an existing node');
  }

  let edges = normalizeEdges(input.edges);
  // Older saves represented tree connections through parentId only.
  if (input.edges === undefined) {
    edges = nodes
      .filter((node) => typeof node.parentId === 'string' && node.parentId.length > 0)
      .map((node, index) => ({ id: `edge-${index + 1}`, source: node.parentId, target: node.id }));
  }

  const state = { ...input, mode, rootId, nodes, edges };
  if (mode === 'mindmap') {
    const parentByTarget = new Map();
    for (const edge of edges) {
      if (edge.target !== rootId) parentByTarget.set(edge.target, edge.source);
    }
    state.nodes = nodes.map((node) => ({
      ...node,
      parentId: node.id === rootId ? null : (parentByTarget.get(node.id) ?? null),
    }));
  } else {
    state.nodes = nodes.map((node) => {
      const copy = { ...node };
      delete copy.parentId;
      return copy;
    });
  }
  return state;
}

function structuralErrors(state) {
  const errors = [];
  const byId = new Map();
  state.nodes.forEach((node) => {
    if (byId.has(node.id)) errors.push(`duplicate node ID: ${node.id}`);
    byId.set(node.id, node);
    if (typeof node.label !== 'string') errors.push(`node ${node.id} has an invalid label`);
    for (const key of ['x', 'y']) {
      if (node[key] !== undefined && !Number.isFinite(node[key]))
        errors.push(`node ${node.id} has invalid ${key}`);
    }
  });
  if (!byId.has(state.rootId)) errors.push('rootId must identify an existing node');

  const edgeIds = new Set();
  const incoming = new Map();
  const adjacency = new Map(state.nodes.map((node) => [node.id, []]));
  for (const edge of state.edges) {
    if (edgeIds.has(edge.id)) errors.push(`duplicate edge ID: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      errors.push(`edge ${edge.id} references a missing node`);
      continue;
    }
    adjacency.get(edge.source).push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    if (state.mode === 'mindmap' && edge.target === state.rootId)
      errors.push('mindmap root cannot have a parent');
    if (state.mode === 'mindmap' && incoming.get(edge.target) > 1)
      errors.push(`mindmap node ${edge.target} has multiple parents`);
  }

  if (state.mode === 'mindmap') {
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const target of adjacency.get(id) || []) if (visit(target)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    for (const node of state.nodes) {
      if (visit(node.id)) {
        errors.push('mindmap edges cannot contain cycles');
        break;
      }
    }
  }
  return errors;
}

export function validateState(input) {
  try {
    const state = canonicalize(input);
    const errors = structuralErrors(state);
    return { valid: errors.length === 0, errors };
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
}

export function normalizeState(input) {
  const state = canonicalize(input);
  const errors = structuralErrors(state);
  if (errors.length) throw new TypeError(`Invalid mind map state: ${errors.join('; ')}`);
  return state;
}

function cloneState(state) {
  return normalizeState(state);
}

function indexNodes(state) {
  return new Map(state.nodes.map((node) => [node.id, node]));
}

/** @param {Record<string, unknown>} [options] */
export function addNode(stateInput, options = {}) {
  const state = cloneState(stateInput);
  const { parentId = state.rootId, label = '新节点', ...metadata } = options;
  const byId = indexNodes(state);
  if (parentId != null && !byId.has(parentId))
    throw new TypeError(`unknown parent node: ${parentId}`);
  const id = typeof metadata.id === 'string' && metadata.id ? metadata.id : makeId();
  if (byId.has(id)) throw new TypeError(`duplicate node ID: ${id}`);
  /** @type {Record<string, unknown>} */
  const node = { ...metadata, id, label: String(label) };
  if (state.mode === 'mindmap') {
    node.parentId = parentId;
    if (parentId) state.edges.push({ id: makeId('edge'), source: parentId, target: id });
  } else if (parentId) {
    state.edges.push({ id: makeId('edge'), source: parentId, target: id });
  }
  state.nodes.push(node);
  return normalizeState(state);
}

export function updateNode(stateInput, id, patch) {
  const state = cloneState(stateInput);
  if (!indexNodes(state).has(id)) throw new TypeError(`unknown node: ${id}`);
  if (!isObject(patch)) throw new TypeError('node patch must be an object');
  if (patch.id !== undefined && patch.id !== id) throw new TypeError('node IDs cannot be changed');
  state.nodes = state.nodes.map((node) => (node.id === id ? { ...node, ...patch, id } : node));
  return normalizeState(state);
}

export function removeNode(stateInput, id, { cascade = true } = {}) {
  const state = cloneState(stateInput);
  if (!indexNodes(state).has(id)) return state;
  if (id === state.rootId) throw new TypeError('the root node cannot be removed');
  const removed = new Set([id]);
  if (cascade && state.mode === 'mindmap') {
    const children = new Map();
    for (const edge of state.edges) {
      if (!children.has(edge.source)) children.set(edge.source, []);
      children.get(edge.source).push(edge.target);
    }
    const visit = (parent) =>
      (children.get(parent) || []).forEach((child) => {
        if (!removed.has(child)) {
          removed.add(child);
          visit(child);
        }
      });
    visit(id);
  }
  state.nodes = state.nodes.filter((node) => !removed.has(node.id));
  state.edges = state.edges.filter(
    (edge) => !removed.has(edge.source) && !removed.has(edge.target),
  );
  return normalizeState(state);
}

export function connectNodes(stateInput, sourceId, targetId, options = {}) {
  const state = cloneState(stateInput);
  const byId = indexNodes(state);
  if (!byId.has(sourceId) || !byId.has(targetId)) throw new TypeError('edge endpoints must exist');
  if (state.mode === 'mindmap') {
    if (targetId === state.rootId) throw new TypeError('mindmap root cannot have a parent');
    if (sourceId === targetId || isReachable(state.edges, targetId, sourceId))
      throw new TypeError('mindmap edges cannot create a cycle');
    if (state.edges.some((edge) => edge.target === targetId))
      throw new TypeError('mindmap nodes can have only one parent');
  }
  if (state.edges.some((edge) => edge.source === sourceId && edge.target === targetId))
    return state;
  const edge = { ...options, id: options.id || makeId('edge'), source: sourceId, target: targetId };
  state.edges.push(edge);
  return normalizeState(state);
}

function isReachable(edges, start, goal) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
  }
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    if (current === goal) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const target of outgoing.get(current) || []) stack.push(target);
  }
  return false;
}

export function disconnectEdge(stateInput, edgeId) {
  const state = cloneState(stateInput);
  state.edges = state.edges.filter((edge) => edge.id !== edgeId);
  return normalizeState(state);
}

export function layoutState(stateInput) {
  const state = cloneState(stateInput);
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const children = new Map(state.nodes.map((node) => [node.id, []]));
  state.edges.forEach((edge) => children.get(edge.source)?.push(edge.target));

  // A flowchart can contain converging paths and cycles. A tree-style DFS
  // places those nodes more than once conceptually and can stack siblings at
  // the same coordinates. Give graph nodes a stable, collision-free row while
  // keeping their horizontal position based on the shortest discovered depth.
  if (state.mode === 'flowchart') {
    const incoming = new Set(state.edges.map((edge) => edge.target));
    const positions = new Map();
    const queue = state.nodes
      .filter((node) => !incoming.has(node.id))
      .map((node) => ({ id: node.id, depth: 0 }));
    let cursor = 0;
    while (cursor < queue.length) {
      const { id, depth } = queue[cursor++];
      if (positions.has(id)) continue;
      positions.set(id, { x: depth * 240 + 40, depth });
      for (const child of children.get(id) || []) {
        if (!positions.has(child)) queue.push({ id: child, depth: depth + 1 });
      }
    }
    // A cycle may have no zero-incoming node. Seed any remaining component.
    state.nodes.forEach((node) => {
      if (!positions.has(node.id)) queue.push({ id: node.id, depth: 0 });
    });
    while (cursor < queue.length) {
      const { id, depth } = queue[cursor++];
      if (positions.has(id)) continue;
      positions.set(id, { x: depth * 240 + 40, depth });
      for (const child of children.get(id) || []) {
        if (!positions.has(child)) queue.push({ id: child, depth: depth + 1 });
      }
    }
    return {
      ...state,
      nodes: state.nodes.map((node, index) => ({
        ...byId.get(node.id),
        x: positions.get(node.id)?.x ?? 40,
        y: index * 130 + 40,
      })),
    };
  }

  const incoming = new Set(state.edges.map((edge) => edge.target));
  const roots = state.nodes.filter((node) => !incoming.has(node.id));
  const visited = new Set();
  const positions = new Map();
  let nextY = 40;
  const walk = (id, depth, ancestors = new Set()) => {
    if (ancestors.has(id) || visited.has(id)) return;
    visited.add(id);
    const nextAncestors = new Set(ancestors).add(id);
    const childIds = children.get(id) || [];
    if (!childIds.length) {
      positions.set(id, { x: depth * 240 + 40, y: nextY });
      nextY += 130;
      return;
    }
    childIds.forEach((child) => walk(child, depth + 1, nextAncestors));
    const childPositions = childIds.map((child) => positions.get(child)).filter(Boolean);
    positions.set(id, {
      x: depth * 240 + 40,
      y: childPositions.length ? (childPositions[0].y + childPositions.at(-1).y) / 2 : nextY,
    });
  };
  roots.forEach((root, index) => {
    walk(root.id, 0);
    if (index < roots.length - 1) nextY += 40;
  });
  // Graph cycles can have no zero-incoming roots. Seed each still-unplaced component.
  state.nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      walk(node.id, 0);
      nextY += 40;
    }
  });
  return {
    ...state,
    nodes: state.nodes.map((node) => ({
      ...byId.get(node.id),
      ...(positions.get(node.id) || { x: 40, y: nextY }),
    })),
  };
}

function mermaidText(value) {
  return String(value)
    .replace(/#/g, '#35;')
    .replace(/&/g, '#amp;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\|/g, '#124;')
    .replace(/\[/g, '#91;')
    .replace(/\]/g, '#93;')
    .replace(/\{/g, '#123;')
    .replace(/\}/g, '#125;')
    .replace(/\(/g, '#40;')
    .replace(/\)/g, '#41;')
    .replace(/\r?\n/g, '#10;');
}

function flowchartNode(node, identifier) {
  const label = `"${mermaidText(node.label)}"`;
  const shapes = {
    rounded: `(${label})`,
    rect: `[${label}]`,
    circle: `((${label}))`,
    diamond: `{${label}}`,
  };
  return `${identifier}${shapes[node.shape] || shapes.rect}`;
}

function safeColor(value) {
  return typeof value === 'string' &&
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    ? value
    : null;
}

export function toMermaid(stateInput, diagram = 'flowchart') {
  const state = cloneState(stateInput);
  const indexById = new Map(state.nodes.map((node, index) => [node.id, `n${index}`]));
  if (diagram === 'mindmap' && state.mode === 'mindmap') {
    const outgoing = new Map(state.nodes.map((node) => [node.id, []]));
    const incoming = new Set();
    state.edges.forEach((edge) => {
      outgoing.get(edge.source)?.push(edge.target);
      incoming.add(edge.target);
    });
    const byId = indexNodes(state);
    // Mindmap supports node classes, but not flowchart style statements.
    // Carry their CSS in the source so standalone Mermaid and SVG retain colors.
    const colored = state.nodes.filter((node) => safeColor(node.color));
    const colorClass = (id) => 'omm-color-' + indexById.get(id);
    const themeCSS =
      '.mindmap-node text,.mindmap-node span,.mindmap-node .nodeLabel{fill:#000000!important;color:#000000!important;}' +
      colored
        .map(
          (node) =>
            '.' +
            colorClass(node.id) +
            ' .label-container{fill:#ffffff!important;stroke:' +
            safeColor(node.color) +
            '!important;stroke-width:2px!important;}',
        )
        .join('');
    const lines = ['mindmap', `  root(("${mermaidText(byId.get(state.rootId).label)}"))`];
    if (safeColor(byId.get(state.rootId).color)) lines.push('    :::' + colorClass(state.rootId));
    const emitted = new Set([state.rootId]);
    const walk = (id, depth) => {
      for (const childId of outgoing.get(id) || []) {
        if (emitted.has(childId)) continue;
        emitted.add(childId);
        lines.push(
          `${'  '.repeat(depth + 1)}${indexById.get(childId)}["${mermaidText(byId.get(childId).label)}"]`,
        );
        if (safeColor(byId.get(childId).color))
          lines.push('  '.repeat(depth + 1) + ':::' + colorClass(childId));
        walk(childId, depth + 1);
      }
    };
    walk(state.rootId, 1);
    // Mermaid mindmaps have one root, so disconnected trees get their own named group.
    const detached = state.nodes.filter(
      (node) => node.id !== state.rootId && !incoming.has(node.id) && !emitted.has(node.id),
    );
    if (detached.length) lines.push('    disconnected["未连接节点"]');
    for (const node of detached) {
      emitted.add(node.id);
      lines.push(`      ${indexById.get(node.id)}["${mermaidText(node.label)}"]`);
      if (safeColor(node.color)) lines.push('      :::' + colorClass(node.id));
      walk(node.id, 3);
    }
    return (
      (themeCSS ? '%%{init: ' + JSON.stringify({ themeCSS }) + '}%%\n' : '') + lines.join('\n')
    );
  }
  const lines = ['flowchart TD'];
  state.nodes.forEach((node) => {
    const identifier = indexById.get(node.id);
    lines.push(`  ${flowchartNode(node, identifier)}`);
    const color = safeColor(node.color);
    lines.push(
      `  style ${identifier} ${color ? 'fill:#ffffff,stroke:' + color + ',stroke-width:2px,' : ''}color:#000000`,
    );
  });
  state.edges.forEach((edge) => {
    const label =
      typeof edge.label === 'string' && edge.label.length ? `|${mermaidText(edge.label)}|` : '';
    lines.push(`  ${indexById.get(edge.source)} -->${label} ${indexById.get(edge.target)}`);
  });
  return lines.join('\n');
}
