import { test, expect } from '@playwright/test';
const KEY = 'mindmap-studio-state';
const tree = {
  rootId: 'r',
  mode: 'mindmap',
  nodes: [
    { id: 'r', label: '中心', x: 0, y: 0 },
    { id: 'a', label: '子主题', x: 230, y: 70 },
  ],
  edges: [{ id: 'ra', source: 'r', target: 'a' }],
};
async function load(page) {
  await page.locator('#file').setInputFiles({
    name: 'map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tree)),
  });
  await expect(page.locator('#status')).toContainText('导入成功');
}
async function saved(page) {
  await expect.poll(() => page.locator('#save-status').textContent()).not.toContain('正在自动保存');
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.node.root')).toBeVisible();
});
for (const size of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`属性面板 ${size.width}px 颜色与形状不重叠且编辑/断开/删除可用`, async ({ page }) => {
    await page.setViewportSize(size);
    await load(page);
    await page.locator('[data-id="a"]').click();
    const bounds = await page.locator('#selection-panel').evaluate((panel) => {
      const elements = [...panel.querySelectorAll('input,select,button')].filter(
        (el) => el.getClientRects().length,
      );
      const boxes = elements.map((el) => ({
        id: el.id,
        x: el.getBoundingClientRect().x,
        y: el.getBoundingClientRect().y,
        right: el.getBoundingClientRect().right,
        bottom: el.getBoundingClientRect().bottom,
      }));
      const labels = [...panel.querySelectorAll('.appearance label')].map((el) => ({
        width: el.getBoundingClientRect().width,
        text: el.textContent,
      }));
      return {
        box: panel.getBoundingClientRect().toJSON(),
        boxes,
        labels,
        overflow: panel.scrollWidth > panel.clientWidth,
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.labels[0].width).toBeGreaterThanOrEqual(44);
    for (let i = 0; i < bounds.boxes.length; i++) {
      const a = bounds.boxes[i];
      expect(a.x).toBeGreaterThanOrEqual(bounds.box.x);
      expect(a.right).toBeLessThanOrEqual(bounds.box.right);
      expect(a.bottom).toBeLessThanOrEqual(bounds.box.bottom);
      for (const b of bounds.boxes.slice(i + 1))
        expect(
          Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0,
          `${a.id}/${b.id} overlap`,
        ).toBe(false);
    }
    await page.fill('#label', '修改后的子主题');
    await page.press('#label', 'Enter');
    await page.locator('#color').fill('#117777');
    await page.locator('#color').dispatchEvent('change');
    await page.selectOption('#shape', 'diamond');
    const n = (await saved(page)).nodes.find((node) => node.id === 'a');
    expect(n).toMatchObject({ label: '修改后的子主题', color: '#117777', shape: 'diamond' });
    await expect(page.locator('[data-id="a"]')).toHaveClass(/diamond/);
    await expect(page.locator('[data-id="a"]')).toHaveCSS('--node-color', '#117777');
    await page.click('#detach');
    expect((await saved(page)).edges).toHaveLength(0);
    await expect(page.locator('#detach')).toBeDisabled();
    await page.click('#delete');
    await expect(page.locator('.node')).toHaveCount(1);
    await page.click('#undo');
    await expect(page.locator('.node')).toHaveCount(2);
    expect((await saved(page)).nodes.find((node) => node.id === 'a')).toMatchObject({
      label: '修改后的子主题',
      color: '#117777',
      shape: 'diamond',
    });
  });
}
test('输入标题后直接点击其他节点或空白不会丢失或修改错误节点', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.locator('[data-id="a"]').click();
  await page.fill('#label', '切换前输入的子主题');
  await page.locator('[data-id="r"]').click();
  let state = await saved(page);
  expect(state.nodes.find((n) => n.id === 'a').label).toBe('切换前输入的子主题');
  expect(state.nodes.find((n) => n.id === 'r').label).toBe('中心');
  await expect(page.locator('#label')).toHaveValue('中心');
  await page.fill('#label', '点击空白前输入的根');
  await page.locator('#viewport').click({ position: { x: 80, y: 160 } });
  state = await saved(page);
  expect(state.nodes.find((n) => n.id === 'r').label).toBe('点击空白前输入的根');
  await expect(page.locator('#selection-panel')).toBeHidden();
  await page.click('#undo');
  expect((await saved(page)).nodes.find((n) => n.id === 'r').label).toBe('中心');
  expect(errors).toEqual([]);
});
test('统一 OpenMindMap 品牌，移除旧只读入口及消息同步', async ({ page }) => {
  await expect(page).toHaveTitle('OpenMindMap');
  await expect(page.locator('.app-bar h1')).toHaveText('OpenMindMap');
  await page.click('#view-output');
  await expect(page.locator('#open-preview')).toHaveCount(0);
  await expect(page.locator('#preview svg')).toBeVisible();
  await page.goto('/?preview=1');
  await expect(page.locator('#viewport')).toBeVisible();
  await expect(page.locator('#code')).toHaveJSProperty('readOnly', false);
  await page.evaluate(() =>
    window.postMessage(
      { type: 'mindmap-preview', state: { nodes: [] }, code: 'unexpected' },
      location.origin,
    ),
  );
  await page.click('#view-output');
  await expect(page.locator('#code')).not.toHaveValue('unexpected');
  await page.fill('#code', 'flowchart TD\n A["同页手动预览"]');
  await page.click('#render');
  await expect(page.locator('#preview')).toContainText('同页手动预览');
});

test('标题尚未失焦时快捷键导出也包含最新文字', async ({ page }) => {
  await page.locator('.node.root').click();
  await page.fill('#label', '正在输入的备份标题');
  const pending = page.waitForEvent('download');
  await page.press('#label', 'Control+s');
  const download = await pending;
  expect(download.suggestedFilename()).toBe('openmindmap.json');
  const stream = await download.createReadStream();
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  const state = JSON.parse(contents);
  expect(state.nodes[0].label).toBe('正在输入的备份标题');
  expect((await saved(page)).nodes[0].label).toBe('正在输入的备份标题');
});
for (const mode of ['mindmap', 'flowchart']) {
  test(`颜色即时更新并保留到 ${mode} 预览、SVG、刷新与撤销`, async ({ page }) => {
    await load(page);
    await page.selectOption('#mode', mode);
    await page.locator('[data-id="a"]').click();
    await page.locator('#color').fill('#d02040');
    await expect(page.locator('[data-id="a"]')).toHaveCSS('border-top-color', 'rgb(208, 32, 64)');
    expect((await saved(page)).nodes.find((node) => node.id === 'a').color).toBe('#d02040');
    await expect(page.locator('#code')).toHaveValue(/#d02040/);
    await page.click('#view-output');
    await expect(page.locator('#preview svg')).toBeVisible();
    const shapes =
      mode === 'mindmap'
        ? page.locator('#preview .omm-color-n1 .label-container')
        : page.locator('#preview .node').filter({ hasText: '子主题' }).locator('.label-container');
    await expect(shapes.first()).toHaveCSS('stroke', 'rgb(208, 32, 64)');
    const downloaded = page.waitForEvent('download');
    await page.click('#download-svg');
    const stream = await (await downloaded).createReadStream();
    let svg = '';
    for await (const chunk of stream) svg += chunk.toString();
    expect(svg).toMatch(/#d02040|rgb\(208,\s*32,\s*64\)/);
    await page.reload();
    await page.click('#view-canvas');
    await page.locator('[data-id="a"]').click();
    await expect(page.locator('#color')).toHaveValue('#d02040');
    await expect(page.locator('[data-id="a"]')).toHaveCSS('border-top-color', 'rgb(208, 32, 64)');
    await page.locator('#color').fill('#117777');
    await page.click('#undo');
    await expect(page.locator('[data-id="a"]')).toHaveCSS('border-top-color', 'rgb(208, 32, 64)');
  });
}

test('原生颜色选择器仅发送 change 时仍保存颜色，两种事件不会重复产生撤销', async ({ page }) => {
  await load(page);
  await page.locator('[data-id="a"]').click();
  await page.locator('#color').evaluate((input) => {
    input.value = '#2468ac';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('[data-id="a"]')).toHaveCSS('border-top-color', 'rgb(36, 104, 172)');
  expect((await saved(page)).nodes.find((node) => node.id === 'a').color).toBe('#2468ac');
  await page.locator('#color').evaluate((input) => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('#undo');
  await expect(page.locator('[data-id="a"]')).toHaveCSS('border-top-color', 'rgb(51, 51, 51)');
});

for (const mode of ['mindmap', 'flowchart']) {
  test(`默认黑字 ${mode} 多分支、白底彩色节点及 SVG 导出均保持可读`, async ({ page }) => {
    await load(page);
    await page.selectOption('#mode', mode);
    await page.locator('[data-id="r"]').click();
    await page.click('#child');
    await page.fill('#label', '另一分支');
    await page.press('#label', 'Enter');
    await page.locator('#color').fill('#d02040');
    await expect(page.locator('.node-title').last()).toHaveCSS('color', 'rgb(0, 0, 0)');
    await page.click('#view-output');
    await expect(page.locator('#preview svg')).toBeVisible();
    const texts = page.locator('#preview .node text, #preview .node .nodeLabel');
    expect(await texts.count()).toBeGreaterThanOrEqual(3);
    for (const text of await texts.all()) {
      const property = await text.evaluate((el) =>
        el.tagName.toLowerCase() === 'text' ? 'fill' : 'color',
      );
      await expect(text).toHaveCSS(property, 'rgb(0, 0, 0)');
    }
    const pending = page.waitForEvent('download');
    await page.click('#download-svg');
    let source = '';
    for await (const chunk of await (await pending).createReadStream()) source += chunk.toString();
    const fills = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const image = document.importNode(doc.documentElement, true);
      image.style.position = 'fixed';
      image.style.left = '-100000px';
      document.body.append(image);
      const values = [...image.querySelectorAll('.node text, .node .nodeLabel')].map((el) =>
        el.tagName.toLowerCase() === 'text'
          ? getComputedStyle(el).fill
          : getComputedStyle(el).color,
      );
      image.remove();
      return values;
    }, source);
    expect(fills.length).toBeGreaterThanOrEqual(3);
    expect(fills.every((fill) => fill === 'rgb(0, 0, 0)')).toBe(true);
  });
}
