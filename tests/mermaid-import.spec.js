import { test, expect } from '@playwright/test';
const KEY = 'mindmap-studio-state';
async function saved(page) {
  await expect.poll(() => page.locator('#save-status').textContent()).not.toContain('正在自动保存');
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
}
async function paste(page, code) {
  await page.click('#view-output');
  await page.fill('#code', code);
  await expect(page.locator('#code-state')).toContainText('已同步到画布');
  await expect(page.locator('#code')).toHaveValue(code);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.node.root')).toBeVisible();
});
test('粘贴 flowchart 自动生成节点/关系/颜色，画布修改后重新生成代码并可撤销', async ({ page }) => {
  const code =
    'flowchart LR\n A(("开始")) -->|进入| B{"判断"}\n B --> C["结果"]\n C --> A\n style B fill:#ffffff,stroke:#d02040';
  await paste(page, code);
  let state = await saved(page);
  expect(state.mode).toBe('flowchart');
  expect(state.nodes).toHaveLength(3);
  expect(state.edges).toHaveLength(3);
  expect(state.nodes.find((n) => n.id === 'B')).toMatchObject({
    label: '判断',
    shape: 'diamond',
    color: '#d02040',
  });
  expect(state.edges.some((e) => e.label === '进入')).toBe(true);
  await page.click('#view-canvas');
  await page.locator('[data-id="B"]').click();
  await page.fill('#label', '修改判断');
  await page.press('#label', 'Enter');
  await expect(page.locator('#code')).toHaveValue(/修改判断/);
  await page.click('#undo');
  expect((await saved(page)).nodes.find((n) => n.id === 'B').label).toBe('判断');
  await page.click('#undo');
  await expect(page.locator('#nodes .node')).toHaveCount(1);
});
test('粘贴 mindmap 树可编辑，中文/emoji/多层节点及形状保留，刷新恢复', async ({ page }) => {
  await paste(
    page,
    'mindmap\n  root((学习 🧠))\n    a[中文主题]\n      b(深入学习)\n    c((另一主题))',
  );
  const state = await saved(page);
  expect(state.mode).toBe('mindmap');
  expect(state.nodes).toHaveLength(4);
  expect(state.edges).toHaveLength(3);
  expect(state.nodes.find((n) => n.id === state.rootId).label).toBe('学习 🧠');
  await page.click('#view-canvas');
  await expect(page.locator('#nodes')).toContainText('深入学习');
  await page.reload();
  await expect(page.locator('#nodes .node')).toHaveCount(4);
});
test('无效代码及其他图类型不覆盖画布，其他类型仍可预览', async ({ page }) => {
  const before = await saved(page);
  await page.click('#view-output');
  await page.fill('#code', 'flowchart TD\n A[');
  await expect(page.locator('#code-state')).toContainText('画布未修改');
  expect(await saved(page)).toEqual(before);
  await page.fill('#code', 'sequenceDiagram\n Alice->>Bob: 你好');
  await expect(page.locator('#preview svg')).toBeVisible();
  await expect(page.locator('#preview')).toContainText('你好');
  await expect(page.locator('#code-state')).toContainText('画布未修改');
  expect(await saved(page)).toEqual(before);
});
test('快速粘贴最终代码胜出，恢复生成会取消旧解析', async ({ page }) => {
  await page.click('#view-output');
  await page.fill('#code', 'flowchart TD\n A[旧结果] --> B[旧节点]');
  await page.fill('#code', 'flowchart TD\n X[最终结果] --> Y[最终节点]');
  await expect(page.locator('#code-state')).toContainText('已同步到画布');
  expect((await saved(page)).nodes.map((n) => n.label)).toEqual(['最终结果', '最终节点']);
  await page.fill('#code', 'flowchart TD\n Z[不应导入]');
  await page.click('#regenerate');
  await expect(page.locator('#code-state')).toHaveText('与画布同步');
  await page.waitForTimeout(600);
  expect((await saved(page)).nodes.map((n) => n.label)).toEqual(['最终结果', '最终节点']);
});
test('粘贴自身生成的 Mermaid 时实体标签不损坏，手绘坐标仍保留', async ({ page }) => {
  await page.locator('.node.root').click();
  await page.click('#child');
  await page.fill('#label', '中文 " <标签> & # [括号] 🧠');
  await page.press('#label', 'Enter');
  const before = await saved(page);
  await page.click('#view-output');
  const source = await page.inputValue('#code');
  await page.fill('#code', source + '\n%% 继续编辑');
  await expect(page.locator('#code-state')).toContainText('已同步到画布');
  const after = await saved(page);
  expect(after.nodes.map((n) => n.label)).toEqual(before.nodes.map((n) => n.label));
  for (const node of after.nodes) {
    const old = before.nodes.find((n) => n.label === node.label);
    expect([node.x, node.y]).toEqual([old.x, old.y]);
  }
});
