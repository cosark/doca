import { expect, it } from "vitest";
import {
  createSearchHost,
  type SearchSourceDescriptor,
} from "@smartdoca/search-host";
import {
  MeilisearchSearchProvider,
  SearchRequestError,
} from "@server/services/search/meilisearch-provider.js";

const descriptor = {
  pluginId: "doca.documents",
  sourceId: "documents",
  schemaVersion: 1,
  renderer: { kind: "document-search-result", version: 1 },
} satisfies SearchSourceDescriptor;

type IndexedDocument = { id: string; title: string; text: string };
type Index = { documents: Map<string, IndexedDocument>; settings: any };

function setup() {
  const indexes = new Map<string, Index>([
    [
      "doca",
      {
        documents: new Map([
          ["previous", { id: "previous", title: "此前标题", text: "原正文" }],
        ]),
        settings: { searchableAttributes: ["title", "text"] },
      },
    ],
  ]);
  let failWrites = false;
  const deleted: string[] = [];
  const provider = new MeilisearchSearchProvider({
    config: async () => ({
      endpoint: "http://localhost:7700",
      index_name: "doca",
    }),
    async request(_config, path, method = "GET", body: any) {
      const url = new URL(path, "http://localhost:7700");
      if (path === "/indexes" && method === "POST")
        return {
          apply: () =>
            indexes.set(body.uid, { documents: new Map(), settings: {} }),
        };
      if (path === "/swap-indexes" && method === "POST")
        return {
          apply: () => {
            const [left, right] = body[0].indexes;
            const previous = indexes.get(left)!;
            indexes.set(left, indexes.get(right)!);
            indexes.set(right, previous);
          },
        };
      const [, , name, operation] = url.pathname.split("/");
      const index = indexes.get(name!);
      if (!index) throw new SearchRequestError(404);
      if (method === "DELETE" && !operation)
        return {
          apply: () => {
            deleted.push(name!);
            indexes.delete(name!);
          },
        };
      if (operation === "settings") {
        if (method === "PATCH")
          return {
            apply: () => {
              index.settings = body;
            },
          };
        return {};
      }
      if (operation === "documents" && method === "POST")
        return {
          documents: true,
          apply: () => {
            for (const document of body)
              index.documents.set(document.id, document);
          },
        };
      if (operation === "search") {
        const fields: string[] = index.settings.searchableAttributes;
        return {
          hits: [...index.documents.values()]
            .filter((document) =>
              fields.some((field) =>
                String(document[field as keyof IndexedDocument] ?? "").includes(
                  body.q,
                ),
              ),
            )
            .map(({ id }) => ({ id })),
        };
      }
      if (method === "GET" && !operation)
        return { uid: name, primaryKey: "id" };
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
    async waitTask(_config, task) {
      if (task.documents && failWrites) throw new Error("AccountQuotaExceeded");
      task.apply();
    },
  });
  const host = createSearchHost(provider);
  host.registry.register({
    descriptor,
    authorize: ({ candidateIds }) => candidateIds,
    hydrate: ({ ids }) => new Map(ids.map((id) => [id, { id }])),
    projections: () => [
      {
        id: "current",
        text: "没有标题关键词的正文",
        metadata: { title: "问题" },
      },
    ],
  });
  provider.bindAlias(host.indexNames(descriptor).alias, descriptor, {
    useConfiguredIndex: true,
  });
  return {
    indexes,
    deleted,
    host,
    failWrites: () => {
      failWrites = true;
    },
  };
}

it("preserves the active Meilisearch index when the first rebuild after startup fails", async () => {
  const fixture = setup();
  try {
    fixture.failWrites();
    await expect(
      fixture.host.rebuild({ source: descriptor, context: {} }),
    ).rejects.toThrow("AccountQuotaExceeded");
    expect(fixture.indexes.get("doca")?.documents.get("previous")?.title).toBe(
      "此前标题",
    );
    expect(fixture.deleted).not.toContain("doca");
    expect([...fixture.indexes.keys()]).toEqual(["doca"]);
    const result = await fixture.host.query({ query: "此前标题", context: {} });
    expect(result.items.map((item) => item.id)).toEqual(["previous"]);
  } finally {
    await fixture.host.dispose();
  }
});

it("publishes a complete replacement and retrieves title-only matches through Meilisearch", async () => {
  const fixture = setup();
  try {
    await fixture.host.rebuild({ source: descriptor, context: {} });
    expect([...fixture.indexes.get("doca")!.documents.keys()]).toEqual([
      "current",
    ]);
    expect(fixture.indexes.get("doca")!.settings.searchableAttributes).toEqual([
      "title",
      "text",
    ]);
    const result = await fixture.host.query({ query: "问题", context: {} });
    expect(result.items.map((item) => item.id)).toEqual(["current"]);
    expect(
      (await fixture.host.query({ query: "此前标题", context: {} })).items,
    ).toEqual([]);
  } finally {
    await fixture.host.dispose();
  }
});
