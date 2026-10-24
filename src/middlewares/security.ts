import { isSensitivePath } from "../components/analytics/privacy";
import { createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
/** Applied before route/CSRF handlers, including auth email callbacks. */
export const securityHeaders = createMiddleware().server(
	async ({ next, request }) => {
		const path = new URL(request.url).pathname;
		if (isSensitivePath(path) || path.startsWith("/api/"))
			setResponseHeader("Cache-Control", "private, no-store");
		else
			// SSR includes a session-aware shell. Do not enable shared HTML caching
			// until an anonymous-only rendering/cache-key boundary is established.
			setResponseHeader("Cache-Control", "no-store");
		setResponseHeader("Referrer-Policy", "no-referrer");
		setResponseHeader("X-Content-Type-Options", "nosniff");
		setResponseHeader("X-Frame-Options", "DENY");
		return next();
	},
);
