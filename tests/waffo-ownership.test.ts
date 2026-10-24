import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createWaffoProvider } from "../src/payment/providers/waffo";
import { createPaymentService } from "../src/payment/service";
import type {
	CheckoutRecord,
	PaymentEvent,
	PaymentStore,
} from "../src/payment/types";

// Ephemeral fixture keys only. No provider credentials or external requests.
const keys = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const storeId = "STO_0123456789012345678901";
const config = {
	merchantId: "MER_0123456789012345678901",
	privateKey: keys.privateKey,
	storeId,
	mode: "test" as const,
	// Deliberately the same fixture key for both modes: mode is a separate boundary.
	webhookPublicKeys: { test: keys.publicKey, prod: keys.publicKey },
};
const checkout: CheckoutRecord = {
	reference: "victim-pending-checkout",
	provider: "waffo",
	userId: "buyer-in-this-application",
	createdAt: Date.now(),
	plan: {
		id: "lifetime",
		priceId: "PROD_0123456789012345678901",
		kind: "one_time",
		currency: "USD",
		amount: 19900,
	},
};
function payload(overrides: Record<string, unknown> = {}) {
	return {
		id: "PAY_0123456789012345678901",
		eventId: "PAY_0123456789012345678901",
		eventType: "order.completed",
		timestamp: new Date().toISOString(),
		storeId,
		mode: "test",
		data: {
			orderId: "ORD_0123456789012345678901",
			orderMerchantExternalId: checkout.reference,
			productMetadata: { priceId: checkout.plan.priceId },
		},
		...overrides,
	};
}
function signed(body: string, timestamp = Date.now()) {
	const signature = createSign("RSA-SHA256")
		.update(`${timestamp}.${body}`)
		.sign(keys.privateKey, "base64");
	return new Headers({
		"x-waffo-signature": `t=${timestamp},v1=${signature}`,
	});
}
function setup() {
	const events: PaymentEvent[] = [];
	const store = {
		createCheckout: vi.fn<PaymentStore["createCheckout"]>(),
		attachCheckout: vi.fn<PaymentStore["attachCheckout"]>(),
		findCheckout: vi.fn<PaymentStore["findCheckout"]>(async () => checkout),
		listCheckouts: vi.fn<PaymentStore["listCheckouts"]>(async () => [checkout]),
		listEvents: vi.fn<PaymentStore["listEvents"]>(async () => events),
		appendEvent: vi.fn<PaymentStore["appendEvent"]>(async (event) => {
			events.push(event);
			return "inserted";
		}),
	};
	const onPaymentRecorded = vi.fn();
	const service = createPaymentService({
		provider: createWaffoProvider(config),
		plans: [checkout.plan],
		appOrigin: "https://app.example.test",
		store,
		onPaymentRecorded,
	});
	return { events, store, onPaymentRecorded, service };
}

describe("Waffo signed store ownership boundary", () => {
	it.each([undefined, "", " \t\n"])(
		"fails configuration without a usable expected store (%j)",
		(expectedStore) => {
			expect(() =>
				createWaffoProvider({ ...config, storeId: expectedStore }),
			).toThrowError(expect.objectContaining({ code: "CONFIGURATION" }));
		},
	);
	it.each([
		{ mode: "test" as const, eventMode: "test" },
		{ mode: "live" as const, eventMode: "prod" },
	])("accepts the configured store in $mode mode", async ({ mode, eventMode }) => {
		const body = JSON.stringify(payload({ mode: eventMode }));
		const event = await createWaffoProvider({ ...config, mode }).verifyWebhook(
			body,
			signed(body),
		);
		expect(event).toMatchObject({
			effect: "grant",
			lookup: { checkoutReference: checkout.reference },
		});
	});
	it.each([
		["foreign", "STO_9999999999999999999999"],
		["omitted", undefined],
		["null", null],
		["empty", ""],
		["numeric", 123],
		["object", { id: storeId }],
		["array", [storeId]],
		["different case", storeId.toLowerCase()],
		["leading whitespace", ` ${storeId}`],
		["trailing whitespace", `${storeId} `],
	])("rejects a correctly signed %s store", async (_label, signedStore) => {
		const body = JSON.stringify(payload({ storeId: signedStore }));
		await expect(
			createWaffoProvider(config).verifyWebhook(body, signed(body)),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
	it.each([
		{ mode: "test" as const, eventMode: "prod" },
		{ mode: "live" as const, eventMode: "test" },
		{ mode: "test" as const, eventMode: undefined },
	])("rejects mode $eventMode for $mode even for the expected store", async ({ mode, eventMode }) => {
		const body = JSON.stringify(payload({ mode: eventMode }));
		await expect(
			createWaffoProvider({ ...config, mode }).verifyWebhook(body, signed(body)),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
	it("does not accept a metadata, data, or unsigned header store fallback", async () => {
		const body = JSON.stringify(
			payload({
				storeId: undefined,
				merchantId: config.merchantId,
				metadata: { storeId },
				data: {
					...payload().data,
					storeId,
					orderMetadata: { storeId },
					productMetadata: { storeId, priceId: checkout.plan.priceId },
				},
			}),
		);
		const headers = signed(body);
		headers.set("x-waffo-store-id", storeId);
		await expect(
			createWaffoProvider(config).verifyWebhook(body, headers),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
	it("rejects replacing a signed foreign store with the configured store", async () => {
		const foreign = JSON.stringify(payload({ storeId: "STO_foreign" }));
		const tampered = foreign.replace("STO_foreign", storeId);
		await expect(
			createWaffoProvider(config).verifyWebhook(tampered, signed(foreign)),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
	it.each(["order.completed", "subscription.activated", "refund.succeeded"])(
		"rejects a foreign %s before lookup, ledger writes, or notifications",
		async (eventType) => {
			const { service, store, events, onPaymentRecorded } = setup();
			const body = JSON.stringify(
				payload({ storeId: "STO_9999999999999999999999", eventType }),
			);
			await expect(service.handleWebhook(body, signed(body))).rejects.toMatchObject({
				code: "INVALID_SIGNATURE",
			});
			expect(store.findCheckout).not.toHaveBeenCalled();
			expect(store.appendEvent).not.toHaveBeenCalled();
			expect(onPaymentRecorded).not.toHaveBeenCalled();
			expect(events).toEqual([]);
			const status = await service.getCheckoutStatus(
				{ id: checkout.userId, email: "buyer@example.test" },
				checkout.reference,
			);
			expect(status).toMatchObject({ state: "pending", paid: false, hasAccess: false });
		},
	);
	it("still records a verified owned payment and grants the pending checkout", async () => {
		const { service, store, onPaymentRecorded } = setup();
		const body = JSON.stringify(payload());
		await expect(service.handleWebhook(body, signed(body))).resolves.toEqual({
			status: "inserted",
		});
		expect(store.appendEvent).toHaveBeenCalledTimes(1);
		expect(onPaymentRecorded).toHaveBeenCalledTimes(1);
		const status = await service.getCheckoutStatus(
			{ id: checkout.userId, email: "buyer@example.test" },
			checkout.reference,
		);
		expect(status).toMatchObject({ state: "active", paid: true, hasAccess: true });
	});
});

describe("Waffo portal compatibility with required store ownership", () => {
	const input = {
		user: { id: checkout.userId, email: "buyer@example.test" },
		returnUrl: "https://app.example.test/settings/billing",
	};
	it("keeps Magic Link as the default without issuing a customer session", async () => {
		const transport = vi.fn<typeof fetch>();
		const provider = createWaffoProvider({ ...config, fetch: transport });
		await expect(provider.createPortal(input)).resolves.toBe(
			"https://pancake.waffo.ai/consumer/portal/login",
		);
		expect(transport).not.toHaveBeenCalled();
	});
	it("uses only the configured store and authenticated buyer for explicit SSO", async () => {
		const transport = vi.fn<typeof fetch>(async () =>
			Response.json({
				data: {
					portalUrl: `https://pancake.waffo.ai/consumer/portal/store/${storeId}`,
					token: "test-only-portal-token",
					expiresAt: "2030-01-01T00:00:00.000Z",
				},
			}),
		);
		const provider = createWaffoProvider({
			...config,
			portalSso: true,
			fetch: transport,
		});
		await expect(provider.createPortal(input)).resolves.toBe(
			`https://pancake.waffo.ai/consumer/portal/store/${storeId}#token=test-only-portal-token`,
		);
		expect(transport).toHaveBeenCalledTimes(1);
		const [url, init] = transport.mock.calls[0];
		expect(String(url)).toBe("https://api.waffo.ai/v1/actions/auth/issue-session-token");
		expect(JSON.parse(init?.body as string)).toEqual({
			storeId,
			buyerIdentity: input.user.id,
			purpose: "portal",
		});
		expect(new Headers(init?.headers).get("x-signature")).toBeTruthy();
	});
});
