import { test, expect } from '@playwright/test';
const KEY = 'mindmap-studio-state';
const base = {
  mode: 'mindmap',
  rootId: 'r',
  nodes: [
    { id: 'r', label: '根', x: 0, y: 0 },
    { id: 'a', label: '叶子', x: 230, y: 0 },
  ],
  edges: [{ id: 'e', source: 'r', target: 'a' }],
};
async function load(page, data) {
  await page.locator('#file').setInputFiles({
    name: 'map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#status')).toContainText('导入成功');
  await expect(page.locator('#save-status')).not.toContainText('正在自动保存');
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.node.root')).toBeVisible();
});
test('大图拖动复用已有 SVG 连线并只提交最终位置', async ({ page }) => {
  const data = structuredClone(base);
  for (let i = 0; i < 198; i++) {
    data.nodes.push({ id: `n${i}`, label: `节点${i}`, x: 1000 + i * 5, y: i * 10 });
    data.edges.push({ id: `e${i}`, source: 'r', target: `n${i}` });
  }
  await load(page, data);
  await page.click('#fit');
  const box = await page.locator('[data-id="a"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    window.__originalPath = document.querySelector('#connections path[marker-end]');
    window.__pathMutations = 0;
    window.__observer = new MutationObserver((records) => {
      window.__pathMutations += records.filter((record) => record.type === 'childList').length;
    });
    window.__observer.observe(document.getElementById('connections'), {
      childList: true,
      subtree: true,
    });
  });
  await page.mouse.move(500, 500, { steps: 20 });
  expect(
    await page.evaluate(
      () => window.__originalPath === document.querySelector('#connections path[marker-end]'),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.__pathMutations)).toBe(0);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).nodes.find((n) => n.id === 'a').x,
      KEY,
    ),
  ).toBe(230);
  await page.mouse.up();
  await page.evaluate(() => window.__observer.disconnect());
  await expect(page.locator('#save-status')).not.toContainText('正在自动保存');
});
test('超节点/连线边界在校验前拒绝，保留原图', async ({ page }) => {
  await load(page, base);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  const manyNodes = {
    ...base,
    nodes: Array.from({ length: 1001 }, (_, i) => ({
      id: i === 0 ? 'r' : `n${i}`,
      label: '节点',
      x: 0,
      y: 0,
    })),
  };
  const manyEdges = {
    ...base,
    mode: 'flowchart',
    edges: Array.from({ length: 5001 }, (_, i) => ({ id: `e${i}`, source: 'r', target: 'a' })),
  };
  for (const [data, message] of [
    [manyNodes, '1000'],
    [manyEdges, '5000'],
  ]) {
    await page.locator('#file').setInputFiles({
      name: 'too-big.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await expect(page.locator('#status')).toContainText(message);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);
  }
});
test('快速连续导入以最后一次选择为准，旧异步读取不覆盖', async ({ page }) => {
  await page.evaluate(() => {
    const original = File.prototype.text;
    let first = true;
    File.prototype.text = function () {
      if (!first) return original.call(this);
      first = false;
      return original.call(this).then(
        (text) =>
          new Promise((resolve) => {
            window.__resolveImport = () => resolve(text);
          }),
      );
    };
  });
  await page.locator('#file').setInputFiles({
    name: 'first.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...base, nodes: [{ ...base.nodes[0], label: '旧导入' }], edges: [] }),
    ),
  });
  await load(page, { ...base, nodes: [{ ...base.nodes[0], label: '最后导入' }], edges: [] });
  await page.evaluate(() => window.__resolveImport());
  await expect(page.locator('#code')).toHaveValue(/最后导入/);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).nodes[0].label, KEY),
  ).toBe('最后导入');
});
test('剪贴板被拒绝时选中完整代码供手动复制', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('denied');
        },
      },
    });
  });
  await page.click('#view-output');
  await page.click('#copy');
  await expect(page.locator('#status')).toContainText('手动复制');
  expect(await page.locator('#code').evaluate((el) => el.selectionEnd - el.selectionStart)).toBe(
    (await page.locator('#code').inputValue()).length,
  );
});
test('损坏备份写入失败时保留原存档，画布仍可编辑', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript((key) => {
    localStorage.setItem(key, 'important damaged original');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith(key + '-recovery')) throw Error('full');
      return original.call(this, name, value);
    };
  }, KEY);
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('.node.root').click();
  await page.click('#child');
  await expect(page.locator('.node')).toHaveCount(2);
  await expect(page.locator('#save-status')).toContainText('无法自动保存');
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    'important damaged original',
  );
  await context.close();
});
