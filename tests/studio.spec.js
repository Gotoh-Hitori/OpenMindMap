import { test, expect } from '@playwright/test';
const KEY = 'mindmap-studio-state';
const saved = async (page) => {
  await expect(page.locator('#save-status')).not.toContainText('正在自动保存');
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
};
const root = (page) => page.locator('#nodes .node.root');
const nodes = (page) => page.locator('#nodes .node');
async function load(page, data) {
  await page.locator('#file').setInputFiles({
    name: 'map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#status')).toContainText('导入成功');
}
async function output(page) {
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible();
}
async function link(page, source, target, side = 'right') {
  await page.locator(`#nodes [data-id="${source}"]`).click();
  const a = await page
    .locator(`#nodes [data-id="${source}"] .handle[data-side="${side}"]`)
    .boundingBox();
  const b = await page.locator(`#nodes [data-id="${target}"]`).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}
const tree = {
  rootId: 'r',
  mode: 'mindmap',
  nodes: [
    { id: 'r', label: '项目', x: 0, y: 0 },
    { id: 'a', label: '设计', x: 230, y: 0 },
    { id: 'b', label: '开发', x: 230, y: 150 },
    { id: 'c', label: '测试', x: 460, y: 150 },
  ],
  edges: [
    { id: 'ra', source: 'r', target: 'a' },
    { id: 'rb', source: 'r', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(root(page)).toBeVisible();
});
test('全窗口画布及独立视图保留位置', async ({ page }) => {
  await expect(page.locator('#selection-panel')).toBeHidden();
  const bounds = await page.locator('#viewport').boundingBox();
  expect(bounds).toMatchObject({ width: 1440, height: 936 });
  const transform = await page.locator('#world').getAttribute('style');
  await output(page);
  await expect(page.locator('#canvas-view')).toBeHidden();
  await page.click('#view-canvas');
  expect(await page.locator('#world').getAttribute('style')).toBe(transform);
});
test('双击创建、拖拽、中文标题和键盘撤销重做', async ({ page }) => {
  await page.locator('#viewport').dblclick({ position: { x: 300, y: 400 } });
  await expect(nodes(page)).toHaveCount(2);
  await page.fill('#label', '产品研究');
  await page.press('#label', 'Enter');
  let before = (await saved(page)).nodes[1];
  const box = await nodes(page).nth(1).boundingBox();
  await page.mouse.move(box.x + 35, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 70, { steps: 8 });
  await page.mouse.up();
  expect((await saved(page)).nodes[1].x).toBeGreaterThan(before.x);
  await page.keyboard.press('Control+z');
  expect((await saved(page)).nodes[1].x).toBe(before.x);
  await page.keyboard.press('Control+Shift+z');
  expect((await saved(page)).nodes[1].x).toBeGreaterThan(before.x);
  await output(page);
  await expect(page.locator('#preview')).toContainText('产品研究');
});
test('Tab 添加子节点，Delete 删除保留后代，根节点受保护', async ({ page }) => {
  await load(page, tree);
  await page.locator('#nodes [data-id="b"]').click();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(3);
  expect((await saved(page)).nodes.find((n) => n.id === 'c').parentId).toBeNull();
  await root(page).click();
  await page.keyboard.press('Tab');
  await expect(nodes(page)).toHaveCount(4);
  await root(page).click();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(4);
});
for (const side of ['top', 'right', 'bottom', 'left'])
  test(`${side}连接点可连线与取消`, async ({ page }) => {
    await load(page, { ...tree, nodes: tree.nodes.slice(0, 2), edges: [] });
    await link(page, 'r', 'a', side);
    expect((await saved(page)).edges).toHaveLength(1);
    expect((await saved(page)).edges[0].sourceSide).toBe(side);
    await page.locator('#nodes [data-id="a"]').click();
    await page.click('#detach');
    expect((await saved(page)).edges).toHaveLength(0);
    await output(page);
    await expect(page.locator('#preview')).toContainText('未连接节点');
  });
test('拖到空白不产生连线，禁止根节点父级与重复父级', async ({ page }) => {
  await load(page, tree);
  await link(page, 'a', 'r');
  expect((await saved(page)).edges).toHaveLength(3);
  await link(page, 'a', 'c');
  expect((await saved(page)).edges).toHaveLength(3);
  await page.locator('#nodes [data-id="a"]').click();
  const h = await page.locator('#nodes [data-id="a"] .handle[data-side="bottom"]').boundingBox();
  await page.mouse.move(h.x + 7, h.y + 7);
  await page.mouse.down();
  await page.mouse.move(300, 800);
  await page.mouse.up();
  expect((await saved(page)).edges).toHaveLength(3);
});
test('选择连线编辑文字、循环与多父级，仅自由图允许', async ({ page }) => {
  await load(page, { ...tree, mode: 'flowchart' });
  await link(page, 'c', 'r');
  await link(page, 'a', 'c');
  expect((await saved(page)).edges).toHaveLength(5);
  await page.selectOption('#mode', 'mindmap');
  expect(await page.locator('#mode').inputValue()).toBe('flowchart');
  await page
    .locator('#connections path[stroke="transparent"]')
    .first()
    .evaluate((el) => {
      const p = el.getPointAtLength(el.getTotalLength() / 2);
      const pt = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
      el.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: pt.x, clientY: pt.y }),
      );
    });
  await page.fill('#edge-label', '条件 "通过" | # <安全>');
  await page.locator('#edge-label').blur();
  await output(page);
  await expect(page.locator('#preview')).toContainText('条件');
  await expect(page.locator('#preview')).toContainText('通过');
});
test('特殊标签、emoji和HTML作为文字显示', async ({ page }) => {
  const label = '中文 😀 " [] {} () | # & <img src=x onerror=alert(1)>';
  await root(page).click();
  await page.fill('#label', label);
  await page.press('#label', 'Enter');
  await output(page);
  await expect(page.locator('#preview')).toContainText('中文');
  expect(await page.locator('#preview img').count()).toBe(0);
  await expect(page.locator('#status')).not.toContainText('渲染失败');
});
test('多种形状和颜色可正确渲染', async ({ page }) => {
  await page.selectOption('#mode', 'flowchart');
  await root(page).click();
  for (const shape of ['rounded', 'rect', 'circle', 'diamond']) {
    await page.selectOption('#shape', shape);
    await page.locator('#color').fill('#123456');
    await page.locator('#color').dispatchEvent('change');
    await output(page);
    await expect(page.locator('#status')).not.toContainText('渲染失败');
    await page.click('#view-canvas');
    await root(page).click();
  }
  expect((await saved(page)).nodes[0].color).toBe('#123456');
});
test('平移缩放不改图数据，适应与排版不丢节点', async ({ page }) => {
  await load(page, tree);
  const before = await saved(page);
  await page.mouse.move(300, 700);
  await page.mouse.down();
  await page.mouse.move(450, 750, { steps: 8 });
  await page.mouse.up();
  await page.click('#zoom-in');
  await page.click('#zoom-out');
  expect(await saved(page)).toEqual(before);
  await page.click('#layout');
  expect((await saved(page)).nodes).toHaveLength(4);
  expect((await saved(page)).edges).toEqual(before.edges);
  await page.click('#fit');
  for (const n of await nodes(page).all()) await expect(n).toBeInViewport();
});
test('JSON、mmd、SVG 导出内容及旧存档导入', async ({ page }) => {
  await load(page, {
    rootId: 'r',
    nodes: [
      { id: 'r', label: '备份', x: 1, y: 1 },
      { id: 'a', label: '旧格式', x: 200, y: 50, parentId: 'r' },
    ],
  });
  await page.click('.file-menu summary');
  let pending = page.waitForEvent('download');
  await page.click('#export');
  const json = await pending;
  const stream = await json.createReadStream();
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  expect(JSON.parse(contents)).toEqual(await saved(page));
  await output(page);
  pending = page.waitForEvent('download');
  await page.click('#download-code');
  expect((await pending).suggestedFilename()).toBe('openmindmap.mmd');
  await expect(page.locator('#preview')).toContainText('旧格式');
  pending = page.waitForEvent('download');
  await page.click('#download-svg');
  const svg = await pending;
  const svgStream = await svg.createReadStream();
  let text = '';
  for await (const chunk of svgStream) text += chunk.toString();
  expect(text).toContain('<svg');
  expect(text).toContain('旧格式');
});
for (const [name, data] of [
  ['缺失根', {}],
  ['重复ID', { ...tree, nodes: [...tree.nodes, tree.nodes[0]] }],
  ['环', { ...tree, edges: [...tree.edges, { id: 'loop', source: 'c', target: 'b' }] }],
  ['无穷坐标', { ...tree, nodes: [{ id: 'r', label: '错误', x: 'bad' }] }],
])
  test(`非法导入${name}不覆盖原图`, async ({ page }) => {
    const before = await saved(page);
    await page.locator('#file').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await expect(page.locator('#status')).toContainText('导入失败');
    expect(await saved(page)).toEqual(before);
  });
test('无效JSON与超大文件被拒绝', async ({ page }) => {
  const before = await saved(page);
  for (const buffer of [Buffer.from('{bad'), Buffer.alloc(2 * 1024 * 1024 + 1, 32)]) {
    await page
      .locator('#file')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer });
    await expect(page.locator('#status')).toContainText('导入失败');
    expect(await saved(page)).toEqual(before);
  }
});
test('刷新恢复，取消新建，确定新建后可撤销', async ({ page }) => {
  await load(page, tree);
  await page.reload();
  expect(await saved(page)).toEqual({
    ...tree,
    nodes: tree.nodes.map((n) => ({
      ...n,
      parentId: n.id === 'a' || n.id === 'b' ? 'r' : n.id === 'c' ? 'b' : null,
    })),
  });
  await page.click('.file-menu summary');
  page.once('dialog', (d) => d.dismiss());
  await page.click('#new');
  await expect(nodes(page)).toHaveCount(4);
  page.once('dialog', (d) => d.accept());
  await page.click('#new');
  await expect(nodes(page)).toHaveCount(1);
  await page.click('#undo');
  await expect(nodes(page)).toHaveCount(4);
});
test('错误 Mermaid 恢复，连续编辑最终预览对应最新代码', async ({ page }) => {
  await output(page);
  await page.fill('#code', 'flowchart TD\n A[');
  await page.click('#render');
  await expect(page.locator('#status')).toContainText('渲染失败');
  await page.fill('#code', 'flowchart TD\n A["最新结果"] --> B["完成"]');
  await page.click('#render');
  await expect(page.locator('#preview')).toContainText('最新结果');
  await expect(page.locator('#code-state')).toContainText('已同步到画布');
  await page.click('#regenerate');
  await expect(page.locator('#preview')).toContainText('最新结果');
});
test('预览视图的删除键不应修改画布', async ({ page }) => {
  await root(page).click();
  await page.click('#child');
  const before = await saved(page);
  await output(page);
  await page.click('#view-output');
  await page.keyboard.press('Delete');
  expect(await saved(page)).toEqual(before);
});
test('200节点完整排版和生成，预览包含最后一个节点', async ({ page }) => {
  const data = {
    rootId: 'r',
    mode: 'mindmap',
    nodes: [{ id: 'r', label: '压力测试', x: 0, y: 0 }],
    edges: [],
  };
  for (let i = 0; i < 199; i++) {
    data.nodes.push({ id: `n${i}`, label: `主题${i}`, x: 0, y: 0 });
    data.edges.push({
      id: `e${i}`,
      source: i < 10 ? 'r' : `n${Math.floor((i - 10) / 10)}`,
      target: `n${i}`,
    });
  }
  await load(page, data);
  await page.click('#layout');
  await expect(nodes(page)).toHaveCount(200);
  await output(page);
  await expect(page.locator('#preview')).toContainText('主题198');
});
test('手机全窗口、节点新增和预览可访问', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#fit');
  await root(page).click();
  await page.click('#child');
  await expect(nodes(page)).toHaveCount(2);
  await output(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#download-svg')).toBeVisible();
});

test('剪贴板复制实际代码 @chromium', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await output(page);
  await page.click('#copy');
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    await page.locator('#code').inputValue(),
  );
});
test('禁用存储后仍可画图并提示手动备份', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  const page = await context.newPage();
  await page.goto('/');
  await root(page).click();
  await page.click('#child');
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.locator('#save-status')).toContainText('无法自动保存');
  await output(page);
  await expect(page.locator('#preview')).toContainText('子主题');
  await context.close();
});
test('损坏的历史存档不阻塞初始化', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('mindmap-studio-state', '{"bad":'));
  const page = await context.newPage();
  await page.goto('/');
  await expect(root(page)).toBeVisible();
  await page.click('#add');
  await expect(nodes(page)).toHaveCount(2);
  await context.close();
});
test('触屏拖拽真实指针事件可保存节点位置 @chromium', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(root(page)).toBeVisible();
  const before = await saved(page);
  const box = await root(page).boundingBox();
  const session = await context.newCDPSession(page);
  const start = { x: box.x + 30, y: box.y + 20 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 45, y: start.y + 70 }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(async () => (await saved(page)).nodes[0].y)
    .toBeGreaterThan(before.nodes[0].y + 20);
  await context.close();
});

test('长标题的实际高度参与适应画布', async ({ page }) => {
  await root(page).click();
  await page.fill('#label', '长标题测试'.repeat(90));
  await page.press('#label', 'Enter');
  await page.click('#fit');
  await expect(root(page)).toBeInViewport({ ratio: 1 });
  const box = await root(page).boundingBox();
  expect(box.y + box.height).toBeLessThan(1000);
  await output(page);
  await expect(page.locator('#preview')).toContainText('长标题测试');
});
test('连线删除可撤销且最后一条不会在刷新后复活', async ({ page }) => {
  await load(page, { ...tree, nodes: tree.nodes.slice(0, 2), edges: tree.edges.slice(0, 1) });
  await page
    .locator('#connections path[stroke="transparent"]')
    .first()
    .dispatchEvent('pointerdown');
  await page.click('#delete');
  expect((await saved(page)).edges).toHaveLength(0);
  await page.reload();
  expect((await saved(page)).edges).toHaveLength(0);
  await output(page);
  await expect(page.locator('#preview')).toContainText('未连接节点');
});
