import type { DB } from "@db/index.js";
import type { Actor } from "../identity/passwords.js";
import type { BookArtifact } from "./protocol.js";
import { bookNodeInputs } from "./protocol.js";
import {
  readBookRun,
  readBookRelease,
  readKnowledgeBookSummary,
  readBookRunSummary,
  readBookReleaseSummary,
} from "./reads.js";
import { bookFail as fail } from "./errors.js";

export async function readBookForAssistant(db: DB, actor: Actor, id: string) {
  const book = await readKnowledgeBookSummary(db, actor, id);
  return {
    ...book,
    workflowRules: { inputsByNodeType: bookNodeInputs, maxNodes: 40, maxEdges: 100, guidance: "All nodes must reach the single publish node. Writing/organization/acceptance batch internally; do not chain same-type nodes to work around a per-request budget. To create parallel writers, each synthesize consumes extract and feeds organize. To restrict branch evidence, select sourceIds on its sources node and use a separate extract node; sourceIds on a writer does not filter its inherited evidence. Writers must retain all distinct inherited claims. node.add only adds edges; configuration.save atomically replaces topology when existing edges must be removed." },
    sources: book.sources.map((source) => ({
      ...source,
      configuration: source.configuration
        ? {
            ...source.configuration,
            items: source.configuration.items.map((binding) =>
              binding.kind === "manual"
                ? {
                    ...binding,
                    markdown: null,
                    contentLength: binding.markdown.length,
                    contentOmitted: true,
                  }
                : binding,
            ),
          }
        : null,
    })),
    publishedRelease: book.publishedRelease
      ? {
          ...book.publishedRelease,
          artifact: book.publishedRelease.artifact,
        }
      : null,
  };
}
export async function readRunForAssistant(
  db: DB,
  actor: Actor,
  bookId: string,
  runId: string,
) {
  return readBookRunSummary(db, actor, bookId, runId);
}
export async function readReleaseForAssistant(
  db: DB,
  actor: Actor,
  bookId: string,
  releaseId: string,
) {
  return readBookReleaseSummary(db, actor, bookId, releaseId);
}
export async function readBookPageForAssistant(
  db: DB,
  actor: Actor,
  bookId: string,
  releaseId: string,
  pageId: string,
  offset = 0,
) {
  const release = await readBookRelease(db, actor, bookId, releaseId);
  if (!release.artifact)
    fail(403, "Original evidence access is required to read this page");
  const artifact = release.artifact;
  const page = artifact.pages.find((page) => page.id === pageId);
  if (!page) fail(404, "Knowledge book page not found");
  const paragraphs = page.paragraphs.slice(offset, offset + 5);
  const claims = artifact.claims.filter((claim) =>
    paragraphs.some((p) => p.claimIds.includes(claim.id)),
  );
  const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
  return {
    releaseId,
    page: { id: page.id, title: page.title, path: page.path },
    paragraphs,
    claims,
    evidence: artifact.evidence.filter((e) => evidenceIds.has(e.id)),
    nextOffset:
      offset + paragraphs.length < page.paragraphs.length
        ? offset + paragraphs.length
        : null,
  };
}
export async function findBookParagraphs(
  db: DB,
  actor: Actor,
  bookId: string,
  releaseId: string,
  query: string,
  offset = 0,
) {
  const release = await readBookRelease(db, actor, bookId, releaseId);
  if (!release.artifact)
    fail(403, "Original evidence access is required to search this release");
  const needle = query.toLocaleLowerCase();
  const matches = release.artifact.pages.flatMap((page) =>
    page.paragraphs
      .filter((p) => p.markdown.toLocaleLowerCase().includes(needle))
      .map((p) => ({
        pageId: page.id,
        title: page.title,
        path: page.path,
        paragraphId: p.id,
        excerpt: p.markdown.slice(
          Math.max(0, p.markdown.toLocaleLowerCase().indexOf(needle) - 100),
          p.markdown.toLocaleLowerCase().indexOf(needle) + 500,
        ),
      })),
  );
  return {
    items: matches.slice(offset, offset + 20),
    total: matches.length,
    nextOffset: offset + 20 < matches.length ? offset + 20 : null,
  };
}

export async function readBookSourceForAssistant(
  db: DB,
  actor: Actor,
  bookId: string,
  sourceId: string,
  offset = 0,
  bindingId?: string,
) {
  const book = await readKnowledgeBookSummary(db, actor, bookId),
    source = book.sources.find((source) => source.id === sourceId);
  if (!source) fail(404, "Knowledge book source not found");
  if (!source.readable || !source.configuration)
    fail(403, "Original source access is required");
  if (!bindingId)
    return {
      ...source,
      configuration: {
        ...source.configuration,
        items: source.configuration.items.map((binding) =>
          binding.kind === "manual"
            ? {
                ...binding,
                markdown: null,
                contentLength: binding.markdown.length,
                contentOmitted: true,
              }
            : binding,
        ),
      },
    };
  const binding = source.configuration.items.find(
    (item) => item.id === bindingId,
  );
  if (!binding) fail(404, "Source binding not found");
  if (binding.kind !== "manual") return { sourceId, binding };
  const { markdown, ...configuration } = binding;
  return {
    sourceId,
    binding: configuration,
    markdownSegment: markdown.slice(offset, offset + 4000),
    offset,
    contentLength: markdown.length,
    nextOffset: offset + 4000 < markdown.length ? offset + 4000 : null,
  };
}
export function bookNodeManifest(output: {
  pages: BookArtifact["pages"];
  checks: BookArtifact["checks"];
  claims: BookArtifact["claims"];
  evidence: BookArtifact["evidence"];
}) {
  return {
    pages: output.pages.map((page) => ({
      id: page.id,
      title: page.title,
      path: page.path,
      paragraphCount: page.paragraphs.length,
    })),
    checks: output.checks,
    claimCount: output.claims.length,
    evidenceCount: output.evidence.length,
  };
}
export async function readCandidatePageForAssistant(
  db: DB,
  actor: Actor,
  bookId: string,
  runId: string,
  nodeId: string,
  pageId: string,
  offset = 0,
) {
  const run = await readBookRun(db, actor, bookId, runId);
  if (run.restricted)
    fail(403, "Original evidence access is required to inspect this run");
  const output = run.nodes.find((node) => node.nodeId === nodeId)?.output;
  const page = output?.pages?.find(
    (page: BookArtifact["pages"][number]) => page.id === pageId,
  );
  if (!page) fail(404, "Candidate page not found");
  const paragraphs = page.paragraphs.slice(offset, offset + 5),
    claims = output.claims.filter((claim: BookArtifact["claims"][number]) =>
      paragraphs.some(
        (paragraph: BookArtifact["pages"][number]["paragraphs"][number]) =>
          paragraph.claimIds.includes(claim.id),
      ),
    ),
    evidenceIds = new Set(
      claims.flatMap(
        (claim: BookArtifact["claims"][number]) => claim.evidenceIds,
      ),
    );
  return {
    runId,
    nodeId,
    page: { id: page.id, title: page.title, path: page.path },
    paragraphs,
    claims,
    evidence: output.evidence.filter((e: BookArtifact["evidence"][number]) =>
      evidenceIds.has(e.id),
    ),
    nextOffset:
      offset + paragraphs.length < page.paragraphs.length
        ? offset + paragraphs.length
        : null,
  };
}
