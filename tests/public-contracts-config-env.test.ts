import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("public payment configuration environment", () => {
	it.each([undefined, "", "none", "INVALID_PROVIDER", "space provider"])(
		"does not enable payments for %s",
		async (value) => {
			vi.stubEnv("VITE_PAYMENT_PROVIDER", value);
			vi.resetModules();
			const { websiteConfig } = await import("../src/config/website");
			expect(websiteConfig.payment.enable).toBe(false);
			expect(websiteConfig.payment.enabled).toBe(false);
			if (value === "none") expect(websiteConfig.payment.provider).toBe("");
		},
	);
	it.each(["stripe", "creem", "waffo", "custom-pay"])(
		"accepts configured provider slug %s, pending server registry validation",
		async (value) => {
			vi.stubEnv("VITE_PAYMENT_PROVIDER", value);
			vi.resetModules();
			const { websiteConfig } = await import("../src/config/website");
			expect(websiteConfig.payment.enable).toBe(true);
			expect(websiteConfig.payment.enabled).toBe(true);
			expect(websiteConfig.payment.provider).toBe(value);
		},
	);
});
