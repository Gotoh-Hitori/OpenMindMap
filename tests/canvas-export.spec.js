import { test, expect } from '@playwright/test';
const KEY = 'mindmap-studio-state';
const diagram = {
  rootId: 'r',
  mode: 'flowchart',
  nodes: [
    { id: 'r', label: '用户手绘中心', x: -240, y: -160, color: '#2468ac', shape: 'circle' },
    {
      id: 'a',
      label: '中文长标题'.repeat(12) + '\n第二行 <script> & "标签"',
      x: 390,
      y: 210,
      color: '#d02040',
      shape: 'diamond',
    },
    { id: 'b', label: '矩形节点', x: 70, y: -320, color: '#117777', shape: 'rect' },
  ],
  edges: [
    {
      id: 'ra',
      source: 'r',
      target: 'a',
      sourceSide: 'bottom',
      label: '连线 <文字> & 长标题'.repeat(6),
    },
    { id: 'ab', source: 'a', target: 'b', sourceSide: 'left' },
    { id: 'bb', source: 'b', target: 'b', sourceSide: 'top', label: '自环' },
  ],
};
async function load(page, data = diagram) {
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'drawing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#status')).toContainText('导入成功');
  await expect.poll(() => page.locator('#save-status').textContent()).not.toContain('正在自动保存');
}
async function exportCanvas(page) {
  await page.locator('.file-menu').evaluate((el) => {
    el.open = true;
  });
  const pending = page.waitForEvent('download');
  await page.click('#export-canvas-svg');
  const file = await pending;
  expect(file.suggestedFilename()).toBe('openmindmap-canvas.svg');
  let svg = '';
  for await (const chunk of await file.createReadStream()) svg += chunk.toString();
  return svg;
}
async function inspect(page, source) {
  return page.evaluate((svg) => {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const error = parsed.querySelector('parsererror')?.textContent;
    const root = document.importNode(parsed.documentElement, true);
    root.style.position = 'fixed';
    root.style.left = '-100000px';
    document.body.append(root);
    const viewBox = root.viewBox.baseVal;
    const bounds = { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height };
    const items = [...root.querySelectorAll('g[data-node-id],path[data-edge-id],text')].map(
      (el) => {
        const box = el.getBBox();
        const matrix = root.getScreenCTM().inverse().multiply(el.getScreenCTM());
        const corners = [
          [box.x, box.y],
          [box.x + box.width, box.y + box.height],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
        return { x: corners[0].x, y: corners[0].y, right: corners[1].x, bottom: corners[1].y };
      },
    );
    const result = {
      error,
      bounds,
      items,
      nodes: [...root.querySelectorAll('g[data-node-id]')].map((el) => ({
        id: el.getAttribute('data-node-id'),
        transform: el.getAttribute('transform'),
      })),
      edges: [...root.querySelectorAll('path[data-edge-id]')].map((el) => ({
        id: el.getAttribute('data-edge-id'),
        d: el.getAttribute('d'),
      })),
      text: root.textContent,
      forbidden: root.querySelectorAll('foreignObject,script,image,.handle,.selected').length,
      responsive: root.getAttribute('preserveAspectRatio'),
    };
    root.remove();
    return result;
  }, source);
}
test('画布 SVG 保留手绘坐标、实际连线与换行，自适应包含负坐标/菱形/自环/长标签', async ({
  page,
}) => {
  await load(page);
  const paths = await page
    .locator('#connections path[marker-end]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('d')));
  const loopLabelY = await page
    .locator('#connections text[data-edge-label="bb"]')
    .getAttribute('y');
  expect(Number(loopLabelY)).toBeLessThan(diagram.nodes.find((node) => node.id === 'b').y);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  const svg = await exportCanvas(page);
  const actual = await inspect(page, svg);
  expect(actual.error).toBeUndefined();
  expect(actual.forbidden).toBe(0);
  expect(actual.responsive).toBe('xMidYMid meet');
  const image = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const img = new Image();
    try {
      img.src = url;
      await img.decode();
      img.style.cssText = 'position:fixed;left:-10000px;width:300px;height:auto';
      document.body.append(img);
      const size = {
        width: img.width,
        height: img.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
      img.remove();
      return size;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, svg);
  expect(image.naturalWidth).toBeGreaterThan(0);
  expect(image.width).toBe(300);
  expect(image.width / image.height).toBeCloseTo(actual.bounds.width / actual.bounds.height, 1);
  expect(actual.nodes).toHaveLength(3);
  expect(actual.edges.map((edge) => edge.d)).toEqual(paths);
  for (const node of diagram.nodes) {
    const coords = actual.nodes
      .find((item) => item.id === node.id)
      .transform.match(/-?\d+(?:\.\d+)?/g)
      .map(Number);
    expect(coords).toEqual([node.x, node.y]);
    expect(svg).toContain(node.color);
  }
  expect(actual.text).toContain('第二行 <script> & "标签"');
  expect(actual.text).not.toContain('中心主题');
  expect(actual.text).not.toContain('已连接');
  const box = actual.bounds;
  expect(box.x).toBeLessThan(-240);
  expect(box.y).toBeLessThan(-320);
  for (const item of actual.items) {
    expect(item.x).toBeGreaterThanOrEqual(box.x - 0.1);
    expect(item.y).toBeGreaterThanOrEqual(box.y - 0.1);
    expect(item.right).toBeLessThanOrEqual(box.x + box.width + 0.1);
    expect(item.bottom).toBeLessThanOrEqual(box.y + box.height + 0.1);
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
});
test('画布 SVG 不受视口缩放/平移影响，单节点可导出且不包含选中工具', async ({ page }) => {
  await load(page, {
    rootId: 'r',
    mode: 'mindmap',
    nodes: [{ id: 'r', label: '单节点\n第二行', x: -40, y: 90, color: '#117777' }],
    edges: [],
  });
  await page.locator('.node.root').click();
  const first = await inspect(page, await exportCanvas(page));
  await page.locator('.file-menu').evaluate((el) => {
    el.open = false;
  });
  await page.click('#zoom-in');
  await page.click('#zoom-in');
  await page.mouse.move(30, 300);
  await page.mouse.down();
  await page.mouse.move(100, 340);
  await page.mouse.up();
  const second = await inspect(page, await exportCanvas(page));
  expect(second.nodes).toEqual(first.nodes);
  expect(second.forbidden).toBe(0);
  for (const key of ['x', 'y', 'width', 'height'])
    expect(second.bounds[key]).toBeCloseTo(first.bounds[key], 1);
});
test('从 Mermaid 视图导出原画布仍保留布局，不改变当前视图或撤销记录', async ({ page }) => {
  await load(page);
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible();
  const svg = await exportCanvas(page);
  await expect(page.locator('#output-view')).toBeVisible();
  await expect(page.locator('#canvas-view')).toBeHidden();
  const actual = await inspect(page, svg);
  expect(actual.nodes).toHaveLength(3);
  expect(actual.bounds.height).toBeGreaterThan(500);
  await page.locator('.file-menu').evaluate((el) => {
    el.open = false;
  });
  await page.click('#view-canvas');
  await page.click('#undo');
  await expect(page.locator('#nodes .node')).toHaveCount(1);
});
test('拖动节点与编辑标题后的画布 SVG 使用最新布局，不触发自动排版', async ({ page }) => {
  await load(page, {
    rootId: 'r',
    mode: 'mindmap',
    nodes: [{ id: 'r', label: '手画中心', x: 0, y: 0 }],
    edges: [],
  });
  const node = page.locator('.node.root');
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 65, box.y + 55, { steps: 5 });
  await page.mouse.up();
  await page.fill('#label', '最新手绘标题');
  const svg = await exportCanvas(page);
  const actual = await inspect(page, svg);
  expect(actual.text).toContain('最新手绘标题');
  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  const position = actual.nodes[0].transform.match(/-?\d+(?:\.\d+)?/g).map(Number);
  expect(position).toEqual([state.nodes[0].x, state.nodes[0].y]);
  expect(position[0]).not.toBe(0);
  expect(position[1]).not.toBe(0);
});
