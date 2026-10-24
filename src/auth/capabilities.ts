import { websiteConfig } from "../config/website";
interface AuthFlags {
	enable?: boolean;
	enabled?: boolean;
	enableGoogleLogin?: boolean;
	google?: boolean;
	enableCredentialLogin?: boolean;
	credentials?: boolean;
}
/** Public booleans only; this does not probe OAuth or certify its remote configuration. */
export function authCapabilities(
	env: Record<string, unknown>,
	config: AuthFlags = websiteConfig.auth,
) {
	const present = (name: string) =>
		typeof env[name] === "string" && Boolean((env[name] as string).trim());
	const enabled = config.enable ?? config.enabled ?? false;
	return {
		enabled,
		credentials:
			enabled && (config.enableCredentialLogin ?? config.credentials ?? false),
		google:
			enabled &&
			(config.enableGoogleLogin ?? config.google ?? false) &&
			present("GOOGLE_CLIENT_ID") &&
			present("GOOGLE_CLIENT_SECRET"),
	};
}
