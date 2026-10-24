CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  seed INTEGER,
  status TEXT NOT NULL CHECK(status IN ('dispatching','queued','processing','unknown','succeeded','failed','deleting','deleted')),
  billing_state TEXT NOT NULL CHECK(billing_state IN ('reserved','charged','released')),
  period TEXT NOT NULL,
  provider_request_id TEXT,
  error_code TEXT,
  object_key TEXT NOT NULL,
  content_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  poll_token TEXT,
  poll_after INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX generation_jobs_owner_idempotency_unique ON generation_jobs(user_id,idempotency_key);
--> statement-breakpoint
CREATE INDEX generation_jobs_owner_created_idx ON generation_jobs(user_id,created_at,id);
--> statement-breakpoint
CREATE INDEX generation_jobs_owner_period_idx ON generation_jobs(user_id,period,billing_state);
--> statement-breakpoint
CREATE UNIQUE INDEX generation_jobs_object_key_unique ON generation_jobs(object_key);
--> statement-breakpoint
CREATE TRIGGER account_deletion_freezes_generations BEFORE INSERT ON generation_jobs
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'Account deletion in progress'); END;
--> statement-breakpoint
CREATE TABLE generation_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('charged','released')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX generation_reconciliations_job_idx ON generation_reconciliations(job_id);
