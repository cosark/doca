# 编辑器评论与画布交互修复 · 2026-10-23

全部交互使用临时 SQLite、合成账号和文档；未操作用户文档或生产数据库，未部署。原始截图、收据及候选包位于 Git 忽略目录 `artifacts/verification/editor-comments-2026-10-23/`。

## 实现与原因

1. Canvas、Slides、Sheet 的评论标注默认隐藏，移除独立的眼睛按钮。区域评论侧栏统一通知宿主打开状态；打开时显示永久评论标注，关闭或 Escape 时隐藏。AI 引用高亮继续使用独立装饰层。
2. 新建原生表格使用 `hitSelf:false` 让单元格处理指针，但框选也错误依赖该点击标志。AidCanvas 的完整包围选择允许可编辑的原生表格整体参与；部分包围、锁定和普通分组规则保持原有行为。源码修复位于 AidCanvas，已发布正式 0.5.15 包。
3. 便签重新进入后，@ 用户卡片在 SDK 独立 React 根中缺少宿主语言上下文；展开头像时异常导致 Slate 编辑区卸载。宿主以不含存储或页面语言副作用的 `LocaleScope` 转发当前上下文。用户 UUID、原子节点及富文本 JSON 不变。
4. 评论请求期间原有发送状态保留；请求成功、列表刷新尚未到达的间隙，继续显示发送提示。新建/回复按服务端返回 ID、编辑按 ID 和新版本确认，列表包含已提交评论后结束提示。原有失败保留草稿行为保留。

## 已验证

- Doca TypeScript 检查、正式 Web 构建通过。5 个相关单元测试文件、17 项通过。
- 五格式开发网站和正式构建网站评论回归通过，浏览器异常均为零。覆盖默认隐藏、侧栏显隐、分页后标注、Sheet 实际标记像素、慢发送、慢列表刷新、图片上传/发送、错误保留草稿、原生键盘/剪贴板隔离，以及 1600/760/390 宽度下的侧栏与 AI 布局。
- 两轮五页面空闲均为 61,006ms，文档内容写入和 WebSocket update 为零，编辑器 DOM 身份保持不变。
- 正式构建的原生画布三阶段通过：编辑过的表格框选、新建表格框选、便签 @ 再次编辑及用户卡片展开、继续输入、撤销、删除/撤销、对端同步和重新加载。浏览器异常为零。
- AidCanvas 完整选择测试 10 项通过。未修复源码的新表格回归返回空选择，修复后正向/反向完整包围通过，部分包围不选，场景内容不变。
- 候选包与已安装 0.5.14 的公开 exports、依赖、声明、model、preferences 和 CSS 字节一致；正式 0.5.15 包的全部 dist 文件与实际测试的候选包逐字节一致。

运行入口为 `scripts/qa-comments-v2-2026-10-22.mts`（`DOCA_QA_BUILT_WEB=1` 使用正式 Web）和 `scripts/qa-canvas-native-2026-10-21.mts --stages=marquee-table,marquee-new-table,mention`。AidCanvas 使用独立去重依赖配置 `tests/browser/host-view-boundaries.playwright.config.mjs` 运行 `contained-selection.spec.mjs`。

## 正式 npm 接入与最终验收

用户已明确批准发布及接入。`@smartdoca/canvas` 0.5.15 已发布到公共 npm，Doca 精确依赖、锁文件和该版本的发布时效例外已更新，不使用本地包或活动补丁。正式归档共 155 个文件，SHA-256 为 `28a65c0947f45f0aedec69a645d1205da6f3e72a1e185c1db7a8d3f0d00bd96e`；registry 归档与审核后的发布归档逐字节一致，全部本地安装文件与 registry 归档一致。正式归档相较原候选归档仅将 CHANGELOG 的 Unreleased 改为发布日期，所有运行文件不变。

正式依赖的 frozen-lockfile 安装完成，2046 项供应链策略校验通过；未绕过校验。Doca TypeScript、Web 构建及 17 项相关单测通过。原生画布正式构建的三个阶段全部通过，收据为本地产物 `native-npm-built/results.json`；五格式正式构建评论回归全部通过，收据为 `comments-npm-built/results.json`。后者五客户端共同空闲 **61,009ms**，内容写入和 WebSocket update 为零，编辑器 DOM 身份不变，浏览器异常为零，运行包指纹首尾一致。

AidCanvas 当前源码 `yarn eslint src`、改动文件 lint 和 `yarn run type-check` 均通过。全目录 `yarn run check` 扫到忽略目录 `tmp/release-0.5.10/clean-build` 的旧副本并报 18 项旧 lint 错误，原始日志保留在 AidCanvas 的 `artifacts/release-0.5.15-source-check.log`，不将该全目录命令记为通过。完整选择回归 10 项通过。

本聊天与“发布画布与在线表格变更”已按用户要求对齐：Canvas 发布、Doca 接入及上述验收完成；该发布聊天统一继续 Sheet 0.2.12、Doca 0.2.11 以及 GitHub/Docker Hub 总发布，不再并行改包、安装或重建。这里不宣称 Doca 生产部署完成。

未引入旧格式适配、缺失字段回填、迁移、DDL、schema/codec、epoch、checkpoint 或待确认更新重写。审计发现的既有历史读取与显示归一化代码未作重构。回退保留上一正式包、依赖和锁文件，以及后续内容写入。
