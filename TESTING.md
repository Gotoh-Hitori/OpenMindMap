# 验证说明

建议 Node.js 24 LTS；项目要求 `^20.19.0 || ^22.13.0 || >=24`。

## 命令

```sh
npm ci
npm run check
npm run build
npx playwright install chromium firefox webkit
```

PowerShell 验证生产构建：

```powershell
$env:TEST_PRODUCTION = '1'
$env:TEST_BROWSER = 'chromium'
npm run test:ui
$env:TEST_BROWSER = 'firefox'
npm run test:ui
$env:TEST_BROWSER = 'webkit'
npm run test:ui -- --workers=1
```

macOS / Linux 可用 `TEST_PRODUCTION=1 TEST_BROWSER=firefox npm run test:ui`。浏览器套件自动启停服务；共享同一个端口时逐个运行，避免一个任务结束关闭另一个任务正在使用的服务。可通过 `CHROMIUM_PATH` 指定已有 Chromium 可执行文件。

独立烟雾测试需要先启动 `npm run dev`；另一个终端运行 `npm run test:smoke`。也可设置 `BASE_URL=http://127.0.0.1:4173` 对正在运行的生产预览测试。

## 覆盖

- 图模型：旧 schema、模式约束、循环、多父级、孤立节点、布局、转义、metadata 和不可变更新。
- 存储：坏档保留、备份失败、旧存档兼容、锁内 CAS、排队保存、重新载入失效旧队列、无锁回退、幂等恢复及显式清理。
- 浏览器：原有 29 个用例全部保留，新增审计回归、冲突、导入竞态、复制回退、规模边界、SVG 元素复用、长源码和 501 条边；1440/390/320px 属性面板无重叠、编辑/断开/删除、未失焦标题保存与导出，以及旧独立窗口入口移除。
- Chromium 专有用例：CDP 真实触屏事件注入、授予剪贴板权限并读取实际复制内容。Firefox / WebKit 不执行这两个依赖 Chromium 测试接口的用例，其余用例相同；复制权限失败回退在所有浏览器执行。
- 生产许可资源测试只适用于 build 后的静态服务；开发服务中明确标记不适用。

数据测试不依赖 UI。E2E 核对 localStorage、可见图、导出内容与错误状态；保存已变为异步，读取前等待保存完成。性能回归检查拖动期间复用 SVG、不写临时位置，不使用依赖机器速度的毫秒阈值来声称普遍流畅。

画布 SVG 专项验证原节点坐标和连线路径、纯 SVG 图像加载、自然尺寸与等比缩放、负坐标、长中文/特殊文字、菱形与自环、裁切边界、隐藏画布、拖动编辑后的导出及导出不改变数据/撤销记录。

反向同步测试使用真实 Mermaid 浏览器解析器，验证粘贴后结构/颜色/标签、循环、画布继续编辑/撤销、刷新恢复、错误与其他图类型保护、快速输入失效旧结果、原生成源码实体/坐标往返。另有转换数据库的单元测试，浏览器解析器与渲染共用串行队列。

## 实际验收

最终记录见 [RELEASE_V1.md](RELEASE_V1.md)。报告保存在 `playwright-report/<browser>/`，失败截图和 trace 在 `test-results/<browser>/`，均不进源码发布包。

本地自动化覆盖 Chromium、Firefox 与 Playwright WebKit。WebKit 测试不是在真实 Safari 或 iPhone 上测试。真实移动设备、实际 GitHub Actions 托管执行和 Vercel 公网部署仍需发布后复核；这些未执行项不列作已通过。
