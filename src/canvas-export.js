const NS = 'http://www.w3.org/2000/svg';
const PADDING = 24;

const svgElement = (name, attrs = {}) => {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};

function points(width, height, inset = 0) {
  return `${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`;
}

function fontAttributes(element, fill) {
  const style = getComputedStyle(element);
  return {
    fill,
    'font-family': style.fontFamily,
    'font-size': style.fontSize,
    'font-weight': style.fontWeight,
    'font-style': style.fontStyle,
    'letter-spacing': style.letterSpacing,
  };
}

/**
 * Rebuilds DOM-wrapped text as SVG text lines. A Range per code point preserves
 * browser line breaks (including CJK overflow-wrap:anywhere and explicit newlines).
 */
function wrappedLines(element) {
  const textNode = element.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return [];
  const content = textNode.textContent || '';
  const range = document.createRange();
  const lines = [];
  let text = '',
    top = null,
    left = 0;
  const finish = () => {
    lines.push({ text, top: top ?? element.getBoundingClientRect().top, left });
    text = '';
    top = null;
    left = 0;
  };
  let offset = 0;
  for (const char of content) {
    const next = offset + char.length;
    if (char === '\n') {
      finish();
      offset = next;
      continue;
    }
    range.setStart(textNode, offset);
    range.setEnd(textNode, next);
    const rect = range.getBoundingClientRect();
    if (top !== null && rect.height && Math.abs(rect.top - top) > 1) finish();
    if (top === null && rect.height) {
      top = rect.top;
      left = rect.left;
    }
    text += char;
    offset = next;
  }
  if (text || !lines.length || content.endsWith('\n')) finish();
  return lines;
}

function appendText(svg, element, nodeRect, color, { offsetX = 0, offsetY = 0 } = {}) {
  const style = getComputedStyle(element);
  if (!element.getClientRects().length || style.visibility === 'hidden') return;
  const fontSize = Number.parseFloat(style.fontSize) || 13;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context)
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ascent = context?.measureText('国Ag').actualBoundingBoxAscent || fontSize * 0.82;
  const text = svgElement('text', fontAttributes(element, color));
  for (const line of wrappedLines(element)) {
    const baseline = line.top - nodeRect.top + ascent + offsetY;
    const tspan = svgElement('tspan', {
      x: line.left - nodeRect.left + offsetX,
      y: baseline,
    });
    tspan.textContent = line.text || ' ';
    text.append(tspan);
  }
  svg.append(text);
}

function addNode(svg, node, element) {
  const x = Number(node.x) || 0;
  const y = Number(node.y) || 0;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const color = /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : '#333333';
  const root = element.classList.contains('root');
  const group = svgElement('g', {
    'data-node-id': node.id,
    transform: `translate(${x} ${y})`,
  });
  let shape;
  if (element.classList.contains('diamond')) {
    shape = svgElement('polygon', { points: points(width + 14, height + 14, 0), fill: color });
    shape.setAttribute('transform', 'translate(-7 -7)');
    group.append(shape);
    shape = svgElement('polygon', { points: points(width + 10, height + 10, 0), fill: '#ffffff' });
    shape.setAttribute('transform', 'translate(-5 -5)');
    group.append(shape);
  } else {
    const rect = element.classList.contains('rect');
    const circle = element.classList.contains('circle');
    const radius = circle ? Math.min(45, width / 2, height / 2) : rect ? 0 : 9;
    shape = svgElement('rect', {
      x: 0,
      y: 0,
      width,
      height,
      rx: radius,
      ry: radius,
      fill: root ? '#f2f2f4' : '#ffffff',
      stroke: color,
      'stroke-width': 1,
    });
    group.append(shape);
  }
  const title = element.querySelector('.node-title');
  if (title) appendText(group, title, element.getBoundingClientRect(), '#1d1d1f');
  const meta = element.querySelector('.node-meta');
  if (meta) appendText(group, meta, element.getBoundingClientRect(), '#86868b');
  svg.append(group);
}

/** Build a self-contained SVG snapshot from the current canvas DOM geometry. */
export function exportCanvasSvg({ state, nodesRoot, edgeSvg, elementById }) {
  const snapshot = svgElement('svg', {
    xmlns: NS,
    version: '1.1',
    width: 1,
    height: 1,
    preserveAspectRatio: 'xMidYMid meet',
  });
  const title = svgElement('title');
  title.textContent = 'OpenMindMap canvas';
  snapshot.append(title);

  const defs = svgElement('defs');
  const marker = svgElement('marker', {
    id: 'openmindmap-arrow',
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 5,
    markerHeight: 5,
    orient: 'auto-start-reverse',
  });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#8e8e93' }));
  defs.append(marker);
  snapshot.append(defs);

  for (const edge of state.edges) {
    const source = edgeSvg.querySelector(`path[data-edge-id="${CSS.escape(edge.id)}"]`);
    if (!source) continue;
    const path = svgElement('path', {
      'data-edge-id': edge.id,
      d: source.getAttribute('d') || '',
      fill: 'none',
      stroke: '#8e8e93',
      'stroke-width': 2,
      'marker-end': 'url(#openmindmap-arrow)',
    });
    snapshot.append(path);
    const label = edgeSvg.querySelector(`text[data-edge-label="${CSS.escape(edge.id)}"]`);
    if (label) {
      const copy = svgElement('text', {
        x: label.getAttribute('x') || 0,
        y: label.getAttribute('y') || 0,
        ...fontAttributes(label, '#6e6e73'),
      });
      copy.textContent = label.textContent;
      snapshot.append(copy);
    }
  }
  for (const node of state.nodes) {
    const element =
      elementById.get(node.id) || nodesRoot.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
    if (element) addNode(snapshot, node, element);
  }

  snapshot.style.position = 'fixed';
  snapshot.style.left = '-100000px';
  snapshot.style.top = '0';
  snapshot.style.overflow = 'visible';
  document.body.append(snapshot);
  try {
    const bounds = snapshot.getBBox();
    const x = bounds.x - PADDING;
    const y = bounds.y - PADDING;
    const width = Math.max(1, bounds.width + PADDING * 2);
    const height = Math.max(1, bounds.height + PADDING * 2);
    snapshot.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    snapshot.setAttribute('width', `${width}px`);
    snapshot.setAttribute('height', `${height}px`);
    snapshot.style.removeProperty('position');
    snapshot.style.removeProperty('left');
    snapshot.style.removeProperty('top');
    snapshot.style.removeProperty('overflow');
    return snapshot.outerHTML;
  } finally {
    snapshot.remove();
  }
}
