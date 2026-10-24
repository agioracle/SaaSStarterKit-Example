import { createAuthClient } from "better-auth/react";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";
export const authClient = createAuthClient({
	plugins: [
		adminClient(),
		apiKeyClient(),
		inferAdditionalFields({
			user: { newsletterConsent: { type: "boolean", required: false } },
		}),
	],
});
export async function retrySession<T>(
	read: () => Promise<T | null>,
	attempts = 3,
): Promise<T | null> {
	for (let i = 0; i < attempts; i++) {
		const session = await read();
		if (session) return session;
		if (i < attempts - 1)
			await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return null;
}
