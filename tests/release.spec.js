import { test, expect } from '@playwright/test';
const KEY = 'mindmap-studio-state';
const tree = {
  mode: 'mindmap',
  rootId: 'r',
  nodes: [
    { id: 'r', label: '中心', x: 0, y: 0 },
    { id: 'a', label: '子节点', x: 230, y: 0 },
  ],
  edges: [{ id: 'ra', source: 'r', target: 'a' }],
};
const saved = async (page) => {
  await expect(page.locator('#save-status')).not.toContainText('正在自动保存');
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
};
async function load(page, data) {
  await page.locator('#file').setInputFiles({
    name: 'map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#status')).toContainText('导入成功');
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.node.root')).toBeVisible();
});
test('同内容导入同步选择、属性与后续操作', async ({ page }) => {
  await load(page, tree);
  const same = await saved(page);
  await page.locator('[data-id="a"]').click();
  await load(page, same);
  await expect(page.locator('[data-id="r"]')).toHaveClass(/selected/);
  await expect(page.locator('#label')).toHaveValue('中心');
  await page.fill('#label', '正确根');
  await page.press('#label', 'Enter');
  await expect.poll(async () => (await saved(page)).nodes[0].label).toBe('正确根');
  expect((await saved(page)).nodes[1].label).toBe('子节点');
});
test('拖动中删除与撤销无未处理异常、无临时位置入库', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page, tree);
  const box = await page.locator('[data-id="a"]').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 50, { steps: 6 });
  expect((await saved(page)).nodes[1].x).toBe(230);
  await page.keyboard.press('Delete');
  await page.mouse.move(box.x + 130, box.y + 90);
  await page.mouse.up();
  await expect(page.locator('.node')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.node')).toHaveCount(2);
  const root = await page.locator('.node.root').boundingBox();
  await page.mouse.move(root.x + 20, root.y + 20);
  await page.mouse.down();
  await page.mouse.move(root.x + 60, root.y + 60);
  await page.keyboard.press('Control+z');
  await page.mouse.move(root.x + 80, root.y + 80);
  await page.mouse.up();
  expect(errors).toEqual([]);
});
test('损坏存档原文保留且可以导出恢复', async ({ page }) => {
  const raw = '{"rootId":"missing","nodes":[{"id":"keep","label":"珍贵内容"}]}';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: KEY, raw });
  await page.reload();
  await expect(page.locator('.node.root')).toBeVisible();
  await page.click('.file-menu summary');
  await expect(page.locator('#recover')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.click('#recover');
  const stream = await (await pending).createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  expect(text).toBe(raw);
});
test('另一编辑窗口更新不会丢失旧窗口草稿，显式载入恢复同步', async ({ page, context }) => {
  test.setTimeout(120000);
  await load(page, tree);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('.node')).toHaveCount(2);
  await page.locator('.node.root').click();
  await page.fill('#label', '窗口 A');
  await page.press('#label', 'Enter');
  await expect.poll(async () => (await saved(page)).nodes[0].label).toBe('窗口 A');
  await other.bringToFront();
  await other.click('.file-menu summary');
  await expect(other.locator('#save-status')).toContainText('其他窗口');
  await other.click('.file-menu summary');
  await other.locator('.node.root').click();
  await other.fill('#label', '窗口 B 草稿');
  await other.press('#label', 'Enter');
  await expect(other.locator('#save-status')).toContainText('冲突');
  expect((await saved(page)).nodes[0].label).toBe('窗口 A');
  await expect(other.locator('#label')).toHaveValue('窗口 B 草稿');
  other.once('dialog', (dialog) => dialog.accept());
  await other.click('.file-menu summary');
  await other.click('#reload-saved');
  await expect(other.locator('#code')).toHaveValue(/窗口 A/);
  await other.close();
});
test('超过旧 50k 限制的合法图可预览，不导出限制提示图', async ({ page }) => {
  test.setTimeout(90000);
  const data = {
    rootId: 'r',
    mode: 'mindmap',
    nodes: [{ id: 'r', label: '较长导图', x: 0, y: 0 }],
    edges: [],
  };
  for (let i = 0; i < 110; i++) {
    data.nodes.push({ id: `n${i}`, label: '长'.repeat(500), x: i * 10, y: i * 5 });
    data.edges.push({ id: `e${i}`, source: 'r', target: `n${i}` });
  }
  await load(page, data);
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#preview')).not.toContainText('Maximum text size');
  await expect(page.locator('#preview')).toContainText('较长导图');
  const pending = page.waitForEvent('download');
  await page.click('#download-svg');
  const stream = await (await pending).createReadStream();
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  expect(contents).toContain('较长导图');
  expect(contents).not.toContain('Maximum text size');
});
test('超过旧 500 边限制的自由图可以预览', async ({ page }) => {
  test.setTimeout(90000);
  const data = {
    rootId: 'r',
    mode: 'flowchart',
    nodes: [{ id: 'r', label: '中心', x: 0, y: 0 }],
    edges: [],
  };
  for (let i = 0; i < 26; i++)
    data.nodes.push({
      id: `n${i}`,
      label: `节点${i}`,
      x: (i % 8) * 200,
      y: Math.floor(i / 8) * 100,
    });
  for (let i = 0; i < 501; i++)
    data.edges.push({
      id: `e${i}`,
      source: `n${i % 26}`,
      target: `n${(Math.floor(i / 26) + i + 1) % 26}`,
    });
  await load(page, data);
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#status')).not.toContainText('渲染失败');
  expect((await saved(page)).edges).toHaveLength(501);
});
test('手动代码超限/语法错误不能导出旧 SVG，恢复有效代码可导出', async ({ page }) => {
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible();
  await page.fill('#code', 'flowchart TD\n A[');
  await page.click('#render');
  await expect(page.locator('#status')).toContainText('渲染失败');
  await page.click('#download-svg');
  await expect(page.locator('#status')).toContainText('成功渲染');
  await page.fill('#code', ' '.repeat(2 * 1024 * 1024 + 1));
  await page.click('#render');
  await expect(page.locator('#status')).toContainText('2 MB');
  await page.click('#regenerate');
  await expect(page.locator('#preview svg')).toBeVisible();
});
test('初始画布不加载 Mermaid 大包，输出按需加载', async ({ page }) => {
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );
  expect(resources.some((url) => /mermaid(?:\.core)?[-_.]/i.test(url))).toBe(false);
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible();
});
test('生产构建同时提供许可证和第三方声明', async ({ request }) => {
  test.skip(process.env.TEST_PRODUCTION !== '1', '分发资源由生产构建生成');
  const license = await request.get('/LICENSE');
  expect(license.ok()).toBe(true);
  const licenseText = await license.text();
  expect(licenseText).toContain('GNU GENERAL PUBLIC LICENSE');
  expect(licenseText).toContain('Version 3, 29 June 2007');
  const notices = await request.get('/THIRD_PARTY_NOTICES.md');
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain('mermaid');
});

test('与限制提示相同的普通标签仍可渲染导出', async ({ page }) => {
  await page.locator('.node.root').click();
  await page.fill('#label', 'Maximum text size in diagram exceeded');
  await page.press('#label', 'Enter');
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.click('#download-svg');
  expect((await pending).suggestedFilename()).toBe('openmindmap.svg');
});
