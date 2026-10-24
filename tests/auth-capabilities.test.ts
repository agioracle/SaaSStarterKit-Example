import { describe, expect, it } from "vitest";
import { authCapabilities } from "../src/auth/capabilities";
import { websiteConfig } from "../src/config/website";
describe("login capabilities", () => {
	it("does not render a configured-looking Google login without both runtime settings", () => {
		expect(authCapabilities({}).google).toBe(false);
		expect(
			authCapabilities({ GOOGLE_CLIENT_ID: "fixture-public-id" }).google,
		).toBe(false);
		expect(
			authCapabilities({
				GOOGLE_CLIENT_ID: "fixture-public-id",
				GOOGLE_CLIENT_SECRET: "fixture-not-a-real-key",
			}).google,
		).toBe(true);
	});
	it("respects global and individual flags while returning no configuration strings", () => {
		const env = {
			GOOGLE_CLIENT_ID: "fixture-public-id",
			GOOGLE_CLIENT_SECRET: "fixture-not-a-real-key",
		};
		expect(
			authCapabilities(env, { ...websiteConfig.auth, enable: false }),
		).toEqual({ enabled: false, google: false, credentials: false });
		expect(
			authCapabilities(env, { ...websiteConfig.auth, enableGoogleLogin: false })
				.google,
		).toBe(false);
		expect(
			Object.values(authCapabilities(env)).every(
				(value) => typeof value === "boolean",
			),
		).toBe(true);
	});
});
