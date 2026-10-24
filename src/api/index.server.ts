import { readiness } from "./readiness.server";
import { finishAccountDeletion } from "../auth/deletion.server";
import { createAuth, requireUser } from "../auth/index.server";
import { websiteConfig } from "../config/website";
import { handleExtension } from "./extension.server";
import {
	extensionOrigins,
	requireExtensionOrigin,
	extensionCors,
} from "../auth/extension";
import { handleContact } from "./contact.server";
import { bindings } from "./runtime.server";
import { publicEnvironment } from "../env";
import {
	assertSameOrigin,
	HttpError,
	json,
	readJson,
	errorResponse,
} from "../lib/security";
import { handleFiles } from "./files.server";
import { handleGenerations } from "./generation.server";
import { listUnresolvedGenerations, reconcileGeneration } from "../generation/reconciliation.server";
import { handleNewsletter } from "./newsletter.server";
import { handlePayments, handlePaymentWebhook } from "./payments.server";
export async function handleApi(request: Request) {
	const requestId = crypto.randomUUID();
	const startedAt = Date.now();
	const route = new URL(request.url).pathname;
	const operation = route.startsWith("/api/webhooks/")
		? "payment.webhook"
		: route.startsWith("/api/auth/")
			? "auth.request"
			: route === "/api/ai"
				? "ai.request"
				: route.startsWith("/api/files")
					? "storage.request"
					: "api.request";
	try {
		const env = bindings();
		const path = new URL(request.url).pathname;
		if (path === "/api/ready") {
			const result = await readiness(env);
			const response = json(
				{ status: result.status, requestId: result.requestId },
				result.status === "ready" ? 200 : 503,
			);
			response.headers.set("X-Request-ID", result.requestId);
			return response;
		}
		if (path === "/api/health")
			return json({
				status: "ok",
				runtime: "Cloudflare Workers",
				bindings: {
					db: Boolean(env.DB),
					storage: Boolean(env.BUCKET),
					cache: Boolean(env.CACHE),
				},
			});
		if (path === "/api/contact") return await handleContact(request, env);
		if (path === "/api/extension/auth/google")
			return await handleExtension(request, env);
		if (path.startsWith("/api/webhooks/"))
			return await handlePaymentWebhook(
				request,
				env,
				path.split("/").pop() || "",
				{
					requestId,
					operation: "payment.webhook",
					durationMs: Date.now() - startedAt,
				},
			);
		if (path.startsWith("/api/auth/")) {
			if (!websiteConfig.auth.enabled)
				throw new HttpError(404, "Authentication disabled.");
			const origin = request.headers.get("origin");
			const isExtension =
				origin?.startsWith("chrome-extension:") ||
				origin?.startsWith("moz-extension:");
			if (isExtension && origin) {
				requireExtensionOrigin(
					request,
					extensionOrigins(env.EXTENSION_ORIGINS),
				);
				if (request.method === "OPTIONS")
					return extensionCors(new Response(null, { status: 204 }), origin);
			}
			let response: Response;
			try {
				response = await createAuth(env).handler(request);
			} catch (error) {
				if (path === "/api/auth/request-password-reset")
					return json({
						status: true,
						message:
							"If this email exists in our system, check your email for the reset link.",
					});
				throw error;
			}
			// Prevent account enumeration even if a configured mail transport fails for an existing account.
			if (path === "/api/auth/request-password-reset" && response.status >= 500)
				return json({
					status: true,
					message:
						"If this email exists in our system, check your email for the reset link.",
				});
			return isExtension && origin ? extensionCors(response, origin) : response;
		}
		const extensionOrigin = request.headers.get("origin");
		if (
			path === "/api/me" &&
			(extensionOrigin?.startsWith("chrome-extension:") ||
				extensionOrigin?.startsWith("moz-extension:"))
		) {
			const origin = requireExtensionOrigin(
				request,
				extensionOrigins(env.EXTENSION_ORIGINS),
			);
			if (request.method === "OPTIONS")
				return extensionCors(new Response(null, { status: 204 }), origin);
			if (
				request.method !== "GET" ||
				!request.headers.get("authorization")?.startsWith("Bearer ")
			)
				throw new HttpError(403, "Signed bearer authentication required.");
			const headers = new Headers(request.headers);
			headers.delete("cookie");
			const authenticated = await requireUser(
				new Request(request, { headers }),
				env,
			);
			return extensionCors(
				json({
					user: authenticated.user,
					session: {
						id: authenticated.session.id,
						expiresAt: authenticated.session.expiresAt,
					},
				}),
				origin,
			);
		}
		if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
			assertSameOrigin(request, publicEnvironment(env).APP_URL);
		if (path === "/api/v1/user") {
			if (!websiteConfig.auth.enabled)
				throw new HttpError(404, "Authentication disabled.");
			const key = request.headers.get("x-api-key");
			if (!key) throw new HttpError(401, "API key required.");
			const result = await createAuth(env).api.verifyApiKey({ body: { key } });
			if (!result.valid || !result.key)
				throw new HttpError(401, "Invalid API key.");
			const account = await env.DB.prepare(
				"SELECT id,name,email,banned,ban_expires FROM user WHERE id=?",
			)
				.bind(result.key.referenceId)
				.first<{
					id: string;
					name: string;
					email: string;
					banned: number;
					ban_expires: number | null;
				}>();
			if (
				!account ||
				(account.banned &&
					(!account.ban_expires || account.ban_expires > Date.now()))
			)
				throw new HttpError(403, "Account unavailable.");
			return json({ id: account.id, name: account.name, email: account.email });
		}
		const session = await requireUser(request, env);
		const user = session.user;
		if (path === "/api/admin/readiness") {
			if (user.role !== "admin")
				throw new HttpError(403, "Administrator access required.");
			return json(await readiness(env));
		}
		if (path === "/api/admin/deletion-cleanup" && request.method === "POST") {
			if (user.role !== "admin")
				throw new HttpError(403, "Administrator access required.");
			const body = (await readJson(request, 1024)) as { userId?: unknown };
			if (typeof body.userId !== "string" || body.userId.length > 128)
				throw new HttpError(400, "Invalid user ID.");
			return json({ status: await finishAccountDeletion(env, body.userId) });
		}
		if (path === "/api/me")
			return json({
				user,
				session: {
					id: session.session.id,
					expiresAt: session.session.expiresAt,
				},
			});
		if (path === "/api/files" || path.startsWith("/api/files/"))
			return await handleFiles(request, env, user.id, path.split("/")[3]);
		if (path === "/api/newsletter")
			return await handleNewsletter(request, env, user.email);
		if (path === "/api/ai") throw new HttpError(410, "The generic AI endpoint is disabled. Use the authenticated generation workflow.");
        if (path === "/api/generations" || path.startsWith("/api/generations/")) return await handleGenerations(request, env, user.id);
        if (path === "/api/admin/generations" || path.startsWith("/api/admin/generations/")) {
            if (user.role !== "admin") throw new HttpError(403, "Administrator access required.");
            if (path === "/api/admin/generations" && request.method === "GET") return json(await listUnresolvedGenerations(env, user.id));
            const match = /^\/api\/admin\/generations\/([0-9a-f-]{36})\/reconcile$/.exec(path);
            if (match && request.method === "POST") return json(await reconcileGeneration(env, user.id, match[1], await readJson(request, 5000)));
            throw new HttpError(405, "Method not allowed.");
        }
		if (path === "/api/payments")
			return await handlePayments(request, env, user);
		throw new HttpError(404, "Endpoint not found.");
	} catch (error) {
		return errorResponse(error, {
			requestId,
			operation,
			durationMs: Date.now() - startedAt,
		});
	}
}
