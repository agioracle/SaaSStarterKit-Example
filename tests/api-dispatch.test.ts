import { describe, it, expect, vi } from "vitest";
import { HttpError } from "../src/lib/security";
import { ServiceError } from "../src/ai/http.server";
vi.mock("../src/api/runtime.server", () => ({
	bindings: () => ({ APP_URL: "https://app.example", APP_ENV: "test" }),
}));
const fixture = vi.hoisted(() => ({ role: "user" }));
vi.mock("../src/auth/deletion.server", () => ({
	finishAccountDeletion: vi.fn(async () => "complete"),
}));
vi.mock("../src/auth/index.server", () => ({
	createAuth: vi.fn(),
	requireUser: async () => ({
		user: {
			id: "user-1",
			email: "u@example.invalid",
			get role() {
				return fixture.role;
			},
		},
		session: { id: "s-1" },
	}),
}));
vi.mock("../src/api/generation.server", () => ({ handleGenerations: vi.fn() }));
import { handleApi } from "../src/api/index.server";
import { handleGenerations } from "../src/api/generation.server";
const request = () =>
	new Request("https://app.example/api/generations", {
		method: "POST",
		headers: { origin: "https://app.example" },
	});
describe("async dispatcher error boundary", () => {
	it("catches async validation/ownership failures", async () => {
		vi.mocked(handleGenerations).mockRejectedValueOnce(
			new HttpError(413, "Request too large."),
		);
		const result = await handleApi(request());
		expect(result.status).toBe(413);
		expect(await result.json()).toMatchObject({
			error: "Request too large.",
			code: "HTTP_ERROR",
			requestId: expect.any(String),
		});
	});
	it("preserves safe402 guidance without exposing provider detail", async () => {
		vi.mocked(handleGenerations).mockRejectedValueOnce(
			new ServiceError("UPSTREAM", "private-provider-key-placeholder", 402),
		);
		const result = await handleApi(request());
		expect(result.status).toBe(402);
		const text = await result.text();
		expect(text).toContain("Provider credits");
		expect(text).not.toContain("private-provider");
	});
	it("redacts upstream and unexpected errors", async () => {
		vi.mocked(handleGenerations).mockRejectedValueOnce(
			new ServiceError("UPSTREAM", "secret upstream request"),
		);
		const result = await handleApi(request());
		expect(result.status).toBe(502);
		expect(await result.json()).toMatchObject({
			error: "Service unavailable or not configured.",
		});
	});
});

import { finishAccountDeletion } from "../src/auth/deletion.server";
describe("cleanup API authorization and retry result", () => {
	const cleanup = () =>
		new Request("https://app.example/api/admin/deletion-cleanup", {
			method: "POST",
			headers: {
				origin: "https://app.example",
				"content-type": "application/json",
			},
			body: JSON.stringify({ userId: "deleted-fixture" }),
		});
	it("does not run cleanup for ordinary members", async () => {
		fixture.role = "user";
		const response = await handleApi(cleanup());
		expect(response.status).toBe(403);
		expect(finishAccountDeletion).not.toHaveBeenCalled();
	});
	it("returns the actual cleanup status for an administrator", async () => {
		fixture.role = "admin";
		try {
			const response = await handleApi(cleanup());
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status: "complete" });
			expect(finishAccountDeletion).toHaveBeenCalledTimes(1);
		} finally {
			fixture.role = "user";
		}
	});
});
