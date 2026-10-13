import { sql, type Kysely } from "kysely";
export const BOOK_PAYLOAD_BASELINE = "doca-2026-10-12-book-payload-storage-v1";
export const BOOK_PAYLOAD_UPGRADE =
  "doca-2026-10-12-book-payload-upgrade-in-progress-v1";
export const BOOK_PAYLOAD_ROLLBACK =
  "doca-2026-10-12-book-payload-rollback-in-progress-v1";
export const bookPayloadTables = [
  "knowledge_book_payload_objects",
  "knowledge_book_payload_edges",
  "knowledge_book_payload_references",
  "knowledge_book_payload_operations",
];
export async function createBookPayloadSchema(db: Kysely<any>) {
  for (const ddl of [
    `CREATE TABLE knowledge_book_payload_objects (book_id varchar(36) not null, kind varchar(8) not null check(kind in ('data','index','root')), sha256 varchar(64) not null, store_id varchar(64) not null, object_key text not null, stored_sha256 varchar(64) not null, size bigint not null check(size > 0), raw_size bigint not null check(raw_size > 0), state varchar(8) not null check(state in ('ready','garbage')), created_at varchar(32) not null, updated_at varchar(32) not null, primary key(book_id,kind,sha256), unique(store_id,object_key))`,
    `CREATE TABLE knowledge_book_payload_edges (book_id varchar(36) not null, parent_kind varchar(8) not null, parent_sha256 varchar(64) not null, child_kind varchar(8) not null, child_sha256 varchar(64) not null, primary key(book_id,parent_kind,parent_sha256,child_kind,child_sha256), foreign key(book_id,parent_kind,parent_sha256) references knowledge_book_payload_objects(book_id,kind,sha256) on delete cascade, foreign key(book_id,child_kind,child_sha256) references knowledge_book_payload_objects(book_id,kind,sha256) on delete cascade)`,
    `CREATE TABLE knowledge_book_payload_references (book_id varchar(36) not null references knowledge_books(id) on delete cascade, owner_kind varchar(8) not null check(owner_kind in ('node','run','release')), owner_id varchar(36) not null, node_id varchar(100) not null, root_kind varchar(8) not null check(root_kind = 'root'), root_sha256 varchar(64) not null, raw_sha256 varchar(64) not null, raw_size bigint not null check(raw_size > 0), access_manifest text not null, summary text not null, created_at varchar(32) not null, updated_at varchar(32) not null, primary key(book_id,owner_kind,owner_id,node_id), check((owner_kind='node' and node_id<>'') or (owner_kind<>'node' and node_id='')), foreign key(book_id,root_kind,root_sha256) references knowledge_book_payload_objects(book_id,kind,sha256))`,
    `CREATE TABLE knowledge_book_payload_operations (id varchar(36) primary key, book_id varchar(36) not null, owner_kind varchar(8) not null, owner_id varchar(36) not null, node_id varchar(100) not null, expected_sha256 varchar(64) not null, definition text not null, lease_id varchar(36) not null, lease_until varchar(32) not null, state varchar(12) not null check(state in ('uploading','committed','garbage','deleted')), created_at varchar(32) not null, updated_at varchar(32) not null)`,
    `CREATE INDEX knowledge_book_payload_operations_cleanup ON knowledge_book_payload_operations(state,lease_until)`,
  ])
    await sql.raw(ddl).execute(db);
}
