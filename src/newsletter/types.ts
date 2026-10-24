export interface NewsletterProviderNames {
	resend: true;
	beehiiv: true;
	mailcheap: true;
}
export type NewsletterProviderName = keyof NewsletterProviderNames;
export interface SubscribeNewsletterParams {
	email: string;
	consent: true;
	resubscribe?: boolean;
}
export interface UnsubscribeNewsletterParams {
	email: string;
}
export interface CheckSubscribeStatusParams {
	email: string;
}
export interface NewsletterProvider {
	getProviderName(): string;
	/** True means accepted, not necessarily confirmed: double-opt-in may remain pending. */
	subscribe(input: SubscribeNewsletterParams): Promise<boolean>;
	unsubscribe(input: UnsubscribeNewsletterParams): Promise<boolean>;
	checkSubscribeStatus(input: CheckSubscribeStatusParams): Promise<boolean>;
}
export type NewsletterConfig =
	| { provider: "resend"; apiKey: string }
	| { provider: "beehiiv"; apiKey: string; publicationId: string }
	| { provider: "mailcheap"; apiKey: string; newsletterId: string };
export interface NewsletterStatusCache {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options: { expirationTtl: number },
	): Promise<void>;
	delete(key: string): Promise<void>;
}
