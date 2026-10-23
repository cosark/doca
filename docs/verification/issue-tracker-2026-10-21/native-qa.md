# 本轮原生网站补验收

> 原始截图、JSON 和运行日志保存在本地忽略目录 `artifacts/verification/issue-tracker-2026-10-21/`；下文“本地产物”和“本地图片”的相对路径以该目录为基准，不随 Git 提交。原验收日期、结果和指纹保持原记录，仅整理附件位置。

运行 `node --import tsx scripts/qa-issue-tracker-native-2026-10-21.mts`。这是实际Doca服务、Vite网页和Chrome；仅使用内存SQLite、临时文件存储、合成账号和文档，没有模型调用、用户文档修改或生产部署。使用临时Vite缓存且关闭HMR，不重建共享Web产物。

最终收据（本地产物：`native-browser/results.json`）全部通过，页面异常为0。2026-10-22复跑的实际包组合为Canvas **0.5.10**、Sheet **0.2.7**、Slate **0.4.24**、Markdown **0.4.4**、Slides **0.3.0-alpha.4**。8个文档、14个客户端在编辑、选择和改变视口尺寸后静置60秒，内容序列与出站内容更新数均不变。此次只覆盖下表原生场景，不代表其他Canvas功能或生产网站的验收。

| 原表行 | 真实操作与结果 |
| --- | --- |
| 2 | 当前native结构是`paragraph`加`title:h1…h5`。H1/H2末尾Enter的新块没有title，实际输入正文、peer显示和重开通过；H3中间拆分保留原文字，左块仍H3、新块为正文；空H4 Enter产生正文新块。没有擅自把旧`heading-one` fixture当作当前原生标题。见截图（本地产物：`native-browser/row2-heading-enter.png`）。 |
| 4 | 合成用户数据库中的display_name确实为空。另一账号能看到2px×18px有颜色的光标与服务端公开ID标记；只移动光标不写内容，真实输入能同步，接收端无回声。见截图（本地产物：`native-browser/row4-empty-name-caret.png`）。 |
| 5 | 1600/760/390px实际打开/收起评论，图标按钮在视口内，有可访问名称，Enter能收起；0条与1条锚定评论、编辑与阅读状态检查通过。人工复看窄屏图，按钮/计数/抽屉可见。见窄屏阅读态（本地产物：`native-browser/row5-390-one-comment-readonly.png`）。 |
| 6 | 超链接草稿的取消、关闭、Esc、外点四种路径均无内容写入/peer回声；确认链接后保存、撤销、重做和重开保留真实链接。见截图（本地产物：`native-browser/row6-saved-link.png`）。 |
| 8 | 新建和实际点击“新增工作表”得到的每张sheet均为19.8px默认行高、79.2px默认列宽，重开不变。不回填或转换历史baseline。见截图（本地产物：`native-browser/row8-added-worksheet.png`）。 |
| 11 | 实际“编辑流程图”工作区中，双击节点/连线文字分别全选原20/19字符；直接输入完全替换，工作区撤销/重做、保存、另一客户端打开检查及重开通过，无接收回声。见截图（本地产物：`native-browser/row11-reloaded-flowchart.png`）。 |
| 23 | A1:B5启用native filter后切到D8，原图那种整个筛选范围的蓝色框没有残留，只有D8活动单元格边界。真实筛选弹层显示三个状态，按指定复选项生效。见范围截图（本地产物：`native-browser/row23-filter-inactive-range.png`）。 |
| 33、34、56 | 两个账号实际使用同一共享筛选规则：包含待解决/解决中，排除已解决。下拉B2改为已解决后本地和另一账号即时隐藏该行，撤销恢复、重做再隐藏、刷新保留。另一份无数据验证的普通单元格由第二账号F2输入已解决，也让两端隐藏并重开保留，接收端零回声。按真实网格坐标点击后，名称框A4证明逻辑行4移至新的可见位置，未读取或修改私有编辑器对象。见下拉刷新（本地产物：`native-browser/row56-reloaded-filter.png`）、普通单元格刷新（本地产物：`native-browser/row33-plain-filter-reloaded.png`）。 |

没有确认需要再分派的新产品bug。验收期间的入口/fixture/原生编辑状态校准产物保留在忽略的`.local/issue-tracker-native-diagnostics/`与其他`.local/native-qa-*`目录，正式目录只保留最终成功收据和截图。此前Redo禁用发生在探针再次点击已选单元格进入文本编辑时；退出原生编辑后Undo/Redo正常，不能将其报告为清空历史栈。

本轮没有更改产品代码、DDL、持久化格式、协作协议、历史读器或源契约。全表关闭仍需其余Canvas原生/偏好、AI/扩展范围以及独立生产部署验收。
