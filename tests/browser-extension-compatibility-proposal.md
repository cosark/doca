# 状态：单套方案提议已撤回

2026-10-21 主会话转达用户最新明确决定：继续使用多套收录方案，有一个默认方案。保留既有 is_default 语义及所有历史记录；新界面预选默认并允许切换。以下旧提议未获批准，不实施。此轮无数据库、持久格式或旧数据转换。

# Browser extension issue 49/50: approval proposal

Current 0.2.7 stores multiple `browser_clipper_profiles` rows. Captures and
`browser_clipper_assistant_sessions` reference profile IDs/revisions. The UI and
background currently choose an explicit profile, otherwise default/first.

Proposed single-rule behavior, pending explicit user agreement:

- Retain every profile, receipt, document, original image, session binding and
  running job. Do not merge/delete/backfill historical records.
- New captures and new extension AI sessions require exactly one enabled default
  platform profile. Missing/conflicting defaults cause an explicit settings error;
  do not silently choose the first historical row or invent a default.
- The platform edits that current rule. Other existing profiles remain historical
  records. New server operations reject an old extension's non-default profile
  selection explicitly. Current v2 connection / v1 capture payload shapes remain;
  no v1 authorization/config reader or automatic conversion is introduced.
- Existing AI conversations/jobs retain their original profile/scope. Changing the
  default applies to new tasks; switching profiles starts a new extension session.
  Explicit connection revocation continues to cancel authorized browser jobs.
- Validate retained multiple-profile 0.2.7 fixtures, no-default/conflict rejection,
  changed-default races, original permissions, and repeated startup without writes.
  Roll back UI/new-operation restrictions while preserving all records and bindings.

The existing assistant association table can identify browser-created conversations.
The shared AI history badge requires the main AI owner to coordinate; no new source
column or persisted metadata is needed. This task does not modify shared AI routes.

Until agreement, independent UI work preserves the current profile operation and
wire formats. No database or historical conversation conversion is performed.
