import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const saved = async () => {
  await expect(page.locator('#save-status')).not.toContainText('正在自动保存');
  return page.evaluate(() => JSON.parse(localStorage.getItem('mindmap-studio-state')));
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeAttached();
  await page.click('#view-canvas');
  await page.click('#nodes .node.root');
  await page.click('#child');
  await expect(page.locator('#nodes .node')).toHaveCount(2);
  assert.equal((await saved()).edges.length, 1);
  await page.fill('#label', '特殊 " [方括号] | # <文字> (测试)');
  await page.press('#label', 'Enter');
  await expect(page.locator('#preview svg')).toBeAttached();
  await page.click('#detach');
  assert.equal((await saved()).edges.length, 0);
  assert.match(await page.inputValue('#code'), /^mindmap$/m);
  assert.match(await page.inputValue('#code'), /未连接节点/);
  await page.click('#undo');
  assert.equal((await saved()).edges.length, 1);
  await page.click('#redo');
  assert.equal((await saved()).edges.length, 0);
  await page.click('#nodes .node.root');
  await page.click('#fit');
  const source = await page.locator('#nodes .node.root .handle[data-side="right"]').boundingBox();
  const target = await page.locator('#nodes .node').nth(1).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.equal((await saved()).edges.length, 1);
  const before = (await saved()).nodes[1];
  const box = await page.locator('#nodes .node').nth(1).boundingBox();
  await page.mouse.move(box.x + 50, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 105, box.y + 70, { steps: 10 });
  await page.mouse.up();
  assert.ok((await saved()).nodes[1].x > before.x + 10);
  await page.click('#undo');
  assert.equal((await saved()).nodes[1].x, before.x);
  await page.selectOption('#mode', 'flowchart');
  await page.click('#nodes .node:not(.root)');
  await page.selectOption('#shape', 'diamond');
  await expect(page.locator('#preview svg')).toBeAttached();
  assert.match(await page.inputValue('#code'), /n1\{/);
  await page.click('#fit');
  const handle = await page
    .locator('#nodes .node:not(.root) .handle[data-side="left"]')
    .boundingBox();
  const root = await page.locator('#nodes .node.root').boundingBox();
  await page.mouse.move(handle.x + 7, handle.y + 7);
  await page.mouse.down();
  await page.mouse.move(root.x + 80, root.y + 35, { steps: 10 });
  await page.mouse.up();
  assert.equal((await saved()).edges.length, 2);
  await page.selectOption('#mode', 'mindmap');
  assert.equal(await page.inputValue('#mode'), 'flowchart');
  assert.match(await page.textContent('#status'), /循环/);
  await page.click('#view-output');
  await page.click('#render');
  await expect(page.locator('#preview svg')).toBeAttached();
  await page.click('.file-menu summary');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#export');
  assert.equal((await downloadPromise).suggestedFilename(), 'openmindmap.json');
  await page.reload();
  await expect(page.locator('#nodes .node')).toHaveCount(2);
  assert.equal((await saved()).mode, 'flowchart');
  await page.click('#view-output');
  await expect(page.locator('#preview svg')).toBeAttached();
  await page.click('#view-output');
  await page.fill('#code', 'flowchart TD\n A["manual"] --> B["preview"]');
  await page.click('#view-output');
  await page.click('#render');
  await expect(page.locator('#preview')).toContainText('manual');
  await page.click('#regenerate');
  await expect(page.locator('#preview svg')).toBeAttached();
  await page.click('#view-canvas');
  await expect(page.locator('#viewport')).toBeVisible();
  await expect(page.locator('#output-view')).toBeHidden();
  const bounds = await page.locator('#viewport').boundingBox();
  assert.equal(bounds.width, 1440);
  assert.equal(bounds.height, 936);
  const valid = await saved();
  await page.locator('#file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ nodes: [] })),
  });
  await expect(page.locator('#status')).toContainText('导入失败');
  assert.deepEqual(await saved(), valid);
  const imported = {
    rootId: 'root',
    nodes: [
      { id: 'root', label: '导入测试', x: 0, y: 0, parentId: null },
      { id: 'child', label: '子节点', x: 220, y: 50, parentId: 'root' },
    ],
  };
  await page.locator('#file').setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.locator('#nodes .node')).toHaveCount(2);
  assert.equal((await saved()).edges.length, 1);
  await expect(page.locator('#preview svg')).toBeAttached();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Mermaid rendering, special labels, child/detach, undo/redo, connector drag, node drag, graph cycles, reload, export, manual code, mobile layout',
  );
} finally {
  await browser.close();
}
