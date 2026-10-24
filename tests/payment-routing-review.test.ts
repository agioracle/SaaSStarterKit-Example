import { describe, expect, it, vi } from "vitest";
vi.mock("../src/api/runtime.server", () => ({
	stringEnv: (env: Record<string, string>) => env,
}));
import { groupedPlans, flattenPricePlans } from "../src/config/plans";
import {
	paymentPriceId,
	paymentRuntime,
	resolveOwnedPayment,
} from "../src/api/payments.server";
import { websiteConfig } from "../src/config/website";
import type { Bindings } from "../src/env";
import type { CheckoutRecord, PaymentStore } from "../src/payment/types";
const row: CheckoutRecord = {
	reference: "historical-checkout",
	provider: "stripe",
	userId: "owner",
	sessionId: "session-history",
	createdAt: 1,
	plan: {
		id: "pro",
		priceId: "old-price",
		kind: "subscription",
		amount: 990,
		currency: "USD",
	},
};
function store(rows: CheckoutRecord[]): PaymentStore {
	return {
		createCheckout: async () => {},
		attachCheckout: async () => {},
		listCheckouts: async () => rows,
		listEvents: async () => [],
		appendEvent: async () => "inserted",
		findCheckout: async (provider, lookup) =>
			rows.find(
				(item) =>
					item.provider === provider &&
					(item.reference === lookup.checkoutReference ||
						item.sessionId === lookup.sessionId),
			) ?? null,
	};
}
describe("historical payment return routing", () => {
	it("resolves an old provider checkout or session without relying on today's provider", async () => {
		expect(
			await resolveOwnedPayment(store([row]), "owner", row.reference),
		).toEqual(row);
		expect(
			await resolveOwnedPayment(store([row]), "owner", "session-history"),
		).toEqual(row);
	});
	it("requires an explicit provider for colliding owned session aliases", async () => {
		const history = store([
			row,
			{ ...row, provider: "creem", reference: "another-checkout" },
		]);
		await expect(
			resolveOwnedPayment(history, "owner", "session-history"),
		).rejects.toMatchObject({ status: 400 });
		expect(
			(await resolveOwnedPayment(history, "owner", "session-history", "stripe"))
				.reference,
		).toBe(row.reference);
	});
	it("does not resolve another user's history", async () => {
		await expect(
			resolveOwnedPayment(store([row]), "other", row.reference),
		).rejects.toMatchObject({ status: 404 });
	});
});

it("uses explicit grouped price configuration only for the active provider", () => {
	const price = groupedPlans.pro.prices.find(
		(candidate) => candidate.catalogId === "pro-monthly",
	);
	if (!price) throw new Error("Missing grouped price fixture");
	const original = Object.getOwnPropertyDescriptor(price, "priceId");
	if (!original) throw new Error("Missing price getter");
	try {
		Object.defineProperty(price, "priceId", {
			configurable: true,
			value: "grouped-custom-price",
		});
		expect(
			paymentPriceId("fixture-pay", "pro-monthly", {}, "fixture-pay"),
		).toBe("grouped-custom-price");
		expect(
			paymentPriceId(
				"stripe",
				"pro-monthly",
				{ STRIPE_PRO_MONTHLY_PRICE_ID: "legacy-price" },
				"fixture-pay",
			),
		).toBe("legacy-price");
	} finally {
		Object.defineProperty(price, "priceId", original);
	}
});

it("actual runtime consumes documented month/year price objects with no catalogId", () => {
	const prices = groupedPlans.pro.prices;
	const originals = prices.map((price) => ({
		price,
		catalog: Object.getOwnPropertyDescriptor(price, "catalogId"),
		id: Object.getOwnPropertyDescriptor(price, "priceId"),
	}));
	const provider = websiteConfig.payment.provider;
	try {
		websiteConfig.payment.provider = "stripe";
		for (const price of prices) {
			delete price.catalogId;
			Object.defineProperty(price, "priceId", {
				configurable: true,
				value: `public-${price.interval}`,
			});
		}
		const runtime = paymentRuntime({
			DB: {},
			PAYMENT_MODE: "test",
			STRIPE_SECRET_KEY: "sk_test_fixture",
			STRIPE_WEBHOOK_SECRET: "whsec_fixture",
		} as unknown as Bindings);
		expect(
			runtime.plans.find((plan) => plan.id === "pro-monthly")?.priceId,
		).toBe("public-month");
		expect(
			runtime.plans.find((plan) => plan.id === "pro-yearly")?.priceId,
		).toBe("public-year");
	} finally {
		websiteConfig.payment.provider = provider;
		for (const original of originals) {
			if (original.catalog)
				Object.defineProperty(original.price, "catalogId", original.catalog);
			if (original.id)
				Object.defineProperty(original.price, "priceId", original.id);
		}
	}
});

it("rejects ambiguous derived identities rather than silently choosing the first monthly price", () => {
	const existing = groupedPlans.pro.prices[0];
	const replacement = {
		type: "subscription" as const,
		interval: "month" as const,
		priceId: "next-monthly",
		amount: 2900,
		currency: "USD",
	};
	const plan = {
		id: "pro",
		isFree: false,
		isLifetime: false,
		prices: [existing, replacement],
	};
	expect(() => flattenPricePlans({ pro: plan })).toThrow("distinct catalogId");
	groupedPlans.pro.prices.push(replacement);
	try {
		expect(() => paymentPriceId("stripe", "pro-monthly", {}, "stripe")).toThrow(
			"distinct catalogId",
		);
	} finally {
		groupedPlans.pro.prices.pop();
	}
	const unambiguous = flattenPricePlans({
		pro: {
			...plan,
			prices: [existing, { ...replacement, catalogId: "pro-monthly-v2" }],
		},
	});
	expect(unambiguous.map((value) => value.id)).toEqual([
		"pro-monthly",
		"pro-monthly-v2",
	]);
});
