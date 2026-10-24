import { z } from "zod";
import type { Bindings } from "../env";
import { websiteConfig } from "../config/website";
import { readJson, json, HttpError, assertSameOrigin } from "../lib/security";
import { mailSupportAddressFromEnv, sendEmail } from "../mail/index.server";
import { rateLimit } from "./rate-limit.server";
export async function handleContact(request: Request, env: Bindings) {
	if (request.method !== "POST")
		throw new HttpError(405, "Method not allowed.");
	if (!websiteConfig.mail.enable) throw new HttpError(503, "Mail is disabled.");
	assertSameOrigin(request, String(env.APP_URL || "http://localhost:3000"));
	await rateLimit(
		env.DB,
		`contact:${request.headers.get("cf-connecting-ip") || "local"}`,
		3,
		60,
	);
	const body = z
		.object({
			name: z.string().trim().min(1).max(100),
			email: z.email(),
			message: z.string().trim().min(10).max(5000),
		})
		.parse(await readJson(request, 10_000));
	const result = await sendEmail(
		{
			to: mailSupportAddressFromEnv(env),
			replyTo: body.email,
			template: "contactMessage",
			context: body,
		},
		{ env },
	);
	return json({ accepted: result.accepted });
}
