import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { localeMiddleware } from "./locale/middleware";
import { securityHeaders } from "./middlewares/security";
export const startInstance = createStart(() => ({
	requestMiddleware: [
		securityHeaders,
		createCsrfMiddleware({
			filter: (context) => context.handlerType === "serverFn",
		}),
		localeMiddleware,
	],
}));
