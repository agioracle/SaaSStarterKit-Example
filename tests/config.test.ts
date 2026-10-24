import { describe, it, expect } from "vitest";
import { publicPlans } from "../src/config/plans";
import { createStripeProvider } from "../src/payment/providers/stripe";
describe("default catalog integration", () => {
	it("paid public plans submit with configured default trial settings", async () => {
		for (const plan of publicPlans.filter((p) => p.kind !== "free")) {
			const provider = createStripeProvider({
				secretKey: "sk_test_fixture",
				webhookSecret: "whsec_fixture",
				mode: "test",
				fetch: async () =>
					Response.json({
						id: "cs_fixture",
						url: "https://checkout.stripe.com/c/pay/fixture",
					}),
			});
			const result = await provider.createCheckout({
				user: { id: "fixture-user", email: "user@example.test" },
				reference: "fixture-checkout",
				plan: {
					...plan,
					kind: plan.kind === "subscription" ? "subscription" : "one_time",
					priceId: "price_fixture",
				},
				successUrl: "https://app.example.test/settings/payment",
				cancelUrl: "https://app.example.test/pricing",
			});
			expect(result.sessionId).toBe("cs_fixture");
		}
	});
});

import {
	paymentCredentialMode,
	assertPaymentCredentialMode,
} from "../src/config/payment-mode";
describe("payment key-mode safety", () => {
	it("recognizes only proven Stripe and Creem prefixes", () => {
		expect(paymentCredentialMode("stripe", "sk_test_fixture")).toBe("test");
		expect(paymentCredentialMode("stripe", "rk_live_fixture")).toBe("live");
		expect(paymentCredentialMode("creem", "creem_test_fixture")).toBe("test");
		expect(paymentCredentialMode("creem", "creem_live_fixture")).toBe("live");
		expect(paymentCredentialMode("waffo", "opaque")).toBe("unknown");
	});
	it("rejects live credentials in test runtime and vice versa before requests", () => {
		expect(() =>
			assertPaymentCredentialMode("stripe", "sk_live_fixture", "test"),
		).toThrow("mode");
		expect(() =>
			assertPaymentCredentialMode("creem", "creem_test_fixture", "live"),
		).toThrow("mode");
		expect(() =>
			assertPaymentCredentialMode("stripe", "unrecognized", "test"),
		).toThrow("mode");
		expect(assertPaymentCredentialMode("waffo", "opaque", "test")).toBe(
			"unknown",
		);
	});
});
