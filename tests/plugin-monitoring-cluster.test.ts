import { expect, it } from "vitest";
import { createClient } from "redis";
import { openTestDatabase } from "./database.js";
import { MonitoringBuffer } from "@server/services/monitoring-buffer.js";
import {
  createHostMonitoring,
  type HostMonitoring,
} from "@server/services/monitoring.js";
import {
  createRealtimeCluster,
  type RealtimeCluster,
} from "@server/services/realtime/cluster.js";

const redisIt = process.env.DOCA_TEST_REDIS_URL ? it : it.skip;
redisIt(
  "merges Redis metrics/presence, preserves epochs, and reports stale, missing and invalid instances",
  async () => {
    const db = await openTestDatabase({ driver: "sqlite", path: ":memory:" });
    const prefix = "doca-monitoring-test-" + crypto.randomUUID();
    const redisUrl = process.env.DOCA_TEST_REDIS_URL!;
    const observer = createClient({ url: redisUrl });
    observer.on("error", () => {});
    await observer.connect();
    const realtime: RealtimeCluster[] = [],
      hosts: HostMonitoring[] = [];
    let now = Date.now();
    try {
      const a = await createRealtimeCluster({
          redisUrl,
          prefix,
          instanceId: "a",
        }),
        b = await createRealtimeCluster({ redisUrl, prefix, instanceId: "b" });
      realtime.push(a, b);
      const first = await createHostMonitoring(
        db,
        new MonitoringBuffer("a", () => now),
        a,
        { redisUrl, prefix },
      );
      const second = await createHostMonitoring(
        db,
        new MonitoringBuffer("b", () => now),
        b,
        { redisUrl, prefix },
      );
      hosts.push(first, second);
      first.buffer.begin();
      first.buffer.request("GET", "/documents/:id", 200, 10);
      second.buffer.begin();
      second.buffer.request("GET", "/documents/:id", 500, 30);
      second.telemetry.log("example.monitor", {
        level: "info",
        module: "jobs",
        message: "Before restart",
      });
      await first.cluster.publish();
      await second.cluster.publish();
      const initial = await first.service.metrics({ scope: "cluster" });
      expect(initial).toMatchObject({
        scope: "cluster",
        complete: true,
        http: {
          requests: 2,
          serverErrors: 1,
          latencyMs: { count: 2, sum: 40, min: 10, max: 30 },
        },
      });
      expect(initial.instances).toHaveLength(2);
      const logPage = await first.service.logs({ scope: "cluster" });
      expect(logPage.items.map((row) => row.message)).toEqual([
        "Before restart",
      ]);
      for (const [cluster, id] of [
        [a, "tab-a"],
        [b, "tab-b"],
      ] as const)
        await cluster.upsert({
          connectionId: id,
          userId: "same-user",
          name: "User",
          color: "#000",
          room: "same-document",
          selection: null,
        });
      expect(await first.service.online({})).toMatchObject({
        scope: "cluster",
        uniqueUsers: 1,
        connections: 2,
        activeDocuments: 1,
      });
      await second.close();
      now += 20000;
      const stale = await first.service.metrics({ scope: "cluster" });
      expect(stale).toMatchObject({
        complete: false,
        http: { requests: 1, serverErrors: 0 },
      });
      expect(
        stale.instances.find((row) => row.instanceId === "b"),
      ).toHaveProperty("stale", true);
      const restart = await createHostMonitoring(
        db,
        new MonitoringBuffer("b", () => now),
        b,
        { redisUrl, prefix },
      );
      hosts.push(restart);
      restart.telemetry.log("example.monitor", {
        level: "info",
        module: "jobs",
        message: "After restart",
      });
      await restart.cluster.publish();
      const next = await first.service.logs({
        scope: "cluster",
        cursor: logPage.cursor,
      });
      expect(next.items.map((row) => row.message)).toEqual(["After restart"]);
      expect(next.items[0]!.epoch).not.toBe(logPage.items[0]!.epoch);
      await observer.del(
        prefix + ":monitoring:v1:instances:" + second.buffer.epoch,
      );
      const missing = await first.service.logs({
        scope: "cluster",
        cursor: next.cursor,
      });
      expect(missing.complete).toBe(false);
      expect(missing.gaps).toContainEqual({
        instanceId: "b",
        epoch: second.buffer.epoch,
        reason: "instance-unavailable",
        dropped: null,
      });
      const badEpoch = crypto.randomUUID();
      await observer.zAdd(prefix + ":monitoring:v1:instances", {
        score: now,
        value: badEpoch,
      });
      const invalid = JSON.stringify({
        version: 2,
        credentials: "do-not-return",
      });
      await observer.set(
        prefix + ":monitoring:v1:instances:" + badEpoch,
        invalid,
      );
      const malformed = await first.service.metrics({ scope: "cluster" });
      expect(malformed.unavailable).toContain(badEpoch);
      expect(JSON.stringify(malformed)).not.toContain("do-not-return");
      expect(
        await observer.get(prefix + ":monitoring:v1:instances:" + badEpoch),
      ).toBe(invalid);
    } finally {
      for (const host of hosts) await host.close();
      for (const cluster of realtime) await cluster.close();
      const registry = prefix + ":monitoring:v1:instances";
      const epochs = await observer.zRange(registry, 0, -1);
      await observer.del([
        registry,
        ...epochs.map((epoch) => registry + ":" + epoch),
      ]);
      await observer.quit();
      await db.destroy();
    }
  },
  30000,
);
