import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth.schema";
export const generationJobs = sqliteTable(
	"generation_jobs",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		capacityUnits: integer("capacity_units").notNull().default(4),
		capacityUserKey: text("capacity_user_key").notNull().default(""),
		model: text("model").notNull(),
		provider: text("provider").notNull(),
		prompt: text("prompt").notNull(),
		aspectRatio: text("aspect_ratio").notNull(),
		seed: integer("seed"),
		status: text("status").notNull(),
		billingState: text("billing_state").notNull(),
		period: text("period").notNull(),
		providerRequestId: text("provider_request_id"),
		errorCode: text("error_code"),
		objectKey: text("object_key").notNull(),
		contentType: text("content_type"),
		byteSize: integer("byte_size"),
		width: integer("width"),
		height: integer("height"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		pollToken: text("poll_token"),
		pollAfter: integer("poll_after").notNull().default(0),
	},
	(table) => [
		uniqueIndex("generation_jobs_owner_idempotency_unique").on(
			table.userId,
			table.idempotencyKey,
		),
		index("generation_jobs_owner_created_idx").on(
			table.userId,
			table.createdAt,
			table.id,
		),
		index("generation_jobs_owner_period_idx").on(
			table.userId,
			table.period,
			table.billingState,
		),
		uniqueIndex("generation_jobs_object_key_unique").on(table.objectKey),
	],
);
export const generationReconciliations = sqliteTable(
	"generation_reconciliations",
	{
		id: text("id").primaryKey(),
		jobId: text("job_id")
			.notNull()
			.references(() => generationJobs.id, { onDelete: "cascade" }),
		adminId: text("admin_id").notNull(),
		outcome: text("outcome").notNull(),
		reason: text("reason").notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("generation_reconciliations_job_idx").on(table.jobId)],
);

// No foreign key: account/image deletion must not reset daily safety budgets.
export const generationCapacity = sqliteTable(
	"generation_capacity",
	{
		jobId: text("job_id").primaryKey(),
		userKey: text("user_key").notNull(),
		createdAt: integer("created_at").notNull(),
		units: integer("units").notNull(),
		active: integer("active").notNull(),
	},
	(table) => [
		index("generation_capacity_day_idx").on(table.createdAt, table.units),
		index("generation_capacity_user_day_idx").on(
			table.userKey,
			table.createdAt,
		),
		index("generation_capacity_active_idx").on(table.active, table.userKey),
	],
);
