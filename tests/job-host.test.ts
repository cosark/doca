import { describe, expect, it } from "vitest";
import {
  DuplicateJobKindError,
  JobHandlerRegistry,
  JobHost,
  MemoryJobSchedulerAdapter,
} from "../packages/job-host/src/index.js";

describe("job handler registry", () => {
  it("enforces unique kinds and gives ownership to an idempotent disposer", () => {
    const registry = new JobHandlerRegistry();
    const dispose = registry.register({
      kind: "documents.render",
      run() {},
    });

    expect(registry.has("documents.render")).toBe(true);
    expect(() =>
      registry.register({ kind: "documents.render", run() {} }),
    ).toThrow(DuplicateJobKindError);
    dispose();
    dispose.dispose();
    expect(registry.has("documents.render")).toBe(false);
  });
});

describe("job host dispatch", () => {
  it("completes an owned job and blocks a missing plugin handler", async () => {
    const scheduler = new MemoryJobSchedulerAdapter({
      now: () => new Date("2026-09-25T00:00:00.000Z"),
    });
    const handled: string[] = [];
    scheduler.enqueue({
      id: "job-1",
      kind: "documents.render",
      pluginId: "doca.documents",
      payload: { documentId: "document-1" },
    });
    scheduler.enqueue({
      id: "job-2",
      kind: "mail.sync",
      pluginId: "doca.mail",
      payload: {},
    });
    const host = new JobHost({
      scheduler,
      context: { handled },
      now: () => new Date("2026-09-25T00:00:00.000Z"),
    });
    host.register({
      kind: "documents.render",
      pluginId: "doca.documents",
      run(payload, { host: context }) {
        context.handled.push(
          String((payload as { documentId: string }).documentId),
        );
      },
    });

    expect((await host.runOnce()).state).toBe("completed");
    expect((await host.runOnce()).state).toBe("blocked-plugin-missing");
    expect(handled).toEqual(["document-1"]);
    expect(scheduler.get("job-1")?.state).toBe("completed");
    expect(scheduler.get("job-2")?.state).toBe("blocked-plugin-missing");
  });
});

describe("memory job leasing", () => {
  const now = "2026-09-25T00:00:00.000Z";
  const earlier = "2026-09-24T00:00:00.000Z";

  it("leases by availability then ID regardless of insertion order", async () => {
    const scheduler = new MemoryJobSchedulerAdapter({ now: () => new Date(now) });
    for (const [id, availableAt] of [
      ["future", "2026-09-26T00:00:00.000Z"],
      ["z", now],
      ["b", earlier],
      ["a", earlier],
    ] as const)
      scheduler.enqueue({ id, kind: "task", payload: {}, availableAt });

    const leased: string[] = [];
    for (let index = 0; index < 3; index++) {
      const job = await scheduler.lease({ now, leaseMs: 1000 });
      leased.push(job!.id);
      await scheduler.complete(job!);
    }
    expect(leased).toEqual(["a", "b", "z"]);
    expect(await scheduler.lease({ now, leaseMs: 1000 })).toBeUndefined();
  });

  it("reclaims expired leases while fencing their previous owners", async () => {
    const scheduler = new MemoryJobSchedulerAdapter({ now: () => new Date(now) });
    scheduler.enqueue({ id: "job", kind: "task", payload: {} });
    const first = (await scheduler.lease({ now, leaseMs: 1000 }))!;
    expect(await scheduler.lease({ now, leaseMs: 1000 })).toBeUndefined();

    const reclaimed = (await scheduler.lease({
      now: "2026-09-25T00:00:01.000Z",
      leaseMs: 1000,
    }))!;
    expect(reclaimed.id).toBe(first.id);
    expect(reclaimed.leaseToken).not.toBe(first.leaseToken);
    expect(await scheduler.complete(first)).toBe(false);
    expect(await scheduler.complete(reclaimed)).toBe(true);
  });

  it("leaves blocked jobs unavailable until explicitly unblocked", async () => {
    const scheduler = new MemoryJobSchedulerAdapter({ now: () => new Date(now) });
    scheduler.enqueue({ id: "job", kind: "task", payload: {} });
    const job = (await scheduler.lease({ now, leaseMs: 1000 }))!;
    await scheduler.blockPluginMissing(job, { attempts: 1, error: "missing" });
    expect(await scheduler.lease({ now, leaseMs: 1000 })).toBeUndefined();
    expect(scheduler.unblock(job.id)).toBe(true);
    expect((await scheduler.lease({ now, leaseMs: 1000 }))?.id).toBe(job.id);
  });
});
