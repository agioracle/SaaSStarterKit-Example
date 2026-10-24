import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/security";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const state = vi.hoisted(() => ({ authenticated: true, role: "user" }));
vi.mock("../src/api/runtime.server", () => ({
	bindings: () => ({ APP_URL: "https://app.example", APP_ENV: "test" }),
}));
vi.mock("../src/auth/index.server", () => ({
	createAuth: vi.fn(),
	requireUser: async () => {
		if (!state.authenticated) throw new HttpError(401, "Sign in required.");
		return {
			user: { id: "owner", email: "owner@example.test", role: state.role },
			session: { id: "session" },
		};
	},
}));
vi.mock("../src/auth/deletion.server", () => ({
	finishAccountDeletion: vi.fn(),
}));
vi.mock("../src/api/generation.server", () => ({
	handleGenerations: vi.fn(async () => Response.json({ ok: true })),
}));
vi.mock("../src/generation/reconciliation.server", () => ({
	listUnresolvedGenerations: vi.fn(async () => ({ jobs: [], limit: 100 })),
	reconcileGeneration: vi.fn(async () => ({ job: { id: "fixture" } })),
}));
import { handleApi } from "../src/api/index.server";
import { handleGenerations } from "../src/api/generation.server";
import {
	listUnresolvedGenerations,
	reconcileGeneration,
} from "../src/generation/reconciliation.server";
const id = "11111111-1111-4111-8111-111111111111";
const path = `/api/admin/generations/${id}/reconcile`;
function request(url: string, method = "GET", origin = "https://app.example") {
	return new Request(`https://app.example${url}`, {
		method,
		headers: { origin, "Content-Type": "application/json" },
		...(method === "POST"
			? {
					body: JSON.stringify({
						outcome: "released",
						providerInspectionConfirmed: true,
						reason: "Provider history was inspected and confirms failure.",
					}),
				}
			: {}),
	});
}
describe("Lumina independent authenticated dispatch contract", () => {
	beforeEach(() => {
		state.authenticated = true;
		state.role = "user";
		vi.clearAllMocks();
	});
	it("does not reach generation handler without a session", async () => {
		state.authenticated = false;
		expect((await handleApi(request("/api/generations"))).status).toBe(401);
		expect(handleGenerations).not.toHaveBeenCalled();
	});
	it("keeps generic AI endpoint disabled rather than bypassing generation quota", async () => {
		expect((await handleApi(request("/api/ai", "POST"))).status).toBe(410);
		expect(handleGenerations).not.toHaveBeenCalled();
	});
	it("does not list or reconcile another account through a normal member", async () => {
		expect((await handleApi(request("/api/admin/generations"))).status).toBe(
			403,
		);
		expect((await handleApi(request(path, "POST"))).status).toBe(403);
		expect(listUnresolvedGenerations).not.toHaveBeenCalled();
		expect(reconcileGeneration).not.toHaveBeenCalled();
	});
	it("requires the application origin even for an administrator", async () => {
		state.role = "admin";
		expect(
			(await handleApi(request(path, "POST", "https://different.example")))
				.status,
		).toBe(403);
		expect(reconcileGeneration).not.toHaveBeenCalled();
	});
	it("passes current admin identity and exact job id to reconciliation", async () => {
		state.role = "admin";
		expect((await handleApi(request(path, "POST"))).status).toBe(200);
		expect(reconcileGeneration).toHaveBeenCalledWith(
			expect.anything(),
			"owner",
			id,
			expect.objectContaining({
				outcome: "released",
				providerInspectionConfirmed: true,
			}),
		);
	});
	it("does not reconcile on GET or DELETE", async () => {
		state.role = "admin";
		expect((await handleApi(request(path))).status).toBe(405);
		expect((await handleApi(request(path, "DELETE"))).status).toBe(405);
		expect(reconcileGeneration).not.toHaveBeenCalled();
	});
});
