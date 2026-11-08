-- Files attached to ledger cells. Bytes are split into chunks because D1 values max out at 2 MB.
CREATE TABLE attachments (
  file_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, id)
);

CREATE TABLE attachment_chunks (
  file_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_id, attachment_id, seq)
);
