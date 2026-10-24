import { websiteConfig } from "../config/website";
import { createServerFn } from "@tanstack/react-start";
export const getSession = createServerFn({ method: "GET" }).handler(
	async () => {
		if (!websiteConfig.auth.enabled) return null;
		const [{ env }, { getRequestHeaders }, { createAuth }] = await Promise.all([
			import("cloudflare:workers"),
			import("@tanstack/react-start/server"),
			import("./index.server"),
		]);
		const result = await createAuth(
			env as unknown as import("../env").Bindings,
		).api.getSession({ headers: getRequestHeaders() });
		if (
			result?.user.banned &&
			(!result.user.banExpires || result.user.banExpires > new Date())
		)
			return null;
		return result
			? {
					user: result.user,
					session: {
						id: result.session.id,
						expiresAt: result.session.expiresAt,
					},
				}
			: null;
	},
);

/** Resolve the displayed login methods from server configuration without exposing credentials. */
export const getAuthCapabilities = createServerFn({ method: "GET" }).handler(
	async () => {
		const [{ env }, { authCapabilities }] = await Promise.all([
			import("cloudflare:workers"),
			import("./capabilities"),
		]);
		return authCapabilities(env as unknown as Record<string, unknown>);
	},
);
