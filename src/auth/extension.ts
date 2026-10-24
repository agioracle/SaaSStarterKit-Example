import { HttpError } from "../lib/security";
export interface ExtensionProfile {
	sub: string;
	email: string;
	email_verified: true;
	name: string;
	picture?: string;
}
export function extensionOrigins(value: unknown): string[] {
	if (typeof value !== "string" || !value.trim()) return [];
	return value.split(",").map((origin) => {
		const item = origin.trim();
		if (
			!/^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/.test(
				item,
			)
		)
			throw new HttpError(
				503,
				"Invalid extension origin configuration. Exact extension IDs are required.",
			);
		return item;
	});
}
export function requireExtensionOrigin(
	request: Request,
	allowed: readonly string[],
) {
	const origin = request.headers.get("origin");
	if (!origin || !allowed.includes(origin))
		throw new HttpError(403, "Extension origin not allowed.");
	return origin;
}
export function assertExtensionAudience(
	tokenInfo: Record<string, unknown>,
	clientId: string,
) {
	if (!clientId)
		throw new HttpError(503, "Extension Google client ID is not configured.");
	const aud = tokenInfo.aud ?? tokenInfo.audience;
	const issued = tokenInfo.azp ?? tokenInfo.issued_to;
	const expires = Number(tokenInfo.expires_in);
	if (
		aud !== clientId ||
		(issued !== undefined && issued !== clientId) ||
		!Number.isFinite(expires) ||
		expires <= 0
	)
		throw new HttpError(
			401,
			"Google access token audience or expiry is invalid.",
		);
}
/** The Google access token is sent only to Google, then discarded. No token is logged or stored. */
export async function verifyGoogleExtensionToken(
	accessToken: string,
	clientId: string,
	transport: typeof fetch = fetch,
): Promise<ExtensionProfile> {
	if (!clientId)
		throw new HttpError(503, "Extension Google client ID is not configured.");
	if (!accessToken || accessToken.length > 8192)
		throw new HttpError(400, "Invalid Google access token.");
	const infoResponse = await transport(
		"https://oauth2.googleapis.com/tokeninfo",
		{
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
				authorization: `Bearer ${accessToken}`,
			},
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!infoResponse.ok)
		throw new HttpError(401, "Google access token could not be verified.");
	const info = (await infoResponse.json()) as Record<string, unknown>;
	assertExtensionAudience(info, clientId);
	const profileResponse = await transport(
		"https://openidconnect.googleapis.com/v1/userinfo",
		{
			headers: { authorization: `Bearer ${accessToken}` },
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!profileResponse.ok)
		throw new HttpError(401, "Google profile could not be verified.");
	const data = (await profileResponse.json()) as Record<string, unknown>;
	if (
		typeof data.sub !== "string" ||
		typeof data.email !== "string" ||
		data.email_verified !== true ||
		(info.sub && info.sub !== data.sub)
	)
		throw new HttpError(401, "Verified Google email is required.");
	return {
		sub: data.sub,
		email: data.email,
		email_verified: true,
		name: typeof data.name === "string" ? data.name : data.email,
		picture: typeof data.picture === "string" ? data.picture : undefined,
	};
}
export function extensionCors(response: Response, origin: string) {
	const headers = new Headers(response.headers);
	headers.set("access-control-allow-origin", origin);
	headers.set("vary", "Origin");
	headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
	headers.set("access-control-allow-headers", "Content-Type, Authorization");
	headers.set("access-control-expose-headers", "set-auth-token");
	headers.set("cache-control", "no-store");
	return new Response(response.body, { status: response.status, headers });
}
