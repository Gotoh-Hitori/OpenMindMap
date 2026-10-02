> 状态说明：以下是历史审计基线。文中旧许可描述、独立预览功能和“不修改”结论已被后续版本变更取代；请以当前 README、LICENSE 与 RELEASE_V1.md 为准。本文保留当时的实际记录，不代表本版本现状或新测试结果。

> 历史只读审计：此文记录修复前的实际发现与基线。用户随后授权的 v1.0 完整修复、处理矩阵和最终验收见 [RELEASE_V1.md](RELEASE_V1.md)。

﻿# Release Readiness Code Audit

审计日期：2026-10-01。范围：全部第一方代码、测试、文档、依赖清单/锁文件、Vercel 配置和 GitHub 配置。原则：先报告；不修改功能、UI、交互、数据格式、错误语义或默认运行配置。本文不等同于法律意见或无缺陷保证。

## 审计摘要

结论：**常规功能基线通过，但不建议宣称“无条件发布就绪”**。复现两项可能丢失本地存档的风险，以及三项特定条件下的交互/渲染缺陷。修复这些问题会改变现有可观察行为，因此本次仅报告，不自动修复。

18 个独立发现：A 类 Critical 发布风险 2 个、B 类 7 个、C 类 2 个、D 类 1 个、E 类 1 个、G 类 3 个、H 类 2 个。Confidence HIGH 14 个、MEDIUM 4 个、LOW 0 个。F 与 I 引用已有发现或说明保留项，不重复计数。Critical 指本项目发布风险分类，不是 CVSS 漏洞等级；没有声称发现远程执行或凭据泄露。

运行代码没有必要进行“为了更漂亮”的重构。仅拟执行许可证及配套文档变更、第三方许可汇总和审计临时目录忽略；这些是用户另外授权的发布准备，不是功能修复。死代码候选先保留。

## 1. 架构、入口与兼容性

- `index.html` 是唯一页面，载入 `src/app.js`。没有后端、数据库、CLI 产品或 `/api/chat` 实现。
- `app.js` 管理图状态、选择、历史、编辑/导入/导出和快捷键。`commit` → `sync` → 存储、属性面板、画布、Mermaid 源码及预览。
- `canvas.js` 管理节点/SVG 连线、拖拽、连线、平移和缩放；通过回调调用 app 操作。
- `model.js` 是图校验/迁移/编辑/排版/序列化模块。导出函数包括 `makeId/createState/validateState/normalizeState/addNode/updateNode/removeNode/connectNodes/disconnectEdge/layoutState/toMermaid`；不因没有应用内调用就删除 export。
- `renderer.js` 严格安全模式初始化 Mermaid，以版本号及串行 Promise 防止旧结果覆盖新结果。
- `views.js` 控制同一页的画布/输出视图及通知；没有浏览器独立窗口或跨窗口实时同步。
- `storage.js` 使用 localStorage 单键存档，下载后回收 Blob URL。旧 `{rootId,nodes,parentId}` 通过 model 迁移，现格式兼容额外节点/边元数据。
- `vite` 提供开发、构建和静态预览；`vercel.json` 输出 `dist`；运行依赖是 Mermaid，开发依赖是 Vite 与 Playwright。
- CI 执行 npm ci、单元测试、build、安装 Chromium、生产静态 E2E。Dependabot 月度检查 npm。没有既有 lint、formatter、TypeScript 或 typecheck 配置。
- `CHROMIUM_PATH/TEST_PRODUCTION/CI` 是测试配置变量，应用没有必须设置的环境变量。没有发现网络服务、插件、动态第一方加载、反射或 DI 入口。Mermaid 自身会动态加载图类型。

## 2. 审计前基线

| 命令/检查 | 实际结果 |
| --- | --- |
| `npm test` | 12/12 通过，无跳过 |
| `npm run build` | 通过，存在大分块提示 |
| `TEST_PRODUCTION=1 npm run test:ui`（通过环境变量设置） | 29/29 通过，无跳过 |
| 每个 `src/*.js` 执行 `node --check` | 通过 |
| `npm audit --json --registry https://registry.npmjs.org` | 0 个已知漏洞 |
| `npm ls --depth=0` | mermaid 11.17.2、vite 7.3.6、@playwright/test 1.63.0；无缺失依赖报告 |
| 凭据/私人绝对路径扫描第一方待发布文件 | 未发现匹配项；扫描不是人工确认所有历史不存在秘密 |
| Git status/diff | 无法执行：目录不是 Git 仓库 |
| lint/typecheck | N/A，仓库没有这些既有工具，不能宣称通过 |

用 `.audit/baseline-hashes.json` 保存现有源文件 SHA256、长度，弥补本地没有 Git diff 的范围核对。临时审计脚本与截图不作为发布文件。浏览器基线使用现有 Chromium；独立审查也在本机 Chrome 复现问题。真实手机、Safari、Firefox、GitHub 托管 CI 和实际 Vercel 部署不在已执行范围。

## A. Critical

### A1 — 无法解析/校验的已有存档被初始化写入覆盖

- 位置：`src/storage.js:2`、`src/app.js:8`、`src/app.js:15`、`src/app.js:31`。
- Confidence: **HIGH**。严重度：**HIGH / 数据恢复风险**。
- 当前：读取或 normalize 抛异常后返回 null；app 新建默认图，首次 sync 直接写同一个存档键。
- 复现：在隔离上下文保存 `{rootId:'missing',nodes:[{id:'recoverable',label:'重要旧内容',x:0,y:0}]}`，刷新。原始字符串中的内容被默认图覆盖，`invalidSaveOverwritten=true`。即便存档部分可手工修复，也没有留下原文副本。
- 影响：损坏或未来不兼容的旧存档可能失去最后一份本地原文。常规“损坏存档不阻塞初始化”测试只验证可打开，没有验证原文保留。
- 建议：原文备份/隔离及恢复流程需要单独行为变更任务。**本次不修改**，因为会改变保存及错误处理语义。

### A2 — 多标签页保存无冲突检测，陈旧状态覆盖另一页

- 位置：`src/app.js:8`、`src/app.js:15`、`src/storage.js:6`。未发现 storage/BroadcastChannel 监听。
- Confidence: **HIGH**。严重度：**HIGH / 数据丢失风险**。
- 复现：同一浏览器上下文打开 A/B 两页。A 新增“来自窗口A”；B 基于旧图新增“来自窗口B”。最终存档只有中心主题与 B，A 的更改不在存档里。
- 当前 README 已提醒避免同时编辑；这是已知限制，不能解释为实现了独立窗口同步。
- 建议：单编辑者/版本冲突检测/只读预览等均需 UX 与行为设计。**本次不修改**。

## B. High Value Improvements

### B1 — 拖动期间删除节点会产生未处理指针异常

- 位置：`src/canvas.js:21`、`:22`、`:23`；键盘入口 `src/app.js:30`。
- Confidence: **HIGH**；严重度 MEDIUM。
- 复现：root+child，按住 child 拖动期间按 Delete，再移动、松手。Chrome 在 pointermove 与 pointerup 两次报 `Cannot set properties of undefined (setting 'x')`。
- 原因：gesture 保存旧 nodeId，删除同步改变状态，之后 `find` 返回 undefined。节点仍删除；没有证明全局崩溃或持久数据损坏。
- 建议：明确取消失效手势和终止策略。由于会改变删除与拖拽竞争时行为，**本次不修改**。

### B2 — 同内容 JSON 导入使视觉选择与内部目标脱节

- 位置：`src/app.js:27`、`:11`。
- Confidence: **HIGH**；严重度 LOW–MEDIUM。
- 导入回调先改 selected 为 root；commit 因 JSON 内容相同提前返回，不同步面板或 outline。
- 复现：选 child 后导入完全相同文件；画布仍显示 child 被选，属性面板仍显示其标签，但内部目标已是 root。随后操作可能作用在与画面不同的节点上。
- 建议：选择同步语义需独立修改与回归测试。**本次不修改**。

### B3 — 合法导入可超过 Mermaid 默认限制，预览/导出成为提示图

- 位置：`src/app.js:27`、`src/renderer.js:2`、`:9`、`src/model.js:354` 起。
- Confidence: **HIGH**；严重度 MEDIUM。
- Mermaid 已安装版本默认 `maxTextSize=50000`、`maxEdges=500`。2 MB/1000 节点导入限制没有与这些渲染限制对齐。
- 复现：111 节点，110 个标签各 500 字符，生成源码 56597 字符。预览显示 `Maximum text size in diagram exceeded`，页面状态仍为“导入成功”；状态和存档完整，但预览不是实际导图。
- SVG 导出可能导出这个限制提示图。500 条以上自由图边也受 Mermaid 的边数限制；没有另外宣称已完整运行这个边数场景。
- 建议：区分有效导图 SVG 与限制提示、明确规模边界或配置。涉及默认配置/错误语义/输出，**本次不修改**。

### B4 — 拖拽连线重复全图查找与 DOM 重建

- 位置：`src/canvas.js:6`、`:8`–`:12`、`:21`。
- Confidence: **MEDIUM**（O(EV) 结构明确，实际卡顿尚未证明）。
- 每条边两端 anchor 扫节点数组与 DOM children；每个 pointermove 重建全部 SVG 连线。查找复杂度约 O(EV)，重建约 O(E)。
- 独立审查在含链边的 200/1000 节点图各采样 14 次，同步 handler 最大约 0.9 ms；未计浏览器后续绘制/合成，且是单机短样本，不能外推全帧表现。
- 建议：真实图 profiler 后才考虑 ID→元素索引和合帧。不能据理论复杂度认定有严重性能故障；不修改。

### B5 — 一个编辑操作多次 normalize/clone/serialize

- 位置：`src/model.js:154` 起编辑函数、`src/app.js:11`、`:15`、`src/model.js:354`。
- Confidence: **MEDIUM**（重复工作可见，用户耗时收益未测）。
- 编辑函数入口校验并拷贝，返回再次 normalize；commit 两次 JSON.stringify，sync 保存再次 stringify，toMermaid 再 normalize。历史还做 structuredClone。
- 对 V/E 大的图会增加线性工作与分配；toMermaid/find 及树布局局部还可能有 O(V²) 查找。
- 建议：先衡量整操作，再设计可信内部状态路径；校验顺序、导出规范化和外部 API 异常可能变化，不能直接移除校验。本次不修改。

### B6 — Mermaid 体积大，但不能直接删图类型

- 位置：`src/renderer.js:1`、`package.json`；构建 `dist/assets`。
- Confidence: **HIGH**（体积事实）；严重度 LOW / 加载成本。
- 首包 706.61 kB，gzip 178.26 kB；61 个资源总计约 3,440,212 字节，不等同于全部会在首次加载下载。另有超过 500 kB 的动态分块。
- 用户可以手写其他 Mermaid 类型。仅保留 mindmap/flowchart 会改变既有输入能力；改为懒加载也改变启动/错误/时序，需要专项验证。
- 本次保留依赖与导入方式，不把 warning 写成 build failure。

### B7 — 测试边界与静态质量工具缺口

- 位置：`package.json`、`playwright.config.js`、`tests/studio.spec.js`。
- Confidence: **HIGH**。
- 现有 29 个场景不包括 A1 原文保留、A2 冲突、B1 交错手势、B2 相同导入、B3 大文本图；没有 lint/typecheck，没有 Safari/Firefox/真实手机运行。
- 触屏检查发送真实触屏指针事件，但不等同于真实移动设备验证。触屏 CDP 场景是 Chromium 专用。
- 建议追加已确认缺陷的回归测试并单独安排行为修复；不能通过改已有测试掩盖问题。本次既有测试不改、不减少、不跳过。

## C. Dead Code Candidates

### C1 — app 内私有 manual 标记只有写入

- 位置：`src/app.js:8`、`:15`、`:29`；symbol `manual`。
- Confidence: **HIGH**（候选判定）。搜索全部第一方模块只找到初始化及 true/false 赋值，没有读取。
- 未 export；不是全局/window 属性、配置 hook、动态入口或框架约定。UI 文案由对应事件直接写入，不读取这个标记。
- 删除风险很低，但没有已测得性能收益，只能减少少量无效赋值。按照避免审美清理的原则，本次仍保留，不扩大变更面。

### C2 — 旧分栏 CSS 中部分 selector 已无入口

- 位置：`src/styles.css:31`–`:90`，后面 `:91` 起全窗口样式；`.brand/.panel/.output/.bottom-note` 等。
- Confidence: **MEDIUM**。当前 index 不再使用部分旧 class，第一方动态类生成也没有这些 class；但是同段中的 main/header/#code/#preview/.inspector 仍参与继承或级联。
- CSS cascade 和外部页面复用不能靠“后面有覆盖”100% 排除。删除风险中，不做整段删除或纯格式重写。

## D. Legacy Code Candidates

### D1 — API_USAGE.md 属于不运行的旧参考，局部措辞容易误导

- 位置：`API_USAGE.md:5`、`:26`；README 已将它说明为独立参考。
- Confidence: **HIGH**。文件说“当前项目实际暴露 POST /api/chat”，但代码没有 fetch/API 入口、服务端包或后端路由。
- 运行调用：无；文档引用：README 明确链接/提及。可能对外作为 API 契约/参考，不能据无代码调用删掉。
- 建议未来加更明确的参考文档标注，当前保留，不改其中契约和例子。

**必须保留的兼容代码（不算缺陷）：** `model.js:62`–`:68` 缺少 edges 的 parentId 迁移、sourceId/targetId 别名、ID fallback、节点/边元数据保留；它们仍支持已有文件和潜在模型消费者。显式空 edges 与不存在 edges 的区别是关键回归行为。

## E. Duplicate / Redundant Code

### E1 — 独立 smoke 与 Playwright 场景重叠

- 位置：`tests/smoke.mjs`、`tests/studio.spec.js`、`package.json` 的 test:smoke/test:ui。
- Confidence: **HIGH**。大部分绘图路径重复，但 smoke 还做最终未捕获 pageerror 检查，并提供独立脚本运行入口。
- 重复的代价主要是维护/运行时间；合并需要保留所有断言、独立执行和错误收集。没有足够收益证明应现在合并，保留。
- smoke 的空字符串匹配断言本身不提供有效覆盖，但不能借此删减既有测试；只报告。

模型重复校验与 CSS 级联重叠分别见 B5/C2，不另计发现。

## F. Performance Findings

| 关联 | 当前实现与触发条件 | 复杂度/实际影响 | 建议及回归风险 |
| --- | --- | --- | --- |
| B4 | 拖节点时每次事件重建所有边，重复扫描端点 | O(EV) 查找；短测未证明全帧卡顿 | 实测 profiler → 缓存索引/合帧，影响事件时序与视觉；本次不改 |
| B5 | 每次编辑重复 normalize、深复制与 stringify | 多轮 O(V+E)，部分查找 O(V²)；无实际整操作耗时结论 | 不绕过对外校验，避免改变错误顺序/元数据；本次不改 |
| B6 | eager 导入 Mermaid、全图类型可用 | 首包 706.61 kB、gzip 178.26 kB | 仅在保留手工 Mermaid 能力和启动语义后评估；本次不改 |

没有发现可确认的无限增长 cache、持续 subscription leak、N+1 数据库查询、重复后端网络或长期 filesystem 热路径。历史上限 100；提醒定时器被取消，Blob URL 延迟释放。window/document listeners 按单页生命周期注册，没有路由卸载入口；仅凭“没有 dispose”不能判定内存泄漏。

## G. Dependency Findings

### G1 — 本项目许可尚未设置（审计基线）

- 位置：README 发布状态、package.json 无 license 字段、无 LICENSE。
- Confidence: **HIGH**。用户明确要求非商业许可，因此将另外执行许可证添加；不擅自声称是 OSI 开源。
- 选择 [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)，官方 [纯文本](https://polyformproject.org/licenses/noncommercial/1.0.0.txt)，[SPDX 标识](https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0.html)。非商业可使用、修改、分发；商业用途不由本许可授权。
- 它特别许可个人非商业用途与列举的非商业组织用途，包含法定 fair use 和原文其他条件；不会改写标准文本以伪装绝对所有领域禁用。
- [OSI 定义](https://opensource.org/osd)要求不限制商业领域，因此应称“源码可用/非商业许可”。该术语说明不影响应用 UI。

### G2 — 发布时需保留第三方原有版权/许可

- 位置：package-lock.json 的运行时树、node_modules 包内许可；仓库此前无集中 THIRD_PARTY_NOTICES。
- Confidence: **HIGH**。扫描锁文件非 dev 包共 113 个路径（非 npm audit 的计数口径）；含 MIT、Apache、ISC、BSD、Unlicense 及双许可等。
- fastdom/strictdom 的 MIT 原文在各自 README 的 License 章节；khroma 的 package 元数据无 license 字段，但实际 license 文件是 MIT，不能判定为无许可。
- 本项目非商业条款不能重新许可第三方独立代码。拟汇总原有原文，不修改 node_modules 或依赖树。集中表是保守的安装树清单，不声称每个包都进了浏览器首包。
- 将来若单独分发/托管构建 bundle，需要同时附上许可声明；root 文档不会被 Vite 自动复制进 dist，不能把本次文件添加等同于已经完成实际托管合规分发。

### G3 — 锁文件下载地址绑定 npmmirror

- 位置：package-lock.json 所有 resolved tarball URL。
- Confidence: **MEDIUM**（可用性风险，不是漏洞结论）。保留 integrity hash，有可复现版本；但安装依赖该镜像的可达性。实际工作区安装/构建通过，GitHub 网络上未做全新 npm ci。
- 修改镜像地址可能影响网络策略和用户安装默认行为，本次不变更。没有证据表明这三项直接依赖 unused，Mermaid=运行、Vite=build、Playwright=test/CI，分类正确。

## H. Safe Cleanup / Repository Hygiene

### H1 — 没有 Git 仓库，不能审计提交历史或 tracked artifacts

- 位置：项目根；`git status --short` 返回 not a git repository。
- Confidence: **HIGH**。不能宣称已经检查历史泄密、git diff 或无误提交产物；只能检查工作目录与保存的文件哈希。
- 不自动 git init、commit、推送或发布。发布时由维护者审阅 staged 文件。

### H2 — 本次审计临时目录不应发布

- 位置：`.audit/`、`.gitignore`。
- Confidence: **HIGH**。本次产生 hashes、复现脚本、临时截图和官方许可下载。此目录没有 runtime/build/test 正式入口。
- 安全处理：仅新增 `.audit/` 忽略项，不递归删除、不移动用户文件。已有 node_modules/dist/test-results/playwright-report/.npm-cache/.env 已被忽略；无实际环境文件发现。
- C1 manual 是低风险候选，但没有值得本轮执行的收益。其余 CSS/export/compatibility 候选不进入自动删除。

## I. Keep As-Is

- 所有模型 exports 保留，包括只在测试中调用的 validateState；存在外部模型消费者的可能。
- canonicalize/normalizeState/cloneState 名称及包装不凭“间接调用”重写；它们提供一致校验和异常语义。
- old parentId/sourceId/targetId 兼容、显式空边语义保留。
- Mermaid 转义、strict 模式、串行 Promise/version 失效结果丢弃保留；没有证明存在 XSS 执行。
- Root 保护、cascade 参数、UI 删除保留后代、mindmap 未连接分组保留。
- history structuredClone 与上限 100 保留，避免共享引用破坏撤销。
- catch 返回 null/false 属现行错误语义，即使 A1 说明其与启动保存组合有风险，本轮不偷偷改 catch。
- 下载 URL 延迟 revoke 的时间不“优化”为立即回收，避免影响浏览器下载。
- 不增加 lint/formatter 造成大范围格式改动，不改所有文件的行尾或锁文件解析重排。
- 不删除 API_USAGE 文档、独立 smoke、旧 CSS 大段或任何正式发布需要的文件。

## 3. 报告完成后的变更决策

本报告先于正式发布文件修改生成。决定：**不修改任何运行源文件，不删除 dead code，不合并重复逻辑，不进行性能改动，不更换依赖。**

仅执行用户授权的许可证及配套说明，补齐第三方原许可声明，以及 H2 临时目录忽略。这些不改变应用 UI、绘图操作、API、数据格式、默认配置或网络行为；法律授权范围是用户明确要求的变化。

待执行完补录最终文件列表、验证命令和哈希差异。A1/A2/B1/B2/B3 仍是已知风险，HIGH confidence 不代表可以违反“不改变用户行为”的限制自动修复。

## 4. 最终执行与验证结果

报告先行后完成发布文件变更，**没有执行任何运行代码清理或问题修复**。

| 文件 | 变更与原因 |
| --- | --- |
| `LICENSE`（新增） | 用户要求非商业许可；直接复制官方 PolyForm Noncommercial 1.0.0 原文，未修改条款 |
| `THIRD_PARTY_NOTICES.md`（新增） | 汇总 113 个非 dev 依赖路径的既有许可/版权文本，明确不以本项目条款覆盖第三方 |
| `RELEASE_AUDIT.md`（新增） | 本审计完整报告与执行记录 |
| `package.json` | 仅新增 license 元数据 |
| `package-lock.json` | 仅新增根包的对应 license 元数据；无依赖版本、integrity、resolved 或树变化 |
| `README.md` | 替换未选许可说明，标注源码可用/非商业范围，链接依赖声明和审计 |
| `CONTRIBUTING.md` | 对齐许可与贡献声明，不改变开发流程 |
| `TESTING.md` | 更新已选许可状态，保留已有测试结果并链接本审计 |
| `.gitignore` | 仅追加 `.audit/`，避免发布本次临时审计资料 |

执行命令：

```text
npm test
npm run build
设置 CHROMIUM_PATH 与 TEST_PRODUCTION=1 后 npm run test:ui
对全部 src/*.js 执行 node --check
npm audit --json --cache .npm-cache --registry https://registry.npmjs.org
npm ls --depth=0
node .audit/check-changes.mjs
node .audit/check-metadata.mjs
```

| 验证项 | 审计前 | 变更后 |
| --- | --- | --- |
| 单元测试 | 12/12 | 12/12 |
| 生产构建 | 成功 | 成功 |
| 生产静态 E2E | 29/29 | 29/29 |
| 源模块语法 | 成功 | 成功 |
| lint/typecheck | N/A | N/A（没有增加或删除工具） |
| 大型分块提示 | 存在 | 同样存在 |

本次未删减、修改或跳过任何既有测试；未新增生产依赖、改变依赖版本、进行性能优化或整理格式。首包仍为 `index-B7EZ92mB.js`（706.61 kB），CSS 仍为 `index-DUMVGie2.css`（11.55 kB），与本轮基线一致。

哈希核对结果：`src/*`、`index.html`、全部 tests、playwright.config.js、vercel.json、全部 .github 文件、API_USAGE.md、SECURITY.md、CHANGELOG.md 完全未改。去掉唯一新增的 license 行后，package.json/package-lock.json 的 SHA256 与各自基线相同，证明不是锁文件大范围重排。不能提供 Git diff，因为没有 .git；没有初始化仓库或伪造 diff 验证。

官方许可文件与 LICENSE 的 SHA256 相同：`FFCCA38841ADB694B6F380647E15F17C446A4D1656FED51A1E2041D064C94CC8`。这证明复制文本一致，不是对用户全部代码权利归属的法律确认。

最终统计：发现 18 项；Critical 发布风险 2 项；HIGH confidence 14 项。删除的 dead code **0**；简化重复逻辑 **0**；性能优化 **0**；依赖版本变更 **0**。许可及文档/卫生文件新增或修改 **9** 个。

保留风险：A1/A2 两项数据风险；B1/B2/B3 三项已复现行为缺陷；B4/B5 未证实的规模性能收益；B6 bundle 体积；B7 浏览器/工具覆盖边界；G3 镜像与尚未执行的全新远程安装；H1 无 Git 历史/托管发布验证。G1 许可缺失已解决；G2 的仓库集中许可声明已补齐，但未来独立 bundle 发布仍需附带声明并核对实际分发范围。

保留候选：私有 manual 写入、旧 CSS、旧 API 参考文档、独立 smoke 和模型公开 exports，均未删除。parentId/sourceId/targetId 兼容明确保留，不把旧数据迁移误认为垃圾代码。

**确认：本次运行源码、UI、UX、API、输出序列化、数据格式、默认运行配置及现有错误行为没有修改。** 法律许可范围是用户明确要求的变更。已确认缺陷不能仅因为置信度高就绕过用户的行为冻结约束；需要后续明确允许行为修复的任务再处理。
