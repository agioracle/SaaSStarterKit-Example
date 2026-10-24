ALTER TABLE generation_jobs ADD capacity_units INTEGER NOT NULL DEFAULT 4 CHECK(capacity_units > 0);
--> statement-breakpoint
ALTER TABLE generation_jobs ADD capacity_user_key TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE generation_capacity (
 job_id TEXT PRIMARY KEY NOT NULL,
 user_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 units INTEGER NOT NULL CHECK(units > 0),
 active INTEGER NOT NULL CHECK(active IN (0,1))
);
--> statement-breakpoint
INSERT INTO generation_capacity(job_id,user_key,created_at,units,active)
 SELECT id,'',created_at,4,CASE WHEN billing_state='reserved' THEN 1 ELSE 0 END FROM generation_jobs;
--> statement-breakpoint
CREATE INDEX generation_capacity_day_idx ON generation_capacity(created_at,units);
--> statement-breakpoint
CREATE INDEX generation_capacity_user_day_idx ON generation_capacity(user_key,created_at);
--> statement-breakpoint
CREATE INDEX generation_capacity_active_idx ON generation_capacity(active,user_key);
--> statement-breakpoint
CREATE TRIGGER generation_capacity_insert AFTER INSERT ON generation_jobs BEGIN
 INSERT INTO generation_capacity(job_id,user_key,created_at,units,active) VALUES(NEW.id,NEW.capacity_user_key,NEW.created_at,NEW.capacity_units,1);
END;
--> statement-breakpoint
CREATE TRIGGER generation_capacity_settle AFTER UPDATE OF billing_state ON generation_jobs BEGIN
 UPDATE generation_capacity SET active=CASE WHEN NEW.billing_state='reserved' THEN 1 ELSE 0 END WHERE job_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER generation_capacity_delete BEFORE DELETE ON generation_jobs BEGIN
 SELECT CASE WHEN OLD.billing_state='reserved' THEN RAISE(ABORT,'Unresolved generation requires reconciliation') END;
 UPDATE generation_capacity SET active=0 WHERE job_id=OLD.id;
END;
