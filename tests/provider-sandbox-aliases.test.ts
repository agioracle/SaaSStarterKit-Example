import { describe, it, expect } from "vitest";
import { sandboxLaunchPlan } from "../scripts/run-provider-sandbox";
describe("documented provider e2e command aliases", () => {
	it.each(["stripe", "creem", "waffo"])(
		"retains all explicit sandbox gates for %s",
		(provider) => {
			expect(() => sandboxLaunchPlan(provider, {})).toThrow("SANDBOX_");
		},
	);
	it("rejects contradictory provider scope rather than overriding a configured sandbox", () => {
		expect(() =>
			sandboxLaunchPlan("stripe", { SANDBOX_PROVIDER: "creem" }),
		).toThrow("SANDBOX_PROVIDER_ALIAS_CONFLICT");
	});
	it("does not accept arbitrary executable/provider names", () => {
		expect(() => sandboxLaunchPlan("custom;anything", {})).toThrow(
			"SANDBOX_INVALID_PROVIDER",
		);
	});
});
