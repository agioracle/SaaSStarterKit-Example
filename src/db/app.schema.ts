// Application-owned records. Ownership references the authentication user table.
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth.schema";
import { sql } from "drizzle-orm";
export const userfiles = sqliteTable(
	"userfiles",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		key: text("key").notNull().unique(),
		name: text("name").notNull(),
		contentType: text("content_type").notNull(),
		size: integer("size").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("userfiles_user_idx").on(table.userId), index("userfiles_owner_cursor_idx").on(table.userId, table.createdAt, table.id)],
);
export const paymentCheckouts = sqliteTable(
	"payment_checkouts",
	{
		reference: text("reference").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		plan: text("plan").notNull(),
		createdAt: integer("created_at").notNull(),
		sessionId: text("session_id"),
		lifecycle: text("lifecycle").notNull().default("unknown"),
		recovery: text("recovery"),
		snapshot: text("snapshot"),
		revision: integer("revision").notNull().default(0),
		accessState: text("access_state").notNull().default("pending"),
		accessPaid: integer("access_paid").notNull().default(0),
		accessKind: text("access_kind").notNull().default("subscription"),
		accessPeriodEnd: integer("access_period_end"),
	},
	(table) => [
		index("payment_user_idx").on(table.userId),
		index("payment_missing_projection_idx").on(table.userId).where(sql`${table.snapshot} IS NULL`),
		index("payment_history_idx").on(table.userId, table.createdAt, table.reference),
		index("payment_entitlement_idx").on(table.userId, table.accessState, table.accessKind, table.accessPeriodEnd),
		index("payment_session_idx").on(table.provider, table.sessionId),
	],
);
export const paymentEvents = sqliteTable(
	"payment_events",
	{
		id: text("id").primaryKey(),
		provider: text("provider").notNull(),
		eventId: text("event_id").notNull(),
		checkoutReference: text("checkout_reference")
			.notNull()
			.references(() => paymentCheckouts.reference, { onDelete: "cascade" }),
		payload: text("payload").notNull(),
		occurredAt: integer("occurred_at").notNull(),
	},
	(table) => [
		index("payment_events_checkout_idx").on(
			table.provider,
			table.checkoutReference,
		),
	],
);

export const paymentReferences = sqliteTable("payment_references", {
	id: text("id").primaryKey(),
	provider: text("provider").notNull(),
	kind: text("kind").notNull(),
	value: text("value").notNull(),
	checkoutReference: text("checkout_reference").notNull().references(() => paymentCheckouts.reference, {onDelete: "cascade"}),
}, (table) => [index("payment_reference_lookup_idx").on(table.provider, table.kind, table.value)]);
export const paymentCustomers = sqliteTable("payment_customers", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, {onDelete: "cascade"}),
	provider: text("provider").notNull(),
	customerId: text("customer_id").notNull(),
});
export const paymentNamespaces = sqliteTable("payment_namespaces", {
	provider: text("provider").primaryKey(),
	mode: text("mode").notNull(),
	account: text("account").notNull(),
});
export const paymentWebhookFailures = sqliteTable("payment_webhook_failures", {
	id: text("id").primaryKey(),
	provider: text("provider").notNull(),
	eventId: text("event_id").notNull(),
	code: text("code").notNull(),
	attempts: integer("attempts").notNull().default(1),
	lastAt: integer("last_at").notNull(),
});

// Durable storage-cleanup outbox. No FK: it must survive deletion of the user.
export const accountDeletions = sqliteTable("account_deletions", {
 userId: text("user_id").primaryKey(), fileKeys: text("file_keys"), createdAt: integer("created_at").notNull(),
 attempts: integer('attempts').notNull().default(0), nextAttemptAt: integer('next_attempt_at').notNull().default(0),
 leaseId: text('lease_id'), leaseUntil: integer('lease_until').notNull().default(0), lastErrorCode:text('last_error_code'),
},table=>[index('account_deletions_due_idx').on(table.nextAttemptAt,table.leaseUntil)]);
