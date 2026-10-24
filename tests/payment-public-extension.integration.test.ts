import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("../src/api/runtime.server", () => ({
	stringEnv: (env: Record<string, string>) => env,
}));
import {
	handlePayments,
	handlePaymentWebhook,
} from "../src/api/payments.server";
import { providerRegistry } from "../src/payment/registry";
import { websiteConfig } from "../src/config/website";
import { groupedPlans } from "../src/config/plans";
import type { Bindings } from "../src/env";
import type { PaymentAdapter, PaymentEvent } from "../src/payment/types";

let mf: Miniflare;
let db: D1Database;
beforeAll(async () => {
	mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script:
				'export default { fetch() { return new Response("ordinary-local-fixture"); } };',
			compatibilityDate: "2026-10-01",
			d1Databases: ["DB"],
		}),
	);
	db = (await mf.getD1Database("DB")) as unknown as D1Database;
	const directory = fileURLToPath(new URL("../drizzle", import.meta.url));
	for (const migration of (await readdir(directory))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		const source = await readFile(`${directory}/${migration}`, "utf8");
		for (const statement of source
			.split("--> statement-breakpoint")
			.map((sql) => sql.trim())
			.filter(Boolean))
			await db.prepare(statement).run();
	}
	await db
		.prepare(
			"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
		)
		.bind(
			"extension-owner",
			"Fixture Owner",
			"extension@example.test",
			1,
			Date.now(),
			Date.now(),
		)
		.run();
}, 30_000);
afterAll(async () => {
	if (mf) await mf.dispose();
}, 30_000);

it("registered custom adapter drives actual checkout, webhook, billing and portal handlers over local D1", async () => {
	const previousProvider = websiteConfig.payment.provider;
	const previousEnabled = websiteConfig.payment.enable;
	const price = groupedPlans.pro.prices[0];
	const priceDescriptor = Object.getOwnPropertyDescriptor(price, "priceId");
	if (!priceDescriptor) throw new Error("Missing price fixture descriptor");
	const user = { id: "extension-owner", email: "extension@example.test" };
	const providerId = "fixture-route";
	let reference = "";
	const verified = vi.fn(
		async (raw: string, headers: Headers): Promise<PaymentEvent> => {
			// Ordinary fixture seam only. No merchant keys, signature generation or exploit replay.
			expect(raw).toBe("fixture-authoritative-paid-body");
			expect(headers.get("fixture-signature")).toBe("fixture-signature-token");
			return {
				provider: providerId,
				id: "fixture-paid-once",
				type: "subscription.paid",
				occurredAt: Date.now(),
				effect: "grant",
				state: "active",
				periodStart: Date.now() - 1000,
				periodEnd: Date.now() + 86400000,
				priceId: "fixture-configured-month",
				lookup: {
					checkoutReference: reference,
					subscriptionId: "fixture-subscription",
				},
			};
		},
	);
	const adapter: PaymentAdapter = {
		id: providerId,
		createCheckout: vi.fn(async (input) => {
			reference = input.reference;
			return {
				sessionId: "fixture-hosted-session",
				url: "https://checkout.example.test/fixture",
			};
		}),
		createPortal: vi.fn(async () => "https://portal.example.test/fixture"),
		cancelSubscription: vi.fn(async () => {}),
		verifyWebhook: verified,
	};
	const factory = vi.fn(() => adapter);
	providerRegistry[providerId] = {
		create: factory,
		credentialIdentity: (env) => env.FIXTURE_ROUTE_KEY,
		webhookSignatureHeader: "fixture-signature",
		requiresCustomerId: false,
		hostsPostCheckoutPage: true,
	};
	try {
		websiteConfig.payment.provider = providerId;
		websiteConfig.payment.enable = true;
		Object.defineProperty(price, "priceId", {
			configurable: true,
			value: "fixture-configured-month",
		});
		const env = {
			DB: db,
			APP_URL: "https://app.example.test",
			PAYMENT_MODE: "test",
			FIXTURE_ROUTE_KEY: "non-secret-offline-fixture",
		} as unknown as Bindings;
		const post = (body: object) =>
			new Request("https://app.example.test/api/payments", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://app.example.test",
				},
				body: JSON.stringify(body),
			});
		const createdResponse = await handlePayments(
			post({ action: "checkout", planId: "pro-monthly" }),
			env,
			user,
		);
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as {
			reference: string;
			url: string;
		};
		expect(created.reference).toBe(reference);
		expect(created.url).toBe("https://checkout.example.test/fixture");
		expect(factory).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "test" }),
		);
		const pending = (await (
			await handlePayments(
				new Request(
					`https://app.example.test/api/payments?reference=${reference}&provider=${providerId}`,
				),
				env,
				user,
			)
		).json()) as { paid: boolean; hasAccess: boolean };
		expect(pending).toMatchObject({ paid: false, hasAccess: false });
		const webhook = () =>
			handlePaymentWebhook(
				new Request(`https://app.example.test/api/webhooks/${providerId}`, {
					method: "POST",
					headers: { "fixture-signature": "fixture-signature-token" },
					body: "fixture-authoritative-paid-body",
				}),
				env,
				providerId,
			);
		expect((await webhook()).status).toBe(200);
		expect((await webhook()).status).toBe(200);
		expect(
			await db
				.prepare(
					"SELECT count(*) AS total FROM payment_events WHERE provider=?",
				)
				.bind(providerId)
				.first("total"),
		).toBe(1);
		const billingResponse = await handlePayments(
			new Request("https://app.example.test/api/payments"),
			env,
			user,
		);
		const billing = (await billingResponse.json()) as {
			checkouts: Array<{
				reference: string;
				paid: boolean;
				hasAccess: boolean;
			}>;
			entitlement: { provider: string; plan: { id: string } };
		};
		expect(billing.entitlement).toMatchObject({
			provider: providerId,
			plan: { id: "pro-monthly" },
		});
		expect(billing.checkouts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reference, paid: true, hasAccess: true }),
			]),
		);
		const portal = await (
			await handlePayments(
				post({ action: "portal", reference, provider: providerId }),
				env,
				user,
			)
		).json();
		expect(portal).toEqual({ url: "https://portal.example.test/fixture" });
		expect(adapter.createPortal).toHaveBeenCalledWith(
			expect.objectContaining({
				user,
				returnUrl: "https://app.example.test/settings/billing",
			}),
		);
		expect(
			await db
				.prepare("SELECT mode FROM payment_namespaces WHERE provider=?")
				.bind(providerId)
				.first("mode"),
		).toBe("test");
	} finally {
		websiteConfig.payment.provider = previousProvider;
		websiteConfig.payment.enable = previousEnabled;
		Object.defineProperty(price, "priceId", priceDescriptor);
		delete providerRegistry[providerId];
	}
});
