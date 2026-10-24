CREATE TABLE `account_deletions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`file_keys` text,
	`created_at` integer NOT NULL
);

--> statement-breakpoint
CREATE TRIGGER account_deletion_freezes_checkouts BEFORE INSERT ON payment_checkouts
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'Account deletion in progress'); END;
--> statement-breakpoint
CREATE TRIGGER account_deletion_freezes_uploads BEFORE INSERT ON userfiles
WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'Account deletion in progress'); END;
