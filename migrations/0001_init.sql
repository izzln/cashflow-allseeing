-- Files: one workbook each. content is the workbook JSON, stored as sent by the app.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- The owner's local month when the file was created (for the month-end rule).
  created_month TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  month_end_done TEXT,
  -- Goes up whenever a snapshot is added or removed, so windows can refresh their list.
  snap_rev INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  as_of TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX snapshots_by_file ON snapshots (file_id, taken_at);

-- Failed logins, for rate limiting.
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_by_ip ON login_failures (ip, at);
