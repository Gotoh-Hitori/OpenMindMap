import { exportCanvasSvg } from './canvas-export.js';

/** @typedef {{id:string,label:string,x?:number,y?:number,parentId?:string|null,shape?:string,color?:string}} CanvasNode */
/** @typedef {{id:string,source:string,target:string,sourceSide?:string,label?:string}} CanvasEdge */
/** @typedef {{rootId:string,nodes:CanvasNode[],edges:CanvasEdge[]}} CanvasState */
/** @param {{getState:()=>CanvasState,getSelected:()=>string|null,getEdge:()=>string|null,onSelect:(nodeId:string|null,edgeId:string|null)=>void,onMove:(id:string,position:{x:number,y:number})=>void,onConnect:(source:string,target:string,side:string)=>void,onAdd:(position:{x:number,y:number})=>void}} options */
export function createCanvas({
  getState,
  getSelected,
  getEdge,
  onSelect,
  onMove,
  onConnect,
  onAdd,
}) {
  /** @type {HTMLElement} */ const viewport = document.querySelector('#viewport');
  /** @type {HTMLElement} */ const world = document.querySelector('#world');
  /** @type {HTMLElement} */ const nodes = document.querySelector('#nodes');
  /** @type {SVGSVGElement} */ const svg = document.querySelector('#connections');
  let view = { x: 55, y: 80, scale: 1 },
    gesture = null,
    frame = 0,
    pendingPoint = null;
  let nodeById = new Map(),
    elementById = new Map();
  let edgeById = new Map(),
    incidentByNode = new Map(),
    edgeVisuals = new Map(),
    previewPath = null;
  const point = (e) => {
    const r = viewport.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.x) / view.scale,
      y: (e.clientY - r.top - view.y) / view.scale,
    };
  };
  const cancelFrame = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    pendingPoint = null;
  };
  const position = (id) =>
    gesture?.type === 'move' && gesture.id === id ? gesture.last : nodeById.get(id);
  function transform() {
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    document.querySelector('#zoom-value').textContent = `${Math.round(view.scale * 100)}%`;
  }
  function anchor(id, side) {
    const pos = position(id),
      el = elementById.get(id);
    if (!pos || !el) return { x: 0, y: 0 };
    const w = el.offsetWidth,
      h = el.offsetHeight;
    return side === 'left'
      ? { x: pos.x, y: pos.y + h / 2 }
      : side === 'top'
        ? { x: pos.x + w / 2, y: pos.y }
        : side === 'bottom'
          ? { x: pos.x + w / 2, y: pos.y + h }
          : { x: pos.x + w, y: pos.y + h / 2 };
  }
  const curve = (a, b) =>
    `M ${a.x} ${a.y} C ${a.x + (b.x - a.x) * 0.5} ${a.y}, ${a.x + (b.x - a.x) * 0.5} ${b.y}, ${b.x} ${b.y}`;
  function edgePath(edge) {
    const side = ['top', 'right', 'bottom', 'left'].includes(edge.sourceSide)
      ? edge.sourceSide
      : 'right';
    const opposite = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
    const a = anchor(edge.source, side),
      b = anchor(edge.target, opposite[side]);
    return edge.source === edge.target
      ? `M ${a.x} ${a.y} C ${a.x + 100} ${a.y - 100}, ${b.x - 100} ${b.y - 100}, ${b.x} ${b.y}`
      : curve(a, b);
  }
  function updateEdge(edge) {
    const visual = edgeVisuals.get(edge.id);
    if (!visual) return;
    const d = edgePath(edge);
    visual.path.setAttribute('d', d);
    visual.hit.setAttribute('d', d);
    if (visual.label) {
      const a = anchor(
        edge.source,
        ['top', 'right', 'bottom', 'left'].includes(edge.sourceSide) ? edge.sourceSide : 'right',
      );
      const side = ['top', 'right', 'bottom', 'left'].includes(edge.sourceSide)
        ? edge.sourceSide
        : 'right';
      const opposite = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
      const b = anchor(edge.target, opposite[side]);
      visual.label.setAttribute('x', String((a.x + b.x) / 2));
      visual.label.setAttribute(
        'y',
        String((a.y + b.y) / 2 - 8 - (edge.source === edge.target ? 75 : 0)),
      );
    }
  }
  function updateIncidentEdges(id) {
    for (const edge of incidentByNode.get(id) || []) updateEdge(edge);
  }
  function updatePreview() {
    if (gesture?.type !== 'link') return;
    if (!previewPath) {
      previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      previewPath.setAttribute('fill', 'none');
      previewPath.setAttribute('stroke', '#8e8e93');
      previewPath.setAttribute('stroke-dasharray', '6 5');
      svg.append(previewPath);
    }
    previewPath.setAttribute('d', curve(anchor(gesture.id, gesture.side), gesture.end));
  }
  function lines() {
    svg.replaceChildren();
    edgeById = new Map();
    incidentByNode = new Map();
    edgeVisuals = new Map();
    previewPath = null;
    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs'),
      marker = document.createElementNS(ns, 'marker'),
      arrow = document.createElementNS(ns, 'path');
    marker.id = 'canvas-arrow';
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5');
    marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto-start-reverse');
    arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    arrow.setAttribute('fill', '#8e8e93');
    marker.append(arrow);
    defs.append(marker);
    svg.append(defs);
    const addIncident = (id, edge) => {
      if (!incidentByNode.has(id)) incidentByNode.set(id, []);
      incidentByNode.get(id).push(edge);
    };
    for (const edge of getState().edges) {
      edgeById.set(edge.id, edge);
      addIncident(edge.source, edge);
      if (edge.target !== edge.source) addIncident(edge.target, edge);
      const d = edgePath(edge),
        path = document.createElementNS(ns, 'path');
      path.dataset.edgeId = edge.id;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', edge.id === getEdge() ? '#1d1d1f' : '#8e8e93');
      path.setAttribute('stroke-width', edge.id === getEdge() ? '4' : '2');
      path.setAttribute('marker-end', 'url(#canvas-arrow)');
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';
      path.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onSelect(null, edge.id);
      });
      svg.append(path);
      const hit = /** @type {SVGPathElement} */ (path.cloneNode());
      hit.removeAttribute('marker-end');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '15');
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onSelect(null, edge.id);
      });
      svg.append(hit);
      let label = null;
      if (edge.label) {
        label = document.createElementNS(ns, 'text');
        label.setAttribute('x', '0');
        label.setAttribute('y', '0');
        label.setAttribute('fill', '#000000');
        label.setAttribute('font-size', '12');
        label.dataset.edgeLabel = edge.id;
        label.textContent = edge.label;
        svg.append(label);
      }
      edgeVisuals.set(edge.id, { path, hit, label });
      updateEdge(edge);
    }
    if (gesture?.type === 'link') {
      previewPath = document.createElementNS(ns, 'path');
      previewPath.setAttribute('fill', 'none');
      previewPath.setAttribute('stroke', '#8e8e93');
      previewPath.setAttribute('stroke-dasharray', '6 5');
      svg.append(previewPath);
      updatePreview();
    }
  }
  function cancelGesture() {
    gesture = null;
    cancelFrame();
    render();
  }
  function render() {
    const state = getState(),
      validIds = new Set(state.nodes.map((n) => n.id));
    if (
      gesture &&
      (gesture.type === 'move' || gesture.type === 'link') &&
      !validIds.has(gesture.id)
    ) {
      gesture = null;
      cancelFrame();
    }
    nodes.replaceChildren();
    nodeById = new Map();
    elementById = new Map();
    const incoming = new Set(state.edges.map((e) => e.target));
    for (const n of state.nodes) {
      const pos =
        gesture?.type === 'move' && gesture.id === n.id
          ? gesture.last
          : { x: n.x || 0, y: n.y || 0 };
      nodeById.set(n.id, { x: n.x || 0, y: n.y || 0 });
      const el = document.createElement('div');
      el.className = `node ${n.id === getSelected() ? 'selected' : ''} ${n.id === state.rootId ? 'root' : ''} ${['rect', 'circle', 'diamond'].includes(n.shape) ? n.shape : ''}`;
      el.dataset.id = n.id;
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.style.setProperty('--node-color', /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : '#333333');
      const label = document.createElement('div');
      label.className = 'node-title';
      label.textContent = n.label || '未命名节点';
      const meta = document.createElement('div');
      meta.className = 'node-meta';
      meta.textContent =
        n.id === state.rootId ? '中心主题' : incoming.has(n.id) ? '已连接' : '独立节点';
      el.append(label, meta);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const h = document.createElement('button');
        h.className = 'handle';
        h.dataset.side = side;
        h.title = '拖到另一个节点建立连线';
        h.setAttribute('aria-label', `${side} 连接点`);
        h.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          viewport.setPointerCapture(e.pointerId);
          gesture = { type: 'link', id: n.id, side, end: point(e) };
          updatePreview();
        });
        el.append(h);
      }
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        viewport.setPointerCapture(e.pointerId);
        gesture = {
          type: 'move',
          id: n.id,
          start: point(e),
          x: n.x || 0,
          y: n.y || 0,
          last: { x: n.x || 0, y: n.y || 0 },
        };
        onSelect(n.id, null);
      });
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        /** @type {HTMLInputElement} */ (document.querySelector('#label')).focus();
        /** @type {HTMLInputElement} */ (document.querySelector('#label')).select();
      });
      nodes.append(el);
      elementById.set(n.id, el);
    }
    lines();
    transform();
  }
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    viewport.setPointerCapture(e.pointerId);
    onSelect(null, null);
    gesture = { type: 'pan', x: e.clientX, y: e.clientY, startX: view.x, startY: view.y };
  });
  viewport.addEventListener('dblclick', (e) => {
    const target = /** @type {Element} */ (e.target);
    if (target.closest('.node') || target.closest('.zoom')) return;
    onAdd(point(e));
  });
  function applyPointer(p) {
    if (!gesture) return;
    if (gesture.type === 'pan') {
      view.x = gesture.startX + p.clientX - gesture.x;
      view.y = gesture.startY + p.clientY - gesture.y;
      transform();
    } else if (gesture.type === 'move') {
      const q = point(p);
      gesture.last = { x: gesture.x + q.x - gesture.start.x, y: gesture.y + q.y - gesture.start.y };
      const el = elementById.get(gesture.id);
      if (el) {
        el.style.left = `${gesture.last.x}px`;
        el.style.top = `${gesture.last.y}px`;
      }
      updateIncidentEdges(gesture.id);
    } else if (gesture.type === 'link') {
      gesture.end = point(p);
      updatePreview();
    }
  }
  function schedulePointer(p) {
    pendingPoint = { clientX: p.clientX, clientY: p.clientY };
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const queued = pendingPoint;
        pendingPoint = null;
        if (queued) applyPointer(queued);
      });
  }
  function flushPointer(p) {
    cancelFrame();
    applyPointer(p);
  }
  window.addEventListener('pointermove', (e) => {
    if (gesture) schedulePointer(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (gesture) flushPointer(e);
    const old = gesture;
    gesture = null;
    if (old?.type === 'move') {
      if (Math.abs(old.last.x - old.x) + Math.abs(old.last.y - old.y) > 1) onMove(old.id, old.last);
      else render();
    }
    if (old?.type === 'link') {
      const target = /** @type {HTMLElement|null} */ (
        document.elementFromPoint(e.clientX, e.clientY)?.closest('.node') || null
      );
      if (target) onConnect(old.id, target.dataset.id, old.side);
      render();
    }
  });
  window.addEventListener('pointercancel', () => cancelGesture());
  function zoom(factor, px = viewport.clientWidth / 2, py = viewport.clientHeight / 2) {
    const scale = Math.min(2.5, Math.max(0.15, view.scale * factor));
    view.x = px - ((px - view.x) * scale) / view.scale;
    view.y = py - ((py - view.y) * scale) / view.scale;
    view.scale = scale;
    transform();
  }
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  document.querySelector('.zoom').addEventListener('pointerdown', (e) => e.stopPropagation());
  function fit() {
    const list = getState().nodes;
    if (!list.length) return;
    const minX = Math.min(...list.map((n) => n.x || 0)),
      minY = Math.min(...list.map((n) => n.y || 0)),
      maxX = Math.max(
        ...list.map((n) => (n.x || 0) + (elementById.get(n.id)?.offsetWidth || 164) + 8),
      ),
      maxY = Math.max(
        ...list.map((n) => (n.y || 0) + (elementById.get(n.id)?.offsetHeight || 72) + 8),
      );
    view.scale = Math.min(
      1.2,
      Math.max(
        0.15,
        Math.min(
          (viewport.clientWidth - 80) / (maxX - minX),
          (viewport.clientHeight - 100) / (maxY - minY),
        ),
      ),
    );
    view.x = (viewport.clientWidth - (maxX - minX) * view.scale) / 2 - minX * view.scale;
    view.y = (viewport.clientHeight - (maxY - minY) * view.scale) / 2 - minY * view.scale;
    transform();
  }
  function exportSvg() {
    if (gesture) cancelGesture();
    const canvasView = /** @type {HTMLElement} */ (document.querySelector('#canvas-view'));
    const wasHidden = canvasView.hidden;
    const previousTransform = world.style.transform;
    try {
      if (wasHidden) {
        canvasView.hidden = false;
        render();
      }
      // Range measurements are in screen pixels; removing the view transform
      // keeps text coordinates independent of the current pan and zoom.
      world.style.transform = 'none';
      return exportCanvasSvg({
        state: getState(),
        nodesRoot: nodes,
        edgeSvg: svg,
        elementById,
      });
    } finally {
      world.style.transform = previousTransform;
      canvasView.hidden = wasHidden;
    }
  }
  return {
    render,
    fit,
    zoom,
    cancelGesture,
    exportSvg,
    center: () =>
      point({
        clientX: viewport.getBoundingClientRect().left + viewport.clientWidth / 2,
        clientY: viewport.getBoundingClientRect().top + viewport.clientHeight / 2,
      }),
  };
}
