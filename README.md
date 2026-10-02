# OpenMindMap

OpenMindMap 是一款纯前端思维导图与关系图编辑器。画布、Mermaid 代码和图形预览在同一页面中使用；无需账号、数据库或 API Key。

## 开始使用

建议 Node.js 24 LTS；也支持 20.19+ 或 22.13+ 的对应主版本。

~~~sh
npm ci
npm run dev
~~~

打开终端显示的地址。npm run build 生成 dist，npm run preview 查看生产构建。

## 绘图与预览

- 双击空白新增节点；选中节点后点击“子节点”或按 Tab。
- 拖动节点自由布局，拖动连接点到目标节点建立连线。
- 拖动空白平移，滚轮或右下角按钮缩放；“适应”显示整图，“排版”整理结构。
- 选中节点编辑标题、颜色和形状；选中连线可删除，自由关系图支持连线文字。
- 思维导图模式生成 mindmap，只允许单父节点且不能有环；独立子树归入“未连接节点”。自由关系图生成 flowchart，支持循环与多个父节点。
- 删除节点保留后代；撤销和重做最多保留 100 步。
- 文件菜单的“导出画布 SVG”按用户绘制的位置导出整图，保留节点、形状、颜色、连线和文字；内容自适应裁切，导出不会自动排版。
- 可切换 Mermaid 视图、复制代码、下载 .mmd 或 Mermaid 生成的 SVG。

画布快捷键：Tab 新增子节点，Delete / Backspace 删除，Ctrl / Cmd + Z 撤销，Ctrl / Cmd + Shift + Z 或 Ctrl / Cmd + Y 重做。Ctrl / Cmd + S 导出 JSON。输入框和预览视图不会触发画布删除。

## 数据与恢复

导图自动保存到当前浏览器。JSON 导入 / 导出完整保留节点、连线、位置、颜色、形状及兼容元数据，也兼容旧版本存档。

损坏存档会先保留原文副本，再初始化画布；备份失败时停用自动保存，保护原文。文件菜单可以导出恢复副本，确认备份后手动清理它们。清除浏览器站点数据会删除存档和恢复副本。

多个编辑页共享本地存档。保存时使用 Web Locks 和原文版本比较；另一页更新后，当前页保留草稿并停止覆盖。请先导出需要保留的草稿，再在文件菜单选择“载入最新本地存档”。此机制防止陈旧覆盖，不会合并多人修改。

自动保存需要安全上下文中的 Web Locks（HTTPS 或 localhost）。存储不可用、配额耗尽或浏览器不支持时仍可绘图和导出，但需手动备份。

导入上限为 2 MB、1000 个节点、5000 条连接；生成或手动输入的 Mermaid 源码最多 2,097,152 个字符。规模上限是校验边界，不代表最大密集图能在任意设备流畅渲染。Mermaid 按自己的算法排版，预览位置与自由画布不同。

粘贴或编辑 mindmap / flowchart（含 graph）代码后，有效代码会自动反向生成可编辑画布；成功同步后可以切换画布继续拖动、编辑，并可撤销导入。首次生成会排版，已匹配的节点保留原坐标。原始代码在当前编辑过程中保留；下一次画布修改会重新生成代码。其他图类型和 subgraph 分组仅预览；错误、超限或不支持转换的结构不会覆盖画布。转换为画布后只使用当前编辑器支持的节点形状和连线样式。JSON 保存图模型，不保存 Mermaid 原始格式、选择或撤销历史。语法错误或超限时不能导出上一张 SVG。

## 验证与贡献

~~~sh
npm run check
npm run build
npx playwright install chromium firefox webkit
npm run test:ui
~~~

npm run check 包含格式、ESLint、JavaScript 类型检查和单元测试。浏览器测试自动启动服务；TEST_BROWSER 选择 chromium / firefox / webkit，默认 Chromium。实际结果和适用范围见 [TESTING.md](TESTING.md)，发布记录见 [RELEASE_V1.md](RELEASE_V1.md)。贡献与安全报告分别见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)。

## Vercel 部署

仓库包含 Vite 部署配置：构建命令 npm run build，输出目录 dist。Vercel Hobby 计划的使用范围受其个人非商业用途条款和配额限制；这是托管平台的计划条件，与 OpenMindMap 的 GPL-3.0 软件许可是两回事。商业使用软件受 GPL 许可条款约束，选择商业托管服务时请遵守该服务自己的条款。

## 发布包

npm run licenses 重新生成第三方声明；npm run build 后执行 npm run release:pack，在 releases/v1.0.0/ 生成 openmindmap-v1.0.0-source.zip、openmindmap-v1.0.0-dist.zip 与 SHA256SUMS。源码 ZIP 顶层目录名为 openmindmap-v1.0.0/。构建和 ZIP 均包含 LICENSE 与第三方声明。API_USAGE.md 是历史聊天 API 参考，本项目没有对应后端。

## 许可证

OpenMindMap 自有代码采用 GNU General Public License，Version 3, 29 June 2007（SPDX：GPL-3.0-only），完整条款见 [LICENSE](LICENSE) 和 [GNU 官方许可文本](https://www.gnu.org/licenses/gpl-3.0.txt)。GPL 允许商业使用、修改和分发。分发修改版本或目标代码时，必须遵守 GPL 的许可与通知要求，并按 GPL 提供对应源代码；通过网络提供目标代码时，按 GPLv3 第 6 条提供对应源代码的获取方式。具体义务以许可证原文为准。

第三方依赖按各自原有许可证提供，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；其原文保留，不因本项目采用 GPL 而被替换。
