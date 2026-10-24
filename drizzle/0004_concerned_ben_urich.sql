CREATE TABLE `payment_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`customer_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment_namespaces` (
	`provider` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`account` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_references` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`checkout_reference` text NOT NULL,
	FOREIGN KEY (`checkout_reference`) REFERENCES `payment_checkouts`(`reference`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_reference_lookup_idx` ON `payment_references` (`provider`,`kind`,`value`);--> statement-breakpoint
CREATE TABLE `payment_webhook_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`code` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`last_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage_requests` (
	`user_key` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`model_key` text NOT NULL,
	`day` text NOT NULL,
	`units` integer NOT NULL,
	`status` text NOT NULL,
	`provider_job_id` text,
	`provider_model` text,
	`lease_until` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_key`, `request_id`),
	CONSTRAINT "ai_usage_units_positive" CHECK("ai_usage_requests"."units" > 0),
	CONSTRAINT "ai_usage_status_valid" CHECK("ai_usage_requests"."status" IN ('reserved', 'running', 'succeeded', 'released', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `ai_usage_day_idx` ON `ai_usage_requests` (`day`,`status`,`units`);--> statement-breakpoint
CREATE INDEX `ai_usage_user_day_idx` ON `ai_usage_requests` (`user_key`,`day`,`status`,`units`);--> statement-breakpoint
CREATE INDEX `ai_usage_lease_idx` ON `ai_usage_requests` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `ai_usage_retention_idx` ON `ai_usage_requests` (`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `account_deletions` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_deletions` ADD `next_attempt_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_deletions` ADD `lease_id` text;--> statement-breakpoint
ALTER TABLE `account_deletions` ADD `lease_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_deletions` ADD `last_error_code` text;--> statement-breakpoint
CREATE INDEX `account_deletions_due_idx` ON `account_deletions` (`next_attempt_at`,`lease_until`);--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `lifecycle` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `recovery` text;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `snapshot` text;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `access_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `access_paid` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `access_kind` text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_checkouts` ADD `access_period_end` integer;--> statement-breakpoint
CREATE INDEX `payment_history_idx` ON `payment_checkouts` (`user_id`,`created_at`,`reference`);--> statement-breakpoint
CREATE INDEX `payment_entitlement_idx` ON `payment_checkouts` (`user_id`,`access_state`,`access_kind`,`access_period_end`);--> statement-breakpoint
CREATE INDEX `rate_limit_last_request_idx` ON `rate_limit` (`last_request`);--> statement-breakpoint
CREATE INDEX `rate_limit_api_expiry_idx` ON `rate_limit` (`last_request`,`id`) WHERE "rate_limit"."key" GLOB 'api:*';