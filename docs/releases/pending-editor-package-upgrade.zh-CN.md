# 待发布编辑器包升级

[English](pending-editor-package-upgrade.md)

当前源码锁定 `@smartdoca/slate` 0.4.15 与 `@smartdoca/sheet` 0.2.1。Slate 新增原生节点旋转，图片首次点击选中、第二次点击预览。AI 编辑校验有限数值角度，修改节点样式时保留旋转；现有 DOCX 样式补丁应用到新制品。表格使用包原生的可访问全选角按钮，在统计订阅者接收前规范化整表选区。

用户已同意：CRDT 追加工作表（包括升级前追加的）及虚拟空恢复表采用默认行高 18 px、列宽 72 px，宿主新建工作表也采用相同尺寸。不可变 baseline 中的尺寸字段原样保留，缺省字段不回填；显式行列尺寸保留。这仅改变投影默认值，不回写 seed、原始 Yjs 字节、baseline、epoch、评论和待确认更新。表格 schema 6、富文本 schema 3 不变，未知 schema 继续按精确协议拒绝，现有恢复和历史读取代码不变。

延续此前不保证旧流程图兼容的决定，不增加旧节点适配、自动转换、迁移或数据重置。服务端和 Web 同步更新；保留之前的制品、依赖版本、补丁和锁文件用于包回退。旧版可能忽略旋转或显示不同默认尺寸，数据库回退另按已审定的宿主存储流程执行。

不可变样本 `tests/fixtures/editor-upgrade/sheet-rc19.json` 由真实、未修改的 rc.19 registry 制品生成。包哈希、自动检查和隔离浏览器证据记录在 `docs/verification/editor-package-upgrade-2026-10-14/report.json`。本说明仅记录源码变更，不宣称已发布部署，或已验收全部表格操作、图形手势、外部 AI 服务与原生设备。
