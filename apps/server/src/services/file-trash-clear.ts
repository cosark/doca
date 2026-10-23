import { createHash } from "node:crypto";
import type { DB } from "@db/index.js";
import { readSnapshot, transact } from "@db/transactions.js";
import { fail } from "@core/shared/errors.js";

async function entries(db: DB, userId: string) {
  const [folders, files] = await Promise.all([
    db
      .selectFrom("file_folders")
      .select(["id", "name", "version", "deleted_at"])
      .where("owner_id", "=", userId)
      .where("deleted_at", "is not", null)
      .orderBy("id")
      .execute(),
    db
      .selectFrom("file_items")
      .select(["id", "name", "version", "deleted_at"])
      .where("owner_id", "=", userId)
      .where("deleted_at", "is not", null)
      .orderBy("id")
      .execute(),
  ]);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ folders, files }))
    .digest("hex");
  return { folders, files, fingerprint };
}

export async function previewFileTrashClear(db: DB, userId: string) {
  return readSnapshot(db, async (tx) => {
    const current = await entries(tx, userId);
    const names = [...current.folders, ...current.files].map((row) => row.name);
    return {
      fingerprint: current.fingerprint,
      folderCount: current.folders.length,
      fileCount: current.files.length,
      names: names.slice(0, 50),
      omitted: Math.max(0, names.length - 50),
    };
  });
}

export async function assertFileTrashFolderContents(
  db: DB,
  folderIds: string[],
  fileIds: string[],
) {
  if (!folderIds.length) return;
  const [children, files] = await Promise.all([
    db
      .selectFrom("file_folders")
      .select("id")
      .where("parent_id", "in", folderIds)
      .execute(),
    db
      .selectFrom("file_items")
      .select("id")
      .where("parent_type", "=", "folder")
      .where("parent_id", "in", folderIds)
      .execute(),
  ]);
  const foldersToRemove = new Set(folderIds),
    filesToRemove = new Set(fileIds);
  if (
    children.some((row) => !foldersToRemove.has(row.id)) ||
    files.some((row) => !filesToRemove.has(row.id))
  )
    fail(409, "回收站文件夹仍有未删除或其他用户的内容，请先处理这些内容", {
      code: "file_trash_live_children",
    });
}

/** An explicit confirmation clears only its exact owned, still-deleted snapshot.
 * Stored objects retain the existing file-purge retention/cleanup mechanism.
 */
export async function clearFileTrash(
  db: DB,
  userId: string,
  fingerprint: string,
  enqueue: (tx: DB, fileId: string) => Promise<unknown>,
) {
  return transact(db, async (tx) => {
    const current = await entries(tx, userId);
    const changed = () =>
      fail(409, "文件回收站已变化，请重新确认", { code: "file_trash_changed" });
    if (current.fingerprint !== fingerprint) changed();
    const folderIds = current.folders.map((row) => row.id);
    await assertFileTrashFolderContents(
      tx,
      folderIds,
      current.files.map((row) => row.id),
    );
    for (const row of current.files) {
      const result = await tx
        .deleteFrom("file_items")
        .where("id", "=", row.id)
        .where("owner_id", "=", userId)
        .where("version", "=", row.version)
        .where("deleted_at", "is not", null)
        .executeTakeFirst();
      if (Number(result.numDeletedRows) !== 1) changed();
      await enqueue(tx, row.id);
    }
    for (const row of current.folders) {
      const result = await tx
        .deleteFrom("file_folders")
        .where("id", "=", row.id)
        .where("owner_id", "=", userId)
        .where("version", "=", row.version)
        .where("deleted_at", "is not", null)
        .executeTakeFirst();
      if (Number(result.numDeletedRows) !== 1) changed();
    }
    return {
      ok: true,
      fileCount: current.files.length,
      folderCount: current.folders.length,
    };
  });
}
