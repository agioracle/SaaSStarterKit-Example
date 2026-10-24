import { createMiddleware } from "@tanstack/react-start";
import type { Bindings } from "../env";
import { errorResponse, HttpError } from "../lib/security";
import { localePath, getLocale } from "../locale";

/** Reusable server route guard. Client beforeLoad remains a separate UX boundary. */
export async function authorizeRouteRequest(
	request: Request,
	env: Bindings,
	role: "user" | "admin" = "user",
) {
	const { requireUser, requireAdmin } = await import("../auth/index.server");
	try {
		const session = await (role === "admin" ? requireAdmin : requireUser)(
			request,
			env,
		);
		return {
			user: {
				id: session.user.id,
				name: session.user.name,
				email: session.user.email,
				image: session.user.image,
				role: session.user.role,
			},
			session: { id: session.session.id, expiresAt: session.session.expiresAt },
		};
	} catch (error) {
		if (
			error instanceof HttpError &&
			error.status === 401 &&
			["GET", "HEAD"].includes(request.method)
		) {
			const url = new URL(request.url);
			const redirect = new URLSearchParams({
				redirect: url.pathname + url.search,
			});
			return new Response(null, {
				status: 307,
				headers: {
					location: `${localePath("/auth/login", getLocale())}?${redirect}`,
					"cache-control": "private, no-store",
				},
			});
		}
		return errorResponse(error, { operation: "auth.route" });
	}
}
function routeMiddleware(role: "user" | "admin") {
	return createMiddleware().server(async ({ request, next }) => {
		const { bindings } = await import("../api/runtime.server");
		const result = await authorizeRouteRequest(request, bindings(), role);
		if (result instanceof Response) return result;
		return next({ context: result });
	});
}
/** Public documented names, consumed by the real protected application routes. */
export const authRouteMiddleware = routeMiddleware("user");
export const adminRouteMiddleware = routeMiddleware("admin");
