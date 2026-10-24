import "@tanstack/react-start/server-only";
export {
	providerRegistry,
	createNewsletterProvider,
	createConfiguredNewsletterProvider,
	withNewsletterStatusCache,
} from "./index.server";
export type {
	ProviderFactory,
	NewsletterProviderContext,
} from "./index.server";
export type * from "./types";
