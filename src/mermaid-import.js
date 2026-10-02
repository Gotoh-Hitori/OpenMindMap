import { layoutState, normalizeState } from './model.js';
import { MAX_EDGES, MAX_NODES } from './limits.js';

const FLOW_TYPES = new Set(['flowchart', 'flowchart-v2', 'graph']);
const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|rgba?\([\d.% ,+-]+\)|hsla?\([\d.% ,+-]+\)|[a-z]{1,24})$/i;

function diagramType(diagram) {
  return String(
    diagram?.getType?.() ?? diagram?.type ?? diagram?.metadata?.type ?? '',
  ).toLowerCase();
}

function toText(value) {
  if (value == null) return '';
  // Mermaid protects entities during parsing with internal sentinel sequences.
  const source = String(value).replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';');
  if (typeof DOMParser !== 'undefined') {
    // DOMParser creates an inert document: scripts and event handlers are never run.
    const knownTags = new Set([
      'br',
      'div',
      'p',
      'span',
      'strong',
      'em',
      'b',
      'i',
      'code',
      'del',
      'u',
      's',
      'sub',
      'sup',
      'small',
      'mark',
      'font',
      'label',
      'foreignobject',
      'script',
      'style',
      'template',
      'noscript',
    ]);
    const safeSource = source
      .replace(/<\s*br\s*\/?\s*>/gi, ' ')
      .replace(/<\/?(?:div|p)\b[^>]*>/gi, ' ')
      .replace(/<\/?([a-z][\w-]*)\b[^>]*>/gi, (tag, name) => {
        if (knownTags.has(name.toLowerCase())) return tag;
        return tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      });
    const document = new DOMParser().parseFromString(safeSource, 'text/html');
    document.querySelectorAll('script,style,template,noscript').forEach((node) => node.remove());
    return decodeMermaidEntities(document.body?.textContent ?? '');
  }
  return decodeMermaidEntities(
    source
      .replace(
        /<\/?(?:br|div|p|span|strong|em|b|i|code|del|u|s|sub|sup|small|mark|font|label|foreignObject)\b[^>]*>/gi,
        ' ',
      )
      .replace(/<[^>]*>/g, '')
      .replace(/&#(x[\da-f]+|\d+);?/gi, (_, number) => {
        const code =
          number[0].toLowerCase() === 'x' ? Number.parseInt(number.slice(1), 16) : Number(number);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '�';
      })
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (entity) => {
        const decoded = {
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&nbsp;': '\u00a0',
        };
        return decoded[entity.toLowerCase()] ?? entity;
      })
      .trim(),
  );
}

function decodeMermaidEntities(value) {
  return value.replace(
    /#(amp|lt|gt|quot|apos|35|91|93|123|125|40|41|124|10);/gi,
    (entity, name) => {
      const decoded = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        35: '#',
        91: '[',
        93: ']',
        123: '{',
        125: '}',
        40: '(',
        41: ')',
        124: '|',
        10: '\n',
      };
      return decoded[name.toLowerCase()] ?? entity;
    },
  );
}

function safeColor(value) {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  if (!COLOR_PATTERN.test(color) || /url|var\(|expression|[;{}]/i.test(color)) return undefined;
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const channels =
      hex.length <= 4
        ? [...hex].map((channel) => Number.parseInt(channel + channel, 16))
        : hex.match(/../g).map((channel) => Number.parseInt(channel, 16));
    const alpha = channels.length === 4 ? channels[3] / 255 : 1;
    return `#${channels
      .slice(0, 3)
      .map((channel) =>
        Math.round(channel * alpha + 255 * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  }
  const rgb = color.match(
    /^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)(?:\s*,\s*([\d.]+%?))?\s*\)$/i,
  );
  if (rgb) {
    const channels = rgb.slice(1, 4).map((channel) => {
      const value = Number.parseFloat(channel);
      return Math.max(0, Math.min(255, channel.endsWith('%') ? value * 2.55 : value));
    });
    const alpha = rgb[4]
      ? Math.max(
          0,
          Math.min(1, rgb[4].endsWith('%') ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4])),
        )
      : 1;
    return `#${channels
      .map((channel) =>
        Math.round(channel * alpha + 255 * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  }
  if (typeof document !== 'undefined') {
    if (typeof CSS !== 'undefined' && !CSS.supports('color', color)) return undefined;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#000000';
    context.fillStyle = color;
    const normalized = String(context.fillStyle);
    const rgb = normalized.match(/^#([\da-f]{6})$/i)?.[1];
    if (rgb) return `#${rgb.toLowerCase()}`;
  }
  return undefined;
}

function colorFromStyles(styles) {
  const declarations = (
    Array.isArray(styles) ? styles : typeof styles === 'string' ? [styles] : []
  ).flatMap((style) => (typeof style === 'string' ? style.split(';') : []));
  const found = {};
  for (const declaration of declarations) {
    if (typeof declaration !== 'string') continue;
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const key = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration
      .slice(separator + 1)
      .trim()
      .replace(/\s*!important\s*$/i, '');
    if (key === 'stroke' || key === 'border-color') found.color = safeColor(value);
    if (key === 'color' || key === 'fill' || key === 'background-color') {
      if (key !== 'color') found.fill = safeColor(value);
      else found.text = safeColor(value);
    }
  }
  return found.color || found.fill || found.text;
}

function shapeFromFlow(node) {
  const type = String(node?.type ?? node?.shape ?? '').toLowerCase();
  if (['circle', 'doublecircle', 'circ', 'sm-circ', 'f-circ'].includes(type)) return 'circle';
  if (['diamond', 'diam', 'decision', 'question'].includes(type)) return 'diamond';
  if (['round', 'rounded', 'stadium', 'pill', 'terminal', 'ellipse'].includes(type))
    return 'rounded';
  return 'rect';
}

function shapeFromMindmap(type) {
  if (type === 1) return 'rounded';
  if (type === 2) return 'rect';
  if (type === 3) return 'circle';
  return 'rounded';
}

function flowState(diagram) {
  const db = diagram?.db;
  if (!db || typeof db.getVertices !== 'function' || typeof db.getEdges !== 'function') {
    throw new TypeError('Mermaid flowchart parser database is unavailable');
  }
  if (typeof db.getSubGraphs === 'function' && db.getSubGraphs().length) {
    throw new TypeError('Mermaid subgraphs cannot be edited on the canvas yet');
  }
  const vertices = db.getVertices();
  const entries =
    vertices instanceof Map ? [...vertices.entries()] : Object.entries(vertices || {});
  const data = typeof db.getData === 'function' ? db.getData() : null;
  const dataNodes = new Map((data?.nodes || []).map((node) => [node.id, node]));
  const dataEdges = new Map((data?.edges || []).map((edge) => [edge.id, edge]));
  if (!entries.length) throw new TypeError('Mermaid flowchart contains no editable nodes');

  const ids = new Set();
  const nodes = entries.map(([key, vertex]) => {
    const id = String(vertex?.id ?? key);
    if (!id || ids.has(id))
      throw new TypeError(`Mermaid flowchart has a duplicate or empty node ID: ${id}`);
    ids.add(id);
    const node = {
      id,
      label: toText(vertex?.text ?? vertex?.label ?? id),
      shape: shapeFromFlow(vertex),
    };
    const laidOutNode = dataNodes.get(id);
    const color =
      safeColor(laidOutNode?.borderColor) ||
      safeColor(laidOutNode?.backgroundColor) ||
      colorFromStyles(laidOutNode?.cssStyles) ||
      colorFromStyles(vertex?.styles);
    if (color) node.color = color;
    return node;
  });
  const edges = db.getEdges().map((edge, index) => {
    const source = String(edge?.start ?? edge?.source ?? '');
    const target = String(edge?.end ?? edge?.target ?? '');
    if (!ids.has(source) || !ids.has(target)) {
      throw new TypeError(`Mermaid edge ${index + 1} refers to an unknown node`);
    }
    const result = {
      id: typeof edge.id === 'string' && edge.id ? edge.id : `mermaid-edge-${index + 1}`,
      source,
      target,
      label: toText(edge.text ?? edge.label ?? ''),
      mermaidArrowStart: String(edge.arrowTypeStart ?? ''),
      mermaidArrowEnd: String(edge.arrowTypeEnd ?? edge.arrowhead ?? ''),
      mermaidType: String(edge.type ?? ''),
    };
    const color = colorFromStyles(dataEdges.get(edge.id)?.style ?? edge.style);
    if (color) result.color = color;
    return result;
  });
  if (nodes.length > MAX_NODES)
    throw new TypeError(`Mermaid diagram exceeds ${MAX_NODES} editable nodes`);
  if (edges.length > MAX_EDGES)
    throw new TypeError(`Mermaid diagram exceeds ${MAX_EDGES} editable edges`);
  return { mode: 'flowchart', rootId: nodes[0].id, nodes, edges };
}

function mindmapState(diagram) {
  const root = diagram?.db?.getMindmap?.();
  if (!root || typeof root !== 'object')
    throw new TypeError('Mermaid mindmap contains no editable root');
  const data = diagram.db.getData?.();
  const dataNodes = new Map((data?.nodes || []).map((node) => [node.nodeId ?? node.id, node]));
  const nodes = [];
  const edges = [];
  const visiting = new Set();
  const seen = new Set();
  const walk = (entry, parentId = null) => {
    const id = String(entry.nodeId ?? entry.id ?? '');
    if (!id) throw new TypeError('Mermaid mindmap contains a node without an ID');
    if (visiting.has(id)) throw new TypeError(`Mermaid mindmap contains a cycle at node ${id}`);
    if (seen.has(id)) throw new TypeError(`Mermaid mindmap contains a repeated node ID: ${id}`);
    visiting.add(id);
    seen.add(id);
    const node = {
      id,
      label: toText(entry.descr ?? entry.label ?? id),
      shape: shapeFromMindmap(entry.type),
    };
    const layoutNode = dataNodes.get(id);
    const color =
      safeColor(layoutNode?.borderColor) ||
      safeColor(layoutNode?.backgroundColor) ||
      colorFromStyles(layoutNode?.cssStyles ?? entry.styles);
    if (color) node.color = color;
    nodes.push(node);
    if (parentId !== null)
      edges.push({ id: `mermaid-edge-${edges.length + 1}`, source: parentId, target: id });
    for (const child of Array.isArray(entry.children) ? entry.children : []) walk(child, id);
    visiting.delete(id);
  };
  walk(root);
  if (nodes.length > MAX_NODES)
    throw new TypeError(`Mermaid diagram exceeds ${MAX_NODES} editable nodes`);
  if (edges.length > MAX_EDGES)
    throw new TypeError(`Mermaid diagram exceeds ${MAX_EDGES} editable edges`);
  return { mode: 'mindmap', rootId: nodes[0].id, nodes, edges };
}

function preserveExisting(parsed, previousState) {
  if (!previousState || !Array.isArray(previousState.nodes)) return parsed;
  const previousNodes = new Map(previousState.nodes.map((node) => [node.id, node]));
  const previousByLabel = new Map();
  for (const node of previousState.nodes) {
    const candidates = previousByLabel.get(node.label) || [];
    candidates.push(node);
    previousByLabel.set(node.label, candidates);
  }
  const previousEdges = new Map((previousState.edges || []).map((edge) => [edge.id, edge]));
  const matchedPreviousIds = new Set();
  return {
    ...parsed,
    nodes: parsed.nodes.map((node) => {
      const candidates = previousByLabel.get(node.label) || [];
      const byId = previousNodes.get(node.id);
      const previous =
        byId || candidates.find((candidate) => !matchedPreviousIds.has(candidate.id));
      if (previous) matchedPreviousIds.add(previous.id);
      if (!previous) return node;
      return {
        ...previous,
        ...node,
        x: Number.isFinite(previous.x) ? previous.x : node.x,
        y: Number.isFinite(previous.y) ? previous.y : node.y,
      };
    }),
    edges: parsed.edges.map((edge) => ({ ...previousEdges.get(edge.id), ...edge })),
  };
}

/** Convert Mermaid's already-parsed diagram database into editable canvas state. */
export function diagramToState(diagram, previousState) {
  const type = diagramType(diagram);
  let parsed;
  if (type === 'mindmap') parsed = mindmapState(diagram);
  else if (FLOW_TYPES.has(type)) parsed = flowState(diagram);
  else
    throw new TypeError(`Mermaid diagram type is not editable on the canvas: ${type || 'unknown'}`);

  const preserved = preserveExisting(parsed, previousState);
  const laidOut = layoutState(normalizeState(preserved));
  const preservedNodes = new Map(preserved.nodes.map((node) => [node.id, node]));
  laidOut.nodes = laidOut.nodes.map((node) => {
    const prior = preservedNodes.get(node.id);
    return prior && Number.isFinite(prior.x) && Number.isFinite(prior.y)
      ? { ...node, x: prior.x, y: prior.y }
      : node;
  });
  return normalizeState(laidOut);
}
