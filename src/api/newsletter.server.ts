import { z } from "zod";
import { createConfiguredNewsletterProvider } from "../newsletter/index.server";
import { websiteConfig } from "../config/website";
import type { Bindings } from "../env";
import { HttpError, json, readJson } from "../lib/security";
export async function handleNewsletter(
	request: Request,
	env: Bindings,
	email: string,
) {
	if (!websiteConfig.newsletter.enabled)
		throw new HttpError(404, "Newsletter disabled.");
	const provider = createConfiguredNewsletterProvider(env);
	if (request.method === "GET")
		return json({ subscribed: await provider.checkSubscribeStatus({ email }) });
	if (request.method === "POST") {
		const body = z
			.object({ consent: z.literal(true), resubscribe: z.boolean().optional() })
			.parse(await readJson(request));
		const accepted = await provider.subscribe({
			email,
			consent: true,
			resubscribe: body.resubscribe,
		});
		return json({
			accepted,
			subscribed: await provider.checkSubscribeStatus({ email }),
		});
	}
	if (request.method === "DELETE") {
		const accepted = await provider.unsubscribe({ email });
		return json({
			accepted,
			subscribed: await provider.checkSubscribeStatus({ email }),
		});
	}
	throw new HttpError(405, "Method not allowed.");
}
