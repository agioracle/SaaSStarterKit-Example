/** Offline schema inspection only. Never import this configuration into the Worker. */
import { betterAuth } from "better-auth/minimal";
import { admin, bearer } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

// No database connection, runtime credentials, mail hooks, or request handlers.
// Keep schema-affecting plugins/options aligned with src/auth/index.server.ts.
export const auth = betterAuth({
	appName: "Offline auth schema inspection",
	baseURL: "http://localhost:3000",
	secret: "test-only-schema-inspection-never-use-for-authentication",
	user: {
		additionalFields: {
			newsletterConsent: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: true,
			},
		},
	},
	emailAndPassword: { enabled: true },
	rateLimit: { enabled: true, storage: "database" },
	plugins: [
		bearer({ requireSignature: true }),
		admin({ defaultRole: "user", adminRoles: ["admin"] }),
		apiKey({
			defaultPrefix: "ek_",
			requireName: true,
			enableMetadata: false,
			rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 60 },
		}),
	],
});
