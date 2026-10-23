import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DB, Schema } from "@db/index.js";
import type { Transaction } from "kysely";
import { transact } from "@db/transactions.js";
import { lockAIUser } from "@core/modules/ai/config.js";
import { authorize } from "@core/modules/access/queries.js";
import { authenticateBrowserConnection } from "@core/modules/browser-clipper/access.js";
import { createDocuments } from "@core/modules/collaboration/documents.js";
import type { EditorInput } from "@core/modules/collaboration/protocol.js";
import { preparePlainTextAppend } from "@core/modules/documents/append-plain-text.js";
import { AppError, fail } from "@core/shared/errors.js";
import { tokenHash } from "@core/modules/identity/passwords.js";
import { publicProfile, validateClipperTarget } from "./browser-clipper.js";

export const quickNoteInput = z
  .object({
    requestId: z.string().uuid(),
    profileId: z.string().uuid(),
    profileRevision: z.number().int().positive(),
    text: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.text.trim() || Buffer.byteLength(value.text) > 64 * 1024)
      ctx.addIssue({ code: "custom", message: "Invalid plain text" });
  });
export const quickNoteCommit = z
  .object({
    requestId: z.string().uuid(),
    ticket: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type NoteInput = z.infer<typeof quickNoteInput>;
type NoteTicket = {
  ticket: string;
  userId: string;
  connectionId: string;
  authorizationHash: string;
  input: NoteInput;
  targetId: string;
  format: string;
  update: EditorInput;
  expiresAt: number;
};

/** No draft, grant or receipt format is introduced: tickets live only in this process. */
export function createBrowserQuickNote(
  db: DB,
  origin: string,
  notify: (id: string) => Promise<unknown>,
  options: {
    now?: () => number;
    lifetimeMs?: number;
    maxTickets?: number;
  } = {},
) {
  const tickets = new Map<string, NoteTicket>();
  const preparing = new Map<
    string,
    { input: string; promise: Promise<ReturnType<typeof prepared>> }
  >();
  const now = options.now ?? Date.now;
  const lifetime = options.lifetimeMs ?? 5 * 60_000;
  const maxTickets = options.maxTickets ?? 1000;
  const key = (userId: string, connectionId: string, requestId: string) =>
    `${userId}/${connectionId}/${requestId}`;
  function prune() {
    for (const [id, ticket] of tickets)
      if (ticket.expiresAt <= now()) tickets.delete(id);
  }
  const cleanup = setInterval(prune, 60_000);
  cleanup.unref();
  async function profileTarget(
    tx: DB,
    actor: Awaited<ReturnType<typeof authenticateBrowserConnection>>["actor"],
    profileId: string,
    revision: number,
  ) {
    const profile = await tx
      .selectFrom("browser_clipper_profiles")
      .selectAll()
      .where("id", "=", profileId)
      .where("user_id", "=", actor.id)
      .executeTakeFirst();
    if (!profile || !profile.enabled || profile.revision !== revision)
      fail(409, "clipper_profile_changed");
    if (profile.strategy !== "append" || !profile.target_id)
      fail(403, "quick_note_append_profile_required");
    await validateClipperTarget(tx, actor, publicProfile(profile));
    const { resource } = await authorize(tx, actor, profile.target_id, 3);
    return { profile, resource };
  }
  async function locked<T>(
    authorization: string | undefined,
    work: (
      tx: Transaction<Schema>,
      auth: Awaited<ReturnType<typeof authenticateBrowserConnection>>,
    ) => Promise<T>,
  ) {
    const candidate = await authenticateBrowserConnection(db, authorization);
    return transact(db, async (tx) => {
      await lockAIUser(tx, candidate.actor.id);
      const current = await authenticateBrowserConnection(tx, authorization);
      if (
        current.actor.id !== candidate.actor.id ||
        current.connection.id !== candidate.connection.id
      )
        fail(401, "clipper_login_required");
      return work(tx, current);
    });
  }
  function prepared(ticket: NoteTicket) {
    return {
      requestId: ticket.input.requestId,
      ticket: ticket.ticket,
      targetId: ticket.targetId,
      format: ticket.format,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
    };
  }
  return {
    async targets(authorization: string | undefined) {
      const { actor } = await authenticateBrowserConnection(db, authorization);
      const profiles = await db
        .selectFrom("browser_clipper_profiles")
        .selectAll()
        .where("user_id", "=", actor.id)
        .where("enabled", "=", 1)
        .where("strategy", "=", "append")
        .orderBy("created_at")
        .execute();
      const items = [];
      for (const p of profiles) {
        try {
          const { resource } = await profileTarget(db, actor, p.id, p.revision);
          items.push({
            profileId: p.id,
            profileRevision: p.revision,
            profileName: p.name,
            isDefault: !!p.is_default,
            targetId: resource.id,
            title: resource.title,
            format: resource.format,
          });
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            ![400, 403, 404, 409].includes(error.status)
          )
            throw error;
        }
      }
      return { items };
    },
    async prepare(authorization: string | undefined, input: NoteInput) {
      const candidate = await authenticateBrowserConnection(db, authorization);
      const prepareKey = key(
        candidate.actor.id,
        candidate.connection.id,
        input.requestId,
      );
      const signature = JSON.stringify([
        tokenHash(authorization!),
        input.profileId,
        input.profileRevision,
        input.text,
      ]);
      const inFlight = preparing.get(prepareKey);
      if (inFlight) {
        if (inFlight.input !== signature)
          fail(409, "quick_note_request_conflict");
        return inFlight.promise;
      }
      prune();
      if (!tickets.has(prepareKey)) {
        const reserved = [...preparing.keys()].filter((id) => !tickets.has(id));
        const userPrefix = `${candidate.actor.id}/`;
        if (
          tickets.size + reserved.length >= maxTickets ||
          [...tickets.keys(), ...reserved].filter((id) =>
            id.startsWith(userPrefix),
          ).length >= 30
        )
          fail(429, "quick_note_busy");
      }
      const promise = (async () => {
        const saved = await locked(
          authorization,
          async (tx, { actor, connection }) => {
            const { resource } = await profileTarget(
              tx,
              actor,
              input.profileId,
              input.profileRevision,
            );
            prune();
            const cacheKey = key(actor.id, connection.id, input.requestId);
            const existing = tickets.get(cacheKey);
            if (existing) {
              if (existing.authorizationHash !== tokenHash(authorization!))
                fail(409, "quick_note_signin_changed");
              if (
                JSON.stringify(existing.input) !== JSON.stringify(input) ||
                existing.targetId !== resource.id
              )
                fail(409, "quick_note_request_conflict");
              return existing;
            }
            // A missing/expired ticket must never regenerate a previously accepted request.
            if (
              await tx
                .selectFrom(
                  resource.format === "markdown"
                    ? "markdown_receipts"
                    : "editor_receipts",
                )
                .select("message_id")
                .where("resource_id", "=", resource.id)
                .where("message_id", "=", input.requestId)
                .executeTakeFirst()
            )
              fail(409, "quick_note_request_already_used");
            if (
              tickets.size >= maxTickets ||
              [...tickets.values()].filter((t) => t.userId === actor.id)
                .length >= 30
            )
              fail(429, "quick_note_busy");
            const ticket: NoteTicket = {
              ticket: randomBytes(32).toString("hex"),
              userId: actor.id,
              connectionId: connection.id,
              authorizationHash: tokenHash(authorization!),
              input: { ...input },
              targetId: resource.id,
              format: resource.format,
              update: await preparePlainTextAppend(
                tx,
                actor,
                resource.id,
                input.text,
                input.requestId,
              ),
              expiresAt: now() + lifetime,
            };
            return ticket;
          },
        );
        // Publish only after the handshake transaction commits.
        tickets.set(
          key(saved.userId, saved.connectionId, saved.input.requestId),
          saved,
        );
        return prepared(saved);
      })();
      preparing.set(prepareKey, { input: signature, promise });
      try {
        return await promise;
      } finally {
        preparing.delete(prepareKey);
      }
    },
    async commit(
      authorization: string | undefined,
      input: z.infer<typeof quickNoteCommit>,
    ) {
      const saved = await locked(
        authorization,
        async (tx, { actor, connection }) => {
          prune();
          const ticket = tickets.get(
            key(actor.id, connection.id, input.requestId),
          );
          if (!ticket || ticket.ticket !== input.ticket)
            fail(409, "quick_note_ticket_missing");
          if (ticket.authorizationHash !== tokenHash(authorization!))
            fail(409, "quick_note_signin_changed");
          const { resource } = await profileTarget(
            tx,
            actor,
            ticket.input.profileId,
            ticket.input.profileRevision,
          );
          if (
            resource.id !== ticket.targetId ||
            resource.format !== ticket.format
          )
            fail(409, "clipper_profile_changed");
          const result = await createDocuments(tx).exchange(
            actor,
            resource.id,
            ticket.update,
          );
          return {
            requestId: input.requestId,
            targetId: resource.id,
            url: `${origin}/#/r/${resource.id}`,
            seq: result.seq,
            epochId: result.epochId,
            changed: result.changed,
          };
        },
      );
      await notify(saved.targetId).catch(() => {});
      return saved;
    },
    close() {
      clearInterval(cleanup);
      tickets.clear();
      preparing.clear();
    },
  };
}
