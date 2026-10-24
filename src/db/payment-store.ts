import { foldPaymentEvents } from "../payment/entitlements";
import {
	PaymentError,
	type PaymentStore,
	type CheckoutRecord,
	type PaymentEvent,
	type PaymentProviderId,
	type PaymentSnapshot,
	type CheckoutLifecycle,
	type PaymentMode,
} from "../payment/types";
interface Row {
	reference: string;
	user_id: string;
	provider: PaymentProviderId;
	plan: string;
	created_at: number;
	session_id: string | null;
	lifecycle: CheckoutLifecycle;
	recovery: string | null;
	snapshot: string | null;
	revision: number;
}
function parseCheckout(row: Row): CheckoutRecord {
	return {
		reference: row.reference,
		userId: row.user_id,
		provider: row.provider,
		plan: JSON.parse(row.plan),
		createdAt: row.created_at,
		...(row.session_id ? { sessionId: row.session_id } : {}),
		lifecycle: row.lifecycle,
		...(row.recovery ? { recovery: JSON.parse(row.recovery) } : {}),
	};
}
function parseSnapshot(row: Row): PaymentSnapshot {
	if (!row.snapshot)
		throw new PaymentError(
			"CONFIGURATION",
			"Payment projection backfill required",
		);
	const value = JSON.parse(row.snapshot) as PaymentSnapshot;
	return {
		...value,
		lifecycle: row.lifecycle,
		sessionId: row.session_id ?? undefined,
		references: {
			...value.references,
			...(row.session_id ? { sessionId: row.session_id } : {}),
		},
	};
}
export async function checkPaymentNamespace(
	db: D1Database,
	provider: PaymentProviderId,
	mode: PaymentMode,
	account: string,
	deployment = "default",
): Promise<void> {
	await checkPaymentDeployment(db, mode, deployment);
	const row = await db
		.prepare("SELECT mode,account FROM payment_namespaces WHERE provider=?")
		.bind(provider)
		.first<{ mode: string; account: string }>();
	if (!row || row.mode !== mode || row.account !== account)
		throw new PaymentError(
			"CONFIGURATION",
			"Payment namespace missing or mismatched; use isolated resources or explicit reviewed adoption",
		);
}
export async function checkPaymentDeployment(
	db: D1Database,
	mode: PaymentMode,
	deployment: string,
): Promise<void> {
	const row = await db
		.prepare(
			"SELECT mode,account FROM payment_namespaces WHERE provider='__deployment__'",
		)
		.first<{ mode: string; account: string }>();
	if (!row || row.mode !== mode || row.account !== deployment)
		throw new PaymentError(
			"CONFIGURATION",
			"Payment deployment namespace missing or mismatched",
		);
}
const referenceKinds = [
	"sessionId",
	"subscriptionId",
	"invoiceId",
	"paymentIntentId",
	"orderId",
] as const;
export function createD1PaymentStore(db: D1Database): PaymentStore {
	const store: PaymentStore = {
		async createCheckout(row) {
			const snapshot = foldPaymentEvents(row, []);
			await db
				.prepare(
					"INSERT INTO payment_checkouts(reference,user_id,provider,plan,created_at,lifecycle,recovery,snapshot,access_kind) VALUES(?,?,?,?,?,?,?,?,?)",
				)
				.bind(
					row.reference,
					row.userId,
					row.provider,
					JSON.stringify(row.plan),
					row.createdAt,
					row.lifecycle ?? "unknown",
					row.recovery ? JSON.stringify(row.recovery) : null,
					JSON.stringify(snapshot),
					row.plan.kind,
				)
				.run();
		},
		async reserveCheckout(row) {
			if (row.plan.kind !== "subscription") return store.createCheckout(row);
			const snapshot = foldPaymentEvents(row, []);
			const result = await db
				.prepare(
					"INSERT INTO payment_checkouts(reference,user_id,provider,plan,created_at,lifecycle,recovery,snapshot,access_kind) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_checkouts WHERE user_id=? AND access_kind='subscription' AND access_state!='canceled' AND COALESCE(json_extract(snapshot,'$.subscriptionEnded'),0)=0 AND lifecycle NOT IN ('failed','expired'))",
				)
				.bind(
					row.reference,
					row.userId,
					row.provider,
					JSON.stringify(row.plan),
					row.createdAt,
					row.lifecycle ?? "unknown",
					row.recovery ? JSON.stringify(row.recovery) : null,
					JSON.stringify(snapshot),
					row.plan.kind,
					row.userId,
				)
				.run();
			if (!result.meta.changes)
				throw new PaymentError(
					"INVALID_INPUT",
					"Resolve the existing subscription or checkout before starting another",
				);
		},

		async attachCheckout(provider, reference, sessionId) {
			await db.batch([
				db
					.prepare(
						"UPDATE payment_checkouts SET session_id=?,lifecycle=CASE WHEN lifecycle IN ('creating','unknown') THEN 'open' ELSE lifecycle END,revision=revision+1 WHERE provider=? AND reference=?",
					)
					.bind(sessionId, provider, reference),
				db
					.prepare(
						"INSERT OR IGNORE INTO payment_references(id,provider,kind,value,checkout_reference) SELECT ?,?,'sessionId',?,reference FROM payment_checkouts WHERE provider=? AND reference=?",
					)
					.bind(
						JSON.stringify([provider, "sessionId", sessionId, reference]),
						provider,
						sessionId,
						provider,
						reference,
					),
			]);
		},
		async setCheckoutLifecycle(provider, reference, lifecycle) {
			// A completion/verified expiration cannot be overwritten by a transport catch.
			await db
				.prepare(
					"UPDATE payment_checkouts SET lifecycle=?,revision=revision+1 WHERE provider=? AND reference=? AND lifecycle NOT IN ('completed','expired')",
				)
				.bind(lifecycle, provider, reference)
				.run();
		},
		async findCheckout(provider, lookup) {
			const statements: D1PreparedStatement[] = [];
			if (lookup.checkoutReference)
				statements.push(
					db
						.prepare(
							"SELECT * FROM payment_checkouts WHERE provider=? AND reference=?",
						)
						.bind(provider, lookup.checkoutReference),
				);
			for (const kind of referenceKinds) {
				const value = lookup[kind];
				if (!value) continue;
				// Each branch is a precise indexed point lookup, never a provider-wide OR/JSON scan.
				if (kind === "sessionId")
					statements.push(
						db
							.prepare(
								"SELECT * FROM payment_checkouts WHERE provider=? AND session_id=? LIMIT 2",
							)
							.bind(provider, value),
					);
				statements.push(
					db
						.prepare(
							"SELECT c.* FROM payment_references r JOIN payment_checkouts c ON c.reference=r.checkout_reference WHERE r.provider=? AND r.kind=? AND r.value=? LIMIT 2",
						)
						.bind(provider, kind, value),
				);
			}
			if (!statements.length) return null;
			const results = await db.batch<Row>(statements);
			const records = new Map(
				results
					.flatMap((result) => result.results)
					.map((row) => [row.reference, row]),
			);
			if (records.size > 1)
				throw new PaymentError("RETRY", "Ambiguous payment references");
			const row = [...records.values()][0];
			return row ? parseCheckout(row) : null;
		},
		async listCheckouts(userId) {
			const result = await db
				.prepare(
					"SELECT * FROM payment_checkouts WHERE user_id=? ORDER BY created_at DESC,reference DESC",
				)
				.bind(userId)
				.all<Row>();
			return result.results.map(parseCheckout);
		},
		async getSnapshot(provider, reference) {
			const row = await db
				.prepare(
					"SELECT * FROM payment_checkouts WHERE provider=? AND reference=?",
				)
				.bind(provider, reference)
				.first<Row>();
			return row ? parseSnapshot(row) : null;
		},
		async listHistory(userId, options) {
			const limit = Math.min(50, Math.max(1, options.limit));
			let cursor: [number, string] | undefined;
			if (options.cursor) {
				try {
					cursor = JSON.parse(atob(options.cursor)) as [number, string];
					if (
						!Array.isArray(cursor) ||
						cursor.length !== 2 ||
						!Number.isSafeInteger(cursor[0]) ||
						typeof cursor[1] !== "string" ||
						cursor[1].length > 256
					)
						throw Error();
				} catch {
					throw new PaymentError(
						"INVALID_INPUT",
						"Invalid payment history cursor",
					);
				}
			}
			const result = await db
				.prepare(
					`SELECT * FROM payment_checkouts WHERE user_id=? ${cursor ? "AND (created_at,reference)<(?,?)" : ""} ORDER BY created_at DESC,reference DESC LIMIT ?`,
				)
				.bind(userId, ...(cursor ?? []), limit + 1)
				.all<Row>();
			const rows = result.results.slice(0, limit);
			const last = rows.at(-1);
			return {
				items: rows.map(parseSnapshot),
				nextCursor:
					result.results.length > limit && last
						? btoa(JSON.stringify([last.created_at, last.reference]))
						: null,
			};
		},
		async getEntitlement(userId, now) {
			// A missing legacy projection is not absence of entitlement. Fail explicitly until backfilled.
			const results = await db.batch<Row>([
				db
					.prepare(
						"SELECT * FROM payment_checkouts WHERE user_id=? AND snapshot IS NULL LIMIT 1",
					)
					.bind(userId),
				db
					.prepare(
						"SELECT * FROM payment_checkouts WHERE user_id=? AND access_state IN ('active','trialing') AND (access_paid=1 OR access_state='trialing') AND ((access_kind='one_time' AND access_paid=1) OR access_period_end>?) ORDER BY (access_kind='one_time') DESC,access_period_end DESC,reference ASC LIMIT 1",
					)
					.bind(userId, now),
			]);
			if (results[0].results.length)
				throw new PaymentError(
					"CONFIGURATION",
					"Payment projection backfill required",
				);
			const row = results[1].results[0];
			return row ? parseSnapshot(row) : null;
		},
		async listEvents(provider, reference) {
			const result = await db
				.prepare(
					"SELECT payload FROM payment_events WHERE provider=? AND checkout_reference=? ORDER BY occurred_at ASC,id ASC",
				)
				.bind(provider, reference)
				.all<{ payload: string }>();
			return result.results.map(
				(row) => JSON.parse(row.payload) as PaymentEvent,
			);
		},
		async appendEvent(event) {
			for (let attempt = 0; attempt < 12; attempt++) {
				const row = await db
					.prepare(
						"SELECT * FROM payment_checkouts WHERE provider=? AND reference=?",
					)
					.bind(event.provider, event.checkoutReference)
					.first<Row>();
				if (!row) throw new PaymentError("RETRY", "Missing payment checkout");
				const events = await store.listEvents(
					event.provider,
					event.checkoutReference,
				);
				if (events.some((previous) => previous.id === event.id))
					return "duplicate";
				const projected = foldPaymentEvents(parseCheckout(row), [
					...events,
					event,
				]);
				const statements = [
					db
						.prepare(
							"INSERT OR IGNORE INTO payment_events(id,provider,event_id,checkout_reference,payload,occurred_at) SELECT ?,?,?,?,?,? FROM payment_checkouts WHERE reference=? AND provider=? AND revision=?",
						)
						.bind(
							`${event.provider}:${event.id}`,
							event.provider,
							event.id,
							event.checkoutReference,
							JSON.stringify(event),
							event.occurredAt,
							event.checkoutReference,
							event.provider,
							row.revision,
						),
					db
						.prepare(
							"UPDATE payment_checkouts SET snapshot=?,lifecycle=?,revision=revision+1,access_state=?,access_paid=?,access_kind=?,access_period_end=? WHERE reference=? AND provider=? AND revision=? AND changes()>0",
						)
						.bind(
							JSON.stringify(projected),
							projected.lifecycle ?? row.lifecycle,
							projected.state,
							Number(projected.paid),
							projected.plan.kind,
							projected.periodEnd ?? null,
							event.checkoutReference,
							event.provider,
							row.revision,
						),
				];
				// References come from the persisted first event, not a duplicate's replacement payload.
				for (const kind of referenceKinds) {
					statements.push(
						db
							.prepare(
								`INSERT OR IGNORE INTO payment_references(id,provider,kind,value,checkout_reference) SELECT json_array(provider,?,json_extract(payload,'$.lookup.${kind}'),checkout_reference),provider,?,json_extract(payload,'$.lookup.${kind}'),checkout_reference FROM payment_events WHERE id=? AND json_extract(payload,'$.lookup.${kind}') IS NOT NULL`,
							)
							.bind(kind, kind, `${event.provider}:${event.id}`),
					);
				}
				const result = await db.batch(statements);
				if (result[0].meta.changes) return "inserted";
			}
			throw new PaymentError(
				"RETRY",
				"Payment projection contention; retry delivery",
			);
		},
		async hasUnresolvedSubscription(userId, _provider) {
			return Boolean(
				await db
					.prepare(
						"SELECT 1 FROM payment_checkouts WHERE user_id=? AND access_kind='subscription' AND access_state!='canceled' AND COALESCE(json_extract(snapshot,'$.subscriptionEnded'),0)=0 AND lifecycle NOT IN ('failed','expired') LIMIT 1",
					)
					.bind(userId)
					.first(),
			);
		},
		async getCustomer(userId, provider) {
			const row = await db
				.prepare("SELECT customer_id FROM payment_customers WHERE id=?")
				.bind(JSON.stringify([userId, provider]))
				.first<{ customer_id: string }>();
			if (row) return row.customer_id;
			const legacy = await db
				.prepare(
					"SELECT json_extract(snapshot,'$.references.customerId') AS customer_id FROM payment_checkouts WHERE user_id=? AND provider=? AND json_extract(snapshot,'$.references.customerId') IS NOT NULL ORDER BY created_at DESC,reference DESC LIMIT 1",
				)
				.bind(userId, provider)
				.first<{ customer_id: string }>();
			return legacy?.customer_id;
		},
		async bindCustomer(userId, provider, customerId) {
			await db
				.prepare(
					"INSERT OR IGNORE INTO payment_customers(id,user_id,provider,customer_id) VALUES(?,?,?,?)",
				)
				.bind(JSON.stringify([userId, provider]), userId, provider, customerId)
				.run();
			return (await store.getCustomer?.(userId, provider)) ?? customerId;
		},
		async assertNamespace(provider, mode, account, deployment = "default") {
			await db
				.prepare(
					"INSERT OR IGNORE INTO payment_namespaces(provider,mode,account) SELECT '__deployment__',?,? WHERE NOT EXISTS(SELECT 1 FROM payment_checkouts LIMIT 1)",
				)
				.bind(mode, deployment)
				.run();
			await checkPaymentDeployment(db, mode, deployment);
			// First-use claim is allowed only on an empty provider namespace. Existing ledgers
			// require an explicit, reviewed adoption; a flag flip never silently rebrands them.
			await db
				.prepare(
					"INSERT OR IGNORE INTO payment_namespaces(provider,mode,account) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_checkouts WHERE provider=? LIMIT 1)",
				)
				.bind(provider, mode, account, provider)
				.run();
			await checkPaymentNamespace(db, provider, mode, account, deployment);
		},
		async recordWebhookFailure(input) {
			await db
				.prepare(
					"INSERT INTO payment_webhook_failures(id,provider,event_id,code,last_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,last_at=excluded.last_at,attempts=attempts+1",
				)
				.bind(
					`${input.provider}:${input.eventId}`,
					input.provider,
					input.eventId,
					input.code,
					input.at,
				)
				.run();
		},
		async resolveWebhookFailure(provider, eventId) {
			await db
				.prepare("DELETE FROM payment_webhook_failures WHERE id=?")
				.bind(`${provider}:${eventId}`)
				.run();
		},
	};
	return store;
}

/** Upgrade/repair hook: bounded to one explicitly selected checkout. Never changes payment facts. */
export async function rebuildPaymentProjection(
	db: D1Database,
	provider: PaymentProviderId,
	reference: string,
): Promise<void> {
	const store = createD1PaymentStore(db);
	for (let attempt = 0; attempt < 12; attempt++) {
		const row = await db
			.prepare(
				"SELECT * FROM payment_checkouts WHERE provider=? AND reference=?",
			)
			.bind(provider, reference)
			.first<Row>();
		if (!row) throw new PaymentError("NOT_FOUND", "Checkout not found");
		const projected = foldPaymentEvents(
			parseCheckout(row),
			await store.listEvents(provider, reference),
		);
		const update = db
			.prepare(
				"UPDATE payment_checkouts SET snapshot=?,lifecycle=?,access_state=?,access_paid=?,access_kind=?,access_period_end=?,revision=revision+1 WHERE reference=? AND provider=? AND revision=?",
			)
			.bind(
				JSON.stringify(projected),
				projected.lifecycle ?? row.lifecycle,
				projected.state,
				Number(projected.paid),
				projected.plan.kind,
				projected.periodEnd ?? null,
				reference,
				provider,
				row.revision,
			);
		const statements = [update];
		for (const kind of referenceKinds)
			statements.push(
				db
					.prepare(
						`INSERT OR IGNORE INTO payment_references(id,provider,kind,value,checkout_reference) SELECT json_array(provider,?,json_extract(payload,'$.lookup.${kind}'),checkout_reference),provider,?,json_extract(payload,'$.lookup.${kind}'),checkout_reference FROM payment_events WHERE provider=? AND checkout_reference=? AND json_extract(payload,'$.lookup.${kind}') IS NOT NULL`,
					)
					.bind(kind, kind, provider, reference),
			);
		if (row.session_id)
			statements.push(
				db
					.prepare(
						"INSERT OR IGNORE INTO payment_references(id,provider,kind,value,checkout_reference) VALUES(?,?,'sessionId',?,?)",
					)
					.bind(
						JSON.stringify([provider, "sessionId", row.session_id, reference]),
						provider,
						row.session_id,
						reference,
					),
			);
		const results = await db.batch(statements);
		const result = results[0];
		if (result.meta.changes) return;
	}
	throw new PaymentError("RETRY", "Payment projection contention");
}

/** Two checkouts per invocation stays below the Free D1 statement budget in the ordinary path.
 * Repeat until remaining=false. No cursor can accidentally skip an interrupted checkout. */
export async function rebuildPaymentProjectionBatch(db: D1Database, limit = 2) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 2)
		throw new PaymentError(
			"INVALID_INPUT",
			"Projection rebuild limit must be 1 or 2",
		);
	const result = await db
		.prepare(
			"SELECT provider,reference FROM payment_checkouts WHERE snapshot IS NULL ORDER BY reference LIMIT ?",
		)
		.bind(limit)
		.all<{ provider: PaymentProviderId; reference: string }>();
	for (const row of result.results)
		await rebuildPaymentProjection(db, row.provider, row.reference);
	const remaining = Boolean(
		await db
			.prepare("SELECT 1 FROM payment_checkouts WHERE snapshot IS NULL LIMIT 1")
			.first(),
	);
	return { rebuilt: result.results.length, remaining };
}
