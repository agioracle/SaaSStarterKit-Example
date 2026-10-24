import type { CheckoutRecord, PaymentEvent, PaymentSnapshot } from "./types";

/** Provider timestamps are not a total order. Opaque IDs are only dedupe identities. */
function latestValues<T>(
	events: readonly PaymentEvent[],
	value: (event: PaymentEvent) => T | undefined,
) {
	const present = events.filter((event) => value(event) !== undefined);
	const at = Math.max(...present.map((event) => event.occurredAt));
	const latest = present.filter((event) => event.occurredAt === at);
	const authoritative = latest.filter(
		(event) => event.type === "subscription.reconciled",
	);
	const values = (authoritative.length ? authoritative : latest).map(
		value,
	) as T[];
	return { values: [...new Set(values)], at };
}

/** Paid service coverage and subscription status are independent facts. Old invoices
 * remain in the ledger but cannot replace a later paid service window or its plan. */
export function foldPaymentEvents(
	checkout: CheckoutRecord,
	input: readonly PaymentEvent[],
): PaymentSnapshot {
	const events = input.filter(
		(event) =>
			event.provider === checkout.provider &&
			event.checkoutReference === checkout.reference,
	);
	let identityAmbiguous = false;
	const snapshot: PaymentSnapshot = {
		...checkout,
		state: "pending",
		paid: false,
		cancelAtPeriodEnd: false,
		references: { sessionId: checkout.sessionId },
		reconciliationRequired: false,
	};
	for (const key of [
		"sessionId",
		"subscriptionId",
		"invoiceId",
		"paymentIntentId",
		"orderId",
		"customerId",
		"subscriptionItemId",
	] as const) {
		const latest = latestValues(events, (event) => event.lookup[key]);
		if (latest.values.length === 1) snapshot.references[key] = latest.values[0];
		else if (
			latest.values.length > 1 &&
			["subscriptionId", "customerId", "subscriptionItemId"].includes(key)
		) {
			snapshot.reconciliationRequired = true;
			identityAmbiguous = true;
		}
	}
	const lifecycle = latestValues(events, (event) => event.lifecycle);
	if (lifecycle.values.length === 1) snapshot.lifecycle = lifecycle.values[0];
	else if (lifecycle.values.length > 1) {
		snapshot.lifecycle = "unknown";
		snapshot.reconciliationRequired = true;
	}
	const grants = events.filter((event) => event.effect === "grant");
	const price = (event: PaymentEvent) =>
		event.plan?.priceId ?? event.priceId ?? checkout.plan.priceId;
	// Service starts identify newer paid intervals even when a reset makes the new
	// interval shorter. For legacy facts lacking starts, retain the longest paid
	// window until a current provider observation can select an existing paid fact.
	const start = Math.max(...grants.map((event) => event.periodStart ?? 0));
	let sameStart = grants.filter((event) => (event.periodStart ?? 0) === start);
	// Waffo dates have day precision. An explicit applied change to a new order
	// can therefore share the old start date yet shorten its end. Only that
	// paid-authority change may supersede the old order, never a scheduled event.
	const changes = sameStart.filter(
		(event) =>
			event.provider === "waffo" && event.type === "subscription.plan_changed",
	);
	const changedAt = Math.max(...changes.map((event) => event.occurredAt));
	const changedOrders = new Set(
		changes
			.filter((event) => event.occurredAt === changedAt)
			.map((event) => event.lookup.subscriptionId),
	);
	if (changedOrders.size === 1 && !changedOrders.has(undefined)) {
		const [currentOrder] = changedOrders;
		const conflicting = sameStart.some(
			(event) =>
				event.lookup.subscriptionId !== currentOrder &&
				event.occurredAt >= changedAt,
		);
		if (conflicting) snapshot.reconciliationRequired = true;
		else
			sameStart = sameStart.filter(
				(event) => event.lookup.subscriptionId === currentOrder,
			);
	} else if (changedOrders.size > 1) snapshot.reconciliationRequired = true;
	const end = Math.max(...sameStart.map((event) => event.periodEnd ?? 0));
	let currentGrants = sameStart.filter(
		(event) => (event.periodEnd ?? 0) === end,
	);
	const observations = events.filter(
		(event) =>
			event.type === "subscription.reconciled" && event.effect === "sync",
	);
	const observationAt = Math.max(
		...observations.map((event) => event.occurredAt),
	);
	const latestObservations = observations.filter(
		(event) => event.occurredAt === observationAt,
	);
	const observedIntervals = new Set(
		latestObservations.map((event) =>
			JSON.stringify([
				event.plan?.priceId ?? event.priceId,
				event.periodStart,
				event.periodEnd,
			]),
		),
	);
	if (observedIntervals.size > 1) snapshot.reconciliationRequired = true;
	const observed =
		observedIntervals.size === 1 ? latestObservations[0] : undefined;
	if (
		observed &&
		(observed.plan?.priceId || observed.priceId) &&
		observed.periodEnd !== undefined
	) {
		const matching = grants.filter(
			(event) =>
				price(event) === price(observed) &&
				event.periodEnd === observed.periodEnd &&
				(observed.periodStart === undefined ||
					event.periodStart === undefined ||
					event.periodStart === observed.periodStart),
		);
		const newerInterval = grants.some((event) =>
			observed.periodStart !== undefined && event.periodStart !== undefined
				? event.periodStart > observed.periodStart
				: event.occurredAt > observationAt &&
					(event.periodEnd ?? 0) > (observed.periodEnd ?? 0),
		);
		if (matching.length && !newerInterval) currentGrants = matching;
		else if (
			!newerInterval &&
			currentGrants.length &&
			price(observed) !== price(currentGrants[0])
		)
			snapshot.reconciliationRequired = true;
	}
	const grantTime = Math.max(...currentGrants.map((event) => event.occurredAt));
	const plans = new Set(currentGrants.map(price));
	const grant = currentGrants[0];
	if (grant) {
		snapshot.paid = true;
		snapshot.state = grant.state ?? "active";
		snapshot.periodEnd = grant.periodEnd;
		if (plans.size > 1) {
			snapshot.reconciliationRequired = true;
			snapshot.state = "pending";
		} else if (grant.plan) snapshot.plan = grant.plan;
		else if (grant.priceId)
			snapshot.plan = { ...snapshot.plan, priceId: grant.priceId };
		snapshot.lifecycle = "completed";
	}
	const sync = events.filter(
		(event) =>
			event.effect === "sync" &&
			!(
				event.type === "invoice.payment_failed" &&
				event.periodEnd !== undefined &&
				snapshot.periodEnd !== undefined &&
				event.periodEnd < snapshot.periodEnd
			),
	);
	let state = latestValues(sync, (event) => event.state);
	// An ordinary active snapshot does not prove that an intervening failed bill was paid.
	if (
		state.values.length === 1 &&
		state.values[0] === "active" &&
		grant &&
		!sync.some(
			(event) =>
				event.type === "subscription.reconciled" &&
				event.occurredAt === state.at,
		)
	) {
		const suspended = latestValues(
			sync.filter(
				(event) => event.state !== "active" && event.occurredAt > grantTime,
			),
			(event) => event.state,
		);
		if (suspended.values.length) state = suspended;
	}
	if (state.at >= grantTime && state.values.length) {
		if (state.values.length > 1) {
			snapshot.state = "pending";
			snapshot.reconciliationRequired = true;
		} else if (state.values[0] !== "active" || snapshot.paid)
			snapshot.state = state.values[0];
	}
	if (snapshot.state === "trialing" && !snapshot.paid) {
		const trial = sync.filter(
			(event) => event.state === "trialing" && event.occurredAt === state.at,
		);
		const ends = new Set(trial.map((event) => event.periodEnd));
		if (ends.size === 1) snapshot.periodEnd = trial[0]?.periodEnd;
		else {
			snapshot.state = "pending";
			snapshot.reconciliationRequired = true;
		}
		const trialPlans = new Set(
			trial.map(
				(event) =>
					event.plan?.priceId ?? event.priceId ?? checkout.plan.priceId,
			),
		);
		if (trialPlans.size === 1 && trial[0]?.plan) snapshot.plan = trial[0].plan;
		else if (trialPlans.size > 1) {
			snapshot.state = "pending";
			snapshot.reconciliationRequired = true;
		}
	}
	const cancel = latestValues(
		events.filter(
			(event) => event.effect !== "receipt" && event.effect !== "ignore",
		),
		(event) => event.cancelAtPeriodEnd,
	);
	if (cancel.values.length === 1) snapshot.cancelAtPeriodEnd = cancel.values[0];
	else if (cancel.values.length > 1) {
		snapshot.cancelAtPeriodEnd = true;
		snapshot.reconciliationRequired = true;
	}
	// Refund/dispute/end facts remain sticky for this purchase; a late invoice is
	// never a reason to resurrect a canceled subscription or reversed purchase.
	if (identityAmbiguous || snapshot.reconciliationRequired)
		snapshot.state = "pending";
	const revocations = new Set(
		events
			.filter((event) => event.effect === "revoke")
			.map((event) => event.state ?? "canceled"),
	);
	if (revocations.size)
		snapshot.state = revocations.has("disputed")
			? "disputed"
			: revocations.has("refunded")
				? "refunded"
				: "canceled";
	snapshot.subscriptionEnded = events.some(
		(event) =>
			event.effect === "revoke" &&
			event.state === "canceled" &&
			Boolean(snapshot.references.subscriptionId) &&
			event.lookup.subscriptionId === snapshot.references.subscriptionId,
	);

	return snapshot;
}

export function isCheckoutTerminalWithoutSubscription(
	snapshot: PaymentSnapshot,
): boolean {
	return (
		(snapshot.lifecycle === "failed" || snapshot.lifecycle === "expired") &&
		!snapshot.references.subscriptionId &&
		!snapshot.paid &&
		!snapshot.reconciliationRequired
	);
}
export function hasPaymentAccess(
	snapshot: PaymentSnapshot,
	now = Date.now(),
): boolean {
	if (snapshot.reconciliationRequired) return false;
	if (snapshot.state !== "active" && snapshot.state !== "trialing")
		return false;
	if (!snapshot.paid && snapshot.state !== "trialing") return false;
	if (snapshot.plan.kind === "one_time") return snapshot.paid;
	return snapshot.periodEnd !== undefined && snapshot.periodEnd > now;
}
export function getCurrentEntitlement(
	snapshots: readonly PaymentSnapshot[],
	now = Date.now(),
): PaymentSnapshot | null {
	return (
		snapshots
			.filter((item) => hasPaymentAccess(item, now))
			.sort(
				(a, b) =>
					Number(b.plan.kind === "one_time") -
						Number(a.plan.kind === "one_time") ||
					(b.periodEnd ?? 0) - (a.periodEnd ?? 0) ||
					a.reference.localeCompare(b.reference),
			)[0] ?? null
	);
}
