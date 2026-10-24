import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

/**
 * Minimal durable AI reservations. No prompt, output, credential or monetary
 * balance is stored. No user FK: deleting an account must not refund global
 * capacity or erase an uncertain provider job. userKey is SHA-256 of user ID.
 * Retention must preserve unresolved rows and the documented idempotency window.
 */
export const aiUsageRequests = sqliteTable(
	"ai_usage_requests",
	{
		userKey: text("user_key").notNull(),
		requestId: text("request_id").notNull(),
		payloadHash: text("payload_hash").notNull(),
		modelKey: text("model_key").notNull(),
		day: text("day").notNull(),
		units: integer("units").notNull(),
		status: text("status", {
			enum: ["reserved", "running", "succeeded", "released", "unknown"],
		}).notNull(),
		providerJobId: text("provider_job_id"),
		providerModel: text("provider_model"),
		leaseUntil: integer("lease_until").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userKey, table.requestId] }),
		index("ai_usage_day_idx").on(table.day, table.status, table.units),
		index("ai_usage_user_day_idx").on(
			table.userKey,
			table.day,
			table.status,
			table.units,
		),
		index("ai_usage_lease_idx").on(table.status, table.leaseUntil),
		index("ai_usage_retention_idx").on(table.status, table.updatedAt),
		check("ai_usage_units_positive", sql`${table.units} > 0`),
		check(
			"ai_usage_status_valid",
			sql`${table.status} IN ('reserved', 'running', 'succeeded', 'released', 'unknown')`,
		),
	],
);
