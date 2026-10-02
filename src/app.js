import './styles.css';
import { setupViews } from './views.js';
import {
  createState,
  normalizeState,
  addNode,
  updateNode,
  removeNode,
  connectNodes,
  disconnectEdge,
  layoutState,
  toMermaid,
} from './model.js';
import { createPersistence, download } from './storage.js';
import { createRenderer } from './renderer.js';
import { createCanvas } from './canvas.js';
import {
  MAX_NODES,
  MAX_EDGES,
  MAX_FILE_BYTES,
  MAX_SOURCE_LENGTH,
  checkImportSize,
} from './limits.js';

const elements = {
  'clear-recovery': /** @type {HTMLButtonElement} */ (document.getElementById('clear-recovery')),
  'view-canvas': /** @type {HTMLButtonElement} */ (document.getElementById('view-canvas')),
  'view-output': /** @type {HTMLButtonElement} */ (document.getElementById('view-output')),
  'save-status': /** @type {HTMLElement} */ (document.getElementById('save-status')),
  new: /** @type {HTMLButtonElement} */ (document.getElementById('new')),
  import: /** @type {HTMLButtonElement} */ (document.getElementById('import')),
  export: /** @type {HTMLButtonElement} */ (document.getElementById('export')),
  'export-canvas-svg': /** @type {HTMLButtonElement} */ (
    document.getElementById('export-canvas-svg')
  ),
  recover: /** @type {HTMLButtonElement} */ (document.getElementById('recover')),
  'reload-saved': /** @type {HTMLButtonElement} */ (document.getElementById('reload-saved')),
  'canvas-view': /** @type {HTMLElement} */ (document.getElementById('canvas-view')),
  viewport: /** @type {HTMLElement} */ (document.getElementById('viewport')),
  world: /** @type {HTMLElement} */ (document.getElementById('world')),
  connections: /** @type {SVGSVGElement} */ (document.querySelector('svg#connections')),
  nodes: /** @type {HTMLElement} */ (document.getElementById('nodes')),
  add: /** @type {HTMLButtonElement} */ (document.getElementById('add')),
  child: /** @type {HTMLButtonElement} */ (document.getElementById('child')),
  undo: /** @type {HTMLButtonElement} */ (document.getElementById('undo')),
  redo: /** @type {HTMLButtonElement} */ (document.getElementById('redo')),
  layout: /** @type {HTMLButtonElement} */ (document.getElementById('layout')),
  fit: /** @type {HTMLButtonElement} */ (document.getElementById('fit')),
  'selection-panel': /** @type {HTMLElement} */ (document.getElementById('selection-panel')),
  label: /** @type {HTMLInputElement} */ (document.getElementById('label')),
  color: /** @type {HTMLInputElement} */ (document.getElementById('color')),
  shape: /** @type {HTMLSelectElement} */ (document.getElementById('shape')),
  'edge-editor': /** @type {HTMLElement} */ (document.getElementById('edge-editor')),
  'edge-label': /** @type {HTMLInputElement} */ (document.getElementById('edge-label')),
  detach: /** @type {HTMLButtonElement} */ (document.getElementById('detach')),
  delete: /** @type {HTMLButtonElement} */ (document.getElementById('delete')),
  mode: /** @type {HTMLSelectElement} */ (document.getElementById('mode')),
  stats: /** @type {HTMLElement} */ (document.getElementById('stats')),
  'zoom-out': /** @type {HTMLButtonElement} */ (document.getElementById('zoom-out')),
  'zoom-value': /** @type {HTMLElement} */ (document.getElementById('zoom-value')),
  'zoom-in': /** @type {HTMLButtonElement} */ (document.getElementById('zoom-in')),
  'output-view': /** @type {HTMLElement} */ (document.getElementById('output-view')),
  copy: /** @type {HTMLButtonElement} */ (document.getElementById('copy')),
  'download-code': /** @type {HTMLButtonElement} */ (document.getElementById('download-code')),
  'download-svg': /** @type {HTMLButtonElement} */ (document.getElementById('download-svg')),
  regenerate: /** @type {HTMLButtonElement} */ (document.getElementById('regenerate')),
  code: /** @type {HTMLTextAreaElement} */ (document.getElementById('code')),
  'code-state': /** @type {HTMLElement} */ (document.getElementById('code-state')),
  render: /** @type {HTMLButtonElement} */ (document.getElementById('render')),
  preview: /** @type {HTMLElement} */ (document.getElementById('preview')),
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
  file: /** @type {HTMLInputElement} */ (document.getElementById('file')),
};
/** @template {keyof typeof elements} K @param {K} id @returns {(typeof elements)[K]} */
const $ = (id) => elements[id];
let views,
  importVersion = 0,
  pendingExternal = false;
const report = (text) => views?.notify(text);
const persistence = createPersistence(normalizeState, {
  onStatus: (text) => {
    $('save-status').textContent = text;
  },
  onExternal: () => {
    pendingExternal = true;
    $('save-status').textContent = '其他窗口已更新；请导出当前草稿，或载入最新存档';
    report('其他窗口已更新存档。当前草稿已保留，请从文件菜单选择导出或载入最新存档。');
  },
});
let state = persistence.load() || createState(),
  selected = null,
  edge = null,
  undo = [],
  redo = [];
const renderer = createRenderer($('preview'), report);
function safe(action) {
  try {
    action();
  } catch (error) {
    report(`操作未完成：${error.message}`);
  }
}
function commit(next) {
  if (JSON.stringify(next) === JSON.stringify(state)) {
    sync(false);
    return;
  }
  undo.push(state);
  if (undo.length > 100) undo.shift();
  redo = [];
  state = next;
  if (!state.nodes.some((n) => n.id === selected)) selected = state.rootId;
  if (!state.edges.some((e) => e.id === edge)) edge = null;
  sync();
}
const canvas = createCanvas({
  getState: () => state,
  getSelected: () => selected,
  getEdge: () => edge,
  onSelect: (id, e) => {
    safe(finishNodeEditing);
    selected = id;
    edge = e;
    inspector();
    canvas.render();
  },
  onMove: (id, p) => safe(() => commit(updateNode(state, id, p))),
  onConnect: (source, target, sourceSide) =>
    safe(() => {
      if (state.edges.length >= MAX_EDGES) throw Error('最多支持 5000 条连接，请拆分导图');
      commit(connectNodes(state, source, target, { sourceSide }));
    }),
  onAdd: (p) => add(false, p),
});
views = setupViews({
  onCanvas: () => canvas.render(),
  onOutput: () => renderer.render($('code').value),
});
// Canvas pointerdown runs before native blur; commit the old node's draft first.
function finishNodeEditing() {
  const node = state.nodes.find((n) => n.id === selected);
  if (node && document.activeElement === $('label') && $('label').value !== node.label) {
    commit(updateNode(state, selected, { label: $('label').value }));
  }
}
function inspector() {
  $('selection-panel').hidden = !selected && !edge;
  const n = state.nodes.find((n) => n.id === selected);
  for (const id of /** @type {const} */ (['label', 'color', 'shape', 'child'])) $(id).disabled = !n;
  $('label').value = n?.label || '';
  $('color').value = /^#[0-9a-f]{6}$/i.test(n?.color) ? n.color : '#333333';
  $('shape').value = n?.shape || 'rounded';
  $('delete').disabled = !edge && (!n || n.id === state.rootId);
  $('detach').disabled = !edge && (!n || !state.edges.some((e) => e.target === n.id));
  $('edge-editor').hidden = !edge || state.mode !== 'flowchart';
  $('edge-label').value = state.edges.find((e) => e.id === edge)?.label || '';
}
function sync(save = true) {
  if (save) void persistence.save(state);
  $('recover').hidden = $('clear-recovery').hidden = !persistence.getRecovery();
  $('mode').value = state.mode;
  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
  $('stats').textContent = `${state.nodes.length} 个节点 · ${state.edges.length} 条连接`;
  inspector();
  canvas.render();
  $('code').value = toMermaid(state, state.mode);
  $('code-state').textContent = '与画布同步';
  renderer.invalidate();
  if (document.body.dataset.view === 'output') renderer.schedule($('code').value);
}
function add(child, p) {
  safe(() => {
    if (state.nodes.length >= MAX_NODES) throw Error('最多支持 1000 个节点，请拆分导图');
    const anchor = state.nodes.find((n) => n.id === selected);
    const at =
      p || (anchor ? { x: (anchor.x || 0) + 230, y: (anchor.y || 0) + 70 } : canvas.center());
    const next = addNode(state, {
      parentId: child ? selected || state.rootId : null,
      label: child ? '子主题' : '新节点',
      ...at,
      color: anchor?.color || '#333333',
      shape: 'rounded',
    });
    selected = next.nodes.at(-1).id;
    commit(next);
  });
}
function history(back) {
  const from = back ? undo : redo,
    to = back ? redo : undo;
  if (!from.length) return;
  canvas.cancelGesture?.();
  to.push(state);
  state = from.pop();
  selected = state.rootId;
  edge = null;
  sync();
}
function exportJson() {
  finishNodeEditing();
  download('openmindmap.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
  report('导图已导出');
}
function remove() {
  safe(() => {
    if (edge) commit(disconnectEdge(state, edge));
    else if (selected) commit(removeNode(state, selected, { cascade: false }));
  });
}
$('add').onclick = () => add(false);
$('child').onclick = () => add(true);
$('layout').onclick = () =>
  safe(() => {
    commit(layoutState(state));
    canvas.fit();
  });
$('undo').onclick = () => history(true);
$('redo').onclick = () => history(false);
$('fit').onclick = canvas.fit;
$('zoom-in').onclick = () => canvas.zoom(1.2);
$('zoom-out').onclick = () => canvas.zoom(1 / 1.2);
$('delete').onclick = remove;
$('detach').onclick = () =>
  safe(() => {
    const ids = edge ? [edge] : state.edges.filter((e) => e.target === selected).map((e) => e.id);
    let next = state;
    for (const id of ids) next = disconnectEdge(next, id);
    commit(next);
  });
for (const id of /** @type {const} */ (['label', 'shape']))
  $(id).addEventListener('change', () =>
    safe(() => {
      if (selected) commit(updateNode(state, selected, { [id]: $(id).value }));
    }),
  );
function applyNodeColor() {
  safe(() => {
    const node = state.nodes.find((item) => item.id === selected);
    const color = $('color').value;
    if (node && node.color !== color) commit(updateNode(state, node.id, { color }));
  });
}
// Native color dialogs can emit input while dragging, or only change on confirmation.
$('color').addEventListener('input', applyNodeColor);
$('color').addEventListener('change', applyNodeColor);
$('label').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    $('label').dispatchEvent(new Event('change'));
    $('viewport').focus();
  }
});
$('edge-label').addEventListener('change', () =>
  safe(() =>
    commit(
      normalizeState({
        ...state,
        edges: state.edges.map((e) => (e.id === edge ? { ...e, label: $('edge-label').value } : e)),
      }),
    ),
  ),
);
$('mode').onchange = () =>
  safe(() => {
    try {
      commit(normalizeState({ ...state, mode: $('mode').value }));
    } catch {
      $('mode').value = state.mode;
      report(
        '当前关系包含循环、多父节点或指向中心主题的连线。请先断开这些连线，再切换到树形模式。',
      );
    }
  });
$('new').onclick = () => {
  if (confirm('新建导图将替换当前画布。可以撤销恢复，或先导出 JSON 备份。')) {
    ++importVersion;
    canvas.cancelGesture?.();
    selected = null;
    edge = null;
    commit(createState());
    canvas.fit();
  }
};
$('export').onclick = exportJson;
$('export-canvas-svg').onclick = () =>
  safe(() => {
    finishNodeEditing();
    download('openmindmap-canvas.svg', canvas.exportSvg(), 'image/svg+xml;charset=utf-8');
    report('画布 SVG 已导出，保留当前布局');
  });
$('import').onclick = () => $('file').click();
$('recover').onclick = () => {
  const backups = persistence.getRecoveries();
  if (backups.length === 1) download('openmindmap-recovery.txt', backups[0].raw);
  else if (backups.length > 1)
    download(
      'openmindmap-recoveries.json',
      JSON.stringify({ recoveries: backups }, null, 2),
      'application/json;charset=utf-8',
    );
};
$('clear-recovery').onclick = () => {
  if (!confirm('确认已导出所需恢复副本？清理只删除恢复副本，不删除当前存档，此操作不能撤销。'))
    return;
  report(persistence.clearRecovery() ? '恢复副本已清理' : '无法清理恢复副本');
  $('recover').hidden = $('clear-recovery').hidden = !persistence.getRecovery();
};
$('reload-saved').onclick = () => {
  if (!confirm('载入最新存档会替换当前草稿。请先导出需要保留的内容。')) return;
  const latest = persistence.reload();
  if (!latest) {
    report('没有可载入的有效存档，当前草稿已保留');
    return;
  }
  ++importVersion;
  canvas.cancelGesture?.();
  state = latest;
  selected = null;
  edge = null;
  undo = [];
  redo = [];
  pendingExternal = false;
  sync(false);
  report('已载入最新存档');
};
$('file').onchange = async () => {
  const file = $('file').files[0],
    current = ++importVersion;
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw Error('文件不能超过 2 MB');
    const input = JSON.parse(await file.text());
    if (current !== importVersion) return;
    checkImportSize(input);
    const next = normalizeState(input);
    if (toMermaid(next, next.mode).length > MAX_SOURCE_LENGTH)
      throw Error('生成代码超过 2 MB 字符限制，请拆分导图');
    canvas.cancelGesture?.();
    selected = next.rootId;
    edge = null;
    commit(next);
    canvas.fit();
    report('导入成功');
  } catch (error) {
    if (current === importVersion) report(`导入失败：${error.message}`);
  } finally {
    if (current === importVersion) $('file').value = '';
  }
};
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('code').value);
    report('Mermaid 代码已复制');
  } catch {
    $('code').focus();
    $('code').select();
    report('无法访问剪贴板，已选中代码，请手动复制');
  }
};
$('download-code').onclick = () => download('openmindmap.mmd', $('code').value);
$('download-svg').onclick = () => {
  const svg = renderer.getSvg();
  if (!svg) {
    report('请等待当前代码成功渲染后再导出');
    return;
  }
  download('openmindmap.svg', svg, 'image/svg+xml;charset=utf-8');
};
$('render').onclick = () => renderer.render($('code').value);
$('regenerate').onclick = () => {
  $('code').value = toMermaid(state, state.mode);
  $('code-state').textContent = '与画布同步';
  renderer.schedule($('code').value);
};
$('code').oninput = () => {
  $('code-state').textContent = '手动编辑 · 画布修改会重新生成';
  renderer.schedule($('code').value);
};
window.addEventListener('keydown', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const editing = target.matches('input,textarea,select') || target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    exportJson();
    return;
  }
  if (editing || document.body.dataset.view !== 'canvas') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    history(!e.shiftKey);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    history(false);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    remove();
  } else if (e.key === 'Tab' && selected) {
    e.preventDefault();
    add(true);
  } else if (e.key === 'Escape') {
    canvas.cancelGesture?.();
    selected = null;
    edge = null;
    inspector();
    canvas.render();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (
    pendingExternal ||
    $('save-status').textContent.includes('无法') ||
    $('save-status').textContent.includes('冲突') ||
    $('save-status').textContent.includes('正在')
  ) {
    event.preventDefault();
    event.returnValue = '';
  }
});
sync();
canvas.fit();
