import "@tanstack/react-start/server-only";
export {
	sendEmail,
	getMailProvider,
	providerRegistry,
	createMailProvider,
	sendMailFromEnv,
} from "./index.server";
export type { ProviderFactory, MailProviderContext } from "./index.server";
export type * from "./types";
