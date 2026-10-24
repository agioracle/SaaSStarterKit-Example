import { z } from "zod";
import type { Bindings } from "../env";
import { websiteConfig } from "../config/website";
import { createAuth } from "../auth/index.server";
import {
	extensionOrigins,
	requireExtensionOrigin,
	verifyGoogleExtensionToken,
	extensionCors,
} from "../auth/extension";
import { HttpError, readJson } from "../lib/security";
import { rateLimit } from "./rate-limit.server";
export async function handleExtension(request: Request, env: Bindings) {
	if (!websiteConfig.auth.enabled || !websiteConfig.auth.google)
		throw new HttpError(404, "Google authentication disabled.");
	const origin = requireExtensionOrigin(
		request,
		extensionOrigins(env.EXTENSION_ORIGINS),
	);
	if (request.method === "OPTIONS")
		return extensionCors(new Response(null, { status: 204 }), origin);
	if (request.method !== "POST")
		throw new HttpError(405, "Method not allowed.");
	const clientId =
		typeof env.GOOGLE_EXTENSION_CLIENT_ID === "string"
			? env.GOOGLE_EXTENSION_CLIENT_ID
			: "";
	if (!clientId || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
		throw new HttpError(
			503,
			"Google web and extension client configuration required.",
		);
	await rateLimit(
		env.DB,
		`extension:${request.headers.get("cf-connecting-ip") || "local"}`,
		10,
		60,
	);
	const { accessToken } = z
		.object({ accessToken: z.string().min(1).max(8192) })
		.parse(await readJson(request, 10_000));
	const profile = await verifyGoogleExtensionToken(accessToken, clientId);
	// A dedicated request-scoped provider receives only the verified profile. The
	// short-lived Google access token is never forwarded into Better Auth persistence.
	const auth = createAuth(env, profile);
	const headers = new Headers({ "content-type": "application/json", origin });
	const internal = new Request(
		new URL("/api/auth/sign-in/social", String(env.APP_URL)),
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				provider: "google",
				idToken: { token: "verified-extension-profile" },
				requestSignUp: true,
			}),
		},
	);
	return extensionCors(await auth.handler(internal), origin);
}
