# 参与贡献

建议 Node.js 24 LTS。先执行 `npm ci`，使用 `npm run dev` 开发。修改后执行 `npm run check`、`npm run build` 和生产浏览器测试；详细命令见 [TESTING.md](TESTING.md)。`npm run format` 统一源码格式。

请说明解决的问题、预期行为与验证方法。修改图结构、存档、指针交互、历史或多编辑页存档冲突保护时，添加真实回归测试。不要减少既有断言来掩盖失败。涉及保存时，测试等待“正在自动保存”结束，再核对实际存档。

模块职责见 README。图模型保留旧存档兼容与额外元数据；渲染保持 strict 模式；预览与 Mermaid 代码在同一页面显示。依赖变更后运行 `npm run licenses` 并审阅第三方许可文本。

Issue 请包含复现步骤、浏览器版本和不含私人信息的最小样例。安全问题按 [SECURITY.md](SECURITY.md) 私密报告。

本项目自有代码按 [GNU GPL-3.0-only](LICENSE) 提供。贡献者需有权按该许可提供修改；第三方代码注明出处并保留原许可。GPL 允许商业用途；分发修改版本或目标代码时须履行 GPL 对应源代码和许可通知义务。
