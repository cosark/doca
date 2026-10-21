export interface BrowserClipperSchema {
  browser_clipper_web_sessions: {
    connection_id: string;
    user_id: string;
    installation_id: string;
    website_session_id: string;
    token_hash: string | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
  };
  browser_clipper_login_codes: {
    code_hash: string;
    connection_id: string;
    website_session_id: string;
    challenge: string;
    expires_at: string;
    consumed_at: string | null;
    created_at: string;
  };
  browser_clipper_profiles: {
    id: string;
    user_id: string;
    name: string;
    enabled: number;
    is_default: number;
    strategy: "create" | "append";
    library_id: string | null;
    parent_id: string | null;
    target_id: string | null;
    title_template: string;
    ai_instruction: string;
    revision: number;
    created_at: string;
    updated_at: string;
  };
  browser_clipper_connections: {
    id: string;
    user_id: string;
    name: string;
    token_hash: string | null;
    token_hint: string | null;
    assistant_enabled: number;
    revoked_at: string | null;
    expires_at: string | null;
    revision: number;
    created_at: string;
    updated_at: string;
  };
  browser_clipper_activations: {
    id: string;
    connection_id: string;
    secret_hash: string;
    connection_revision: number;
    expires_at: string;
    consumed_at: string | null;
    created_at: string;
  };
  browser_clipper_receipts: {
    user_id: string;
    request_id: string;
    connection_id: string;
    input_hash: string;
    profile_id: string;
    profile_json: string;
    payload_json: string;
    images_json: string;
    status: "pending" | "completed" | "expired";
    resource_id: string | null;
    expires_at: string;
    created_at: string;
    updated_at: string;
  };
  browser_clipper_assistant_sessions: {
    session_id: string;
    connection_id: string;
    user_id: string;
    profile_id: string;
    profile_revision: number;
    resource_ids: string;
    job_ids: string;
    created_at: string;
  };
}
