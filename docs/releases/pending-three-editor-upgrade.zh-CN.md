# 三编辑器包升级

## 三编辑器升级 — 2026-10-17

Doca 固定安装实际 npm 包 `@smartdoca/slate` 0.4.22、`@smartdoca/slides` 0.3.0-alpha.3。Canvas 使用不可变的 `vendor/smartdoca-canvas-0.5.0-75e637df1a75.tgz`：npm 0.5.0 的库构建误删了 Slate 与纯文本内部编辑器注册模块，AidCanvas 源码已通过 sideEffects 声明修复，宿主使用重建产物。这个修复包和源码改动尚未发布 npm。

Slate 新增五页元素配色，进入图形标签编辑时全选文字。codec/Yjs/headless 字节与 0.4.20 一致，原有 DOCX 补丁原样绑定到 0.4.22。Canvas 保持 `aidcanvas-yjs` schema 1；图片和附件回调保存稳定资产 ID，传递真实进度和取消信号，并接入宿主鉴权预览，包括历史、回收站、审计只读视图。服务端校验新增富文本媒体引用属于当前文档。临时画布 presence 完整转发经过校验的相对文字位置和场景鼠标坐标，身份及颜色仍由服务端决定；支持仅鼠标消息，不复用永久评论锚点。

Slides 要求 codec revision 6。客户端与服务端统一严格协商 `eppt-yjs-v6`，文档 schema 2 / protocol 1 不变。用户明确选择**只支持新文稿**：旧 `eppt-yjs-v5` 文稿和旧客户端拒绝打开或接入，原 checkpoint、增量、epoch、历史和待提交消息标识原样保留。不增加旧 codec 读取、编码标识改写、自动转换、迁移或 SQL 结构变更。宿主接受原生文字边距与表格字段；AI 表格命令通过原生 controller 支持合并/拆分、样式、尺寸、清空、粘贴与批量删行列。单元格仍是纯文本加整格样式。

部署时服务端与 Web 必须同步更新。保留旧部署、版本锁定、补丁、锁文件与安装产物；旧程序不承诺读取新功能写入，恢复前须保留后续数据。本次没有修改用户数据库或部署。隔离验收、哈希、截图和边界见 `docs/verification/three-editor-upgrade-2026-10-17/`。
