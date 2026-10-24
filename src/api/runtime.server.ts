import { env } from "cloudflare:workers";
import type { Bindings } from "../env";
export const bindings = () => env as unknown as Bindings;
export function stringEnv(env: Bindings): Record<string, string | undefined> {
	return Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
