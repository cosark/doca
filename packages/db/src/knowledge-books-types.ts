export interface KnowledgeBookTables {
  knowledge_book_batch_checkpoints: {
    id: string;
    book_id: string;
    run_id: string;
    node_id: string;
    stage: "extract" | "synthesize" | "organize" | "acceptance";
    phase: string;
    scope_hash: string;
    plan_hash: string;
    batch_key: string;
    input_hash: string;
    result_ref: string;
    root_kind: "root";
    root_sha256: string;
    raw_sha256: string;
    raw_size: number;
    access_manifest: string;
    summary: string;
    created_at: string;
    updated_at: string;
  };
  knowledge_book_payload_objects: {
    book_id: string;
    kind: "data" | "index" | "root";
    sha256: string;
    store_id: string;
    object_key: string;
    stored_sha256: string;
    size: number;
    raw_size: number;
    state: "ready" | "garbage";
    created_at: string;
    updated_at: string;
  };
  knowledge_book_payload_edges: {
    book_id: string;
    parent_kind: "data" | "index" | "root";
    parent_sha256: string;
    child_kind: "data" | "index" | "root";
    child_sha256: string;
  };
  knowledge_book_payload_references: {
    book_id: string;
    owner_kind: "node" | "run" | "release";
    owner_id: string;
    node_id: string;
    root_kind: "root";
    root_sha256: string;
    raw_sha256: string;
    raw_size: number;
    access_manifest: string;
    summary: string;
    created_at: string;
    updated_at: string;
  };
  knowledge_book_payload_operations: {
    id: string;
    book_id: string;
    owner_kind: string;
    owner_id: string;
    node_id: string;
    expected_sha256: string;
    definition: string;
    lease_id: string;
    lease_until: string;
    state: "uploading" | "committed" | "garbage" | "deleted";
    created_at: string;
    updated_at: string;
  };
  knowledge_books: {
    id: string;
    revision: number;
    configuration: string;
    published_release_id: string | null;
    created_at: string;
    updated_at: string;
  };
  knowledge_book_configurations: {
    book_id: string;
    revision: number;
    configuration: string;
    author_id: string;
    created_at: string;
  };
  knowledge_book_sources: {
    id: string;
    book_id: string;
    title: string;
    creator_id: string;
    revision: number;
    /** Strict source list: {version: 1, items: [{id, kind, ...scope}]}. */
    configuration: string;
    status: "active" | "paused" | "removed";
    created_at: string;
    updated_at: string;
  };
  knowledge_book_source_versions: {
    source_id: string;
    revision: number;
    title: string;
    /** Complete immutable binding-list snapshot; no single-source adapter. */
    configuration: string;
    status: "active" | "paused" | "removed";
    author_id: string;
    created_at: string;
  };
  knowledge_book_feedback: {
    id: string;
    book_id: string;
    author_id: string;
    revision: number;
    detail: string;
    status: "active" | "withdrawn";
    created_at: string;
    updated_at: string;
  };
  knowledge_book_feedback_versions: {
    feedback_id: string;
    revision: number;
    detail: string;
    status: "active" | "withdrawn";
    author_id: string;
    created_at: string;
  };
  knowledge_book_runs: {
    id: string;
    book_id: string;
    actor_id: string;
    configuration_revision: number;
    configuration: string;
    input_hash: string;
    status:
      | "queued"
      | "running"
      | "awaiting_input"
      | "queued_resume"
      | "awaiting_publication"
      | "queued_publish"
      | "published"
      | "failed"
      | "cancelled";
    lease_id: string | null;
    started_at: string | null;
    heartbeat_at: string | null;
    artifact: string | null;
    error: string;
    trigger_key: string | null;
    created_at: string;
    updated_at: string;
  };
  knowledge_book_node_runs: {
    run_id: string;
    node_id: string;
    type: string;
    status:
      | "running"
      | "completed"
      | "awaiting_input"
      | "awaiting_publication"
      | "cancelled"
      | "failed";
    input_refs: string;
    output: string;
    error: string;
    started_at: string;
    completed_at: string | null;
  };
  knowledge_book_releases: {
    id: string;
    book_id: string;
    run_id: string;
    revision: number;
    artifact: string;
    created_at: string;
  };
  knowledge_book_human_tasks: {
    id: string;
    book_id: string;
    run_id: string;
    node_id: string;
    kind: "review" | "publication" | "repair";
    title: string;
    status: "pending" | "resolved" | "cancelled" | "superseded";
    revision: number;
    input_hash: string;
    resolution: string;
    created_at: string;
    updated_at: string;
  };
}
