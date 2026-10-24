/** Runtime acceptance is controlled by the server-owned providerRegistry, not this type. */
export type PaymentProviderId = "stripe" | "creem" | "waffo" | (string & {});
export type PaymentMode = "test" | "live";
export type CheckoutLifecycle =
	| "creating"
	| "open"
	| "failed"
	| "expired"
	| "completed"
	| "unknown";
export type PaymentKind = "subscription" | "one_time";
export type PaymentState =
	| "pending"
	| "active"
	| "trialing"
	| "past_due"
	| "unpaid"
	| "canceled"
	| "refunded"
	| "disputed";
export interface PaymentPlan {
	id: string;
	priceId: string;
	kind: PaymentKind;
	currency: string;
	/** Integer minor units. Only display/configuration: providers charge their configured product. */
	amount: number;
	interval?: "month" | "year";
	trialPeriodDays?: number;
	allowPromotionCodes?: boolean;
}
export interface PaymentUser {
	id: string;
	email: string;
}
export interface PaymentReferences {
	sessionId?: string;
	subscriptionId?: string;
	invoiceId?: string;
	paymentIntentId?: string;
	orderId?: string;
	customerId?: string;
	subscriptionItemId?: string;
}
export interface CheckoutRecord {
	reference: string;
	userId: string;
	provider: PaymentProviderId;
	plan: PaymentPlan;
	createdAt: number;
	sessionId?: string;
	lifecycle?: CheckoutLifecycle;
	/** Immutable request for safe provider reconciliation. Never returned in public DTOs. */
	recovery?: ProviderCheckoutInput;
}
export interface CheckoutLookup extends PaymentReferences {
	checkoutReference?: string;
}
export type PaymentEffect = "sync" | "grant" | "revoke" | "receipt" | "ignore";
/** Verified provider facts. Never construct these from browser input. Times are epoch milliseconds. */
export interface PaymentEvent {
	provider: PaymentProviderId;
	id: string;
	type: string;
	occurredAt: number;
	effect: PaymentEffect;
	lookup: CheckoutLookup;
	state?: PaymentState;
	periodEnd?: number;
	periodStart?: number;
	lifecycle?: CheckoutLifecycle;
	cancelAtPeriodEnd?: boolean;
	priceId?: string;
	planId?: string;
	plan?: PaymentPlan;
	/** Set by the service after resolving a server-created checkout. */
	checkoutReference?: string;
}
export interface PaymentSnapshot extends CheckoutRecord {
	state: PaymentState;
	paid: boolean;
	periodEnd?: number;
	cancelAtPeriodEnd: boolean;
	references: PaymentReferences;
	reconciliationRequired?: boolean;
	subscriptionEnded?: boolean;
}
/** Durable append-only facts with an atomic, rebuildable checkout projection.
 * SQL stores must commit unique event INSERT and revision-checked projection together;
 * duplicates cannot overwrite either fact or projection. No separately writable cache. */
export interface PaymentStore {
	createCheckout(checkout: CheckoutRecord): Promise<void>;
	reserveCheckout?(checkout: CheckoutRecord): Promise<void>;
	setCheckoutLifecycle?(
		provider: PaymentProviderId,
		reference: string,
		lifecycle: CheckoutLifecycle,
	): Promise<void>;
	getSnapshot?(
		provider: PaymentProviderId,
		reference: string,
	): Promise<PaymentSnapshot | null>;
	listHistory?(
		userId: string,
		options: { limit: number; cursor?: string },
	): Promise<{ items: PaymentSnapshot[]; nextCursor: string | null }>;
	getEntitlement?(userId: string, now: number): Promise<PaymentSnapshot | null>;
	hasUnresolvedSubscription?(
		userId: string,
		provider: PaymentProviderId,
	): Promise<boolean>;
	getCustomer?(
		userId: string,
		provider: PaymentProviderId,
	): Promise<string | undefined>;
	bindCustomer?(
		userId: string,
		provider: PaymentProviderId,
		customerId: string,
	): Promise<string>;
	assertNamespace?(
		provider: PaymentProviderId,
		mode: PaymentMode,
		account: string,
		deployment?: string,
	): Promise<void>;
	recordWebhookFailure?(input: {
		provider: PaymentProviderId;
		eventId: string;
		code: string;
		at: number;
	}): Promise<void>;
	resolveWebhookFailure?(
		provider: PaymentProviderId,
		eventId: string,
	): Promise<void>;
	attachCheckout(
		provider: PaymentProviderId,
		reference: string,
		sessionId: string,
	): Promise<void>;
	/** Resolve against checkout reference/session AND references in historical ledger events. */
	findCheckout(
		provider: PaymentProviderId,
		lookup: CheckoutLookup,
	): Promise<CheckoutRecord | null>;
	listCheckouts(userId: string): Promise<CheckoutRecord[]>;
	listEvents(
		provider: PaymentProviderId,
		reference: string,
	): Promise<PaymentEvent[]>;
	appendEvent(
		event: PaymentEvent & { checkoutReference: string },
	): Promise<"inserted" | "duplicate">;
}
export interface ProviderCheckoutInput {
	user: PaymentUser;
	plan: PaymentPlan;
	reference: string;
	customerId?: string;
	successUrl: string;
	cancelUrl: string;
}
export interface ProviderCheckout {
	sessionId: string;
	url: string;
	customerId?: string;
}
export interface PaymentAdapter {
	id: PaymentProviderId;
	/** Defaults to true. Shared portals such as Waffo explicitly set false. */
	requiresCustomerId?: boolean;
	/** Defaults to false. Hosted confirmations round-trip our server reference. */
	hostsPostCheckoutPage?: boolean;
	ensureCustomer?(user: PaymentUser): Promise<string>;
	reconcileCheckout?(input: {
		reference: string;
		sessionId?: string;
		recovery?: ProviderCheckoutInput;
	}): Promise<{
		lifecycle: CheckoutLifecycle;
		sessionId?: string;
		customerId?: string;
		subscriptionId?: string;
		url?: string;
	}>;
	reconcileSubscription?(subscriptionId: string): Promise<PaymentEvent>;
	createCheckout(input: ProviderCheckoutInput): Promise<ProviderCheckout>;
	createPortal(input: {
		user: PaymentUser;
		customerId?: string;
		returnUrl: string;
	}): Promise<string>;
	cancelSubscription(input: {
		subscriptionId: string;
		atPeriodEnd: boolean;
	}): Promise<void>;
	verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent>;
}
export class PaymentError extends Error {
	get status(): number | undefined {
		return this.details?.upstreamStatus;
	}
	constructor(
		public readonly code:
			| "CONFIGURATION"
			| "UNAUTHORIZED"
			| "NOT_FOUND"
			| "INVALID_INPUT"
			| "INVALID_SIGNATURE"
			| "PROVIDER_ERROR"
			| "RETRY",
		message: string,
		public readonly details?: {
			outcome?: "not_created" | "unknown";
			upstreamStatus?: number;
			eventId?: string;
		},
	) {
		super(message);
		this.name = "PaymentError";
	}
}

export interface PaymentCheckoutStatus {
	reference: string;
	provider: PaymentProviderId;
	state: PaymentState;
	paid: boolean;
	hasAccess: boolean;
	planId: string;
	periodEnd?: number;
	cancelAtPeriodEnd: boolean;
	lifecycle: CheckoutLifecycle;
	reconciliationRequired: boolean;
	canCancel: boolean;
	canManage: boolean;
	canReconcile: boolean;
}

/** Public compatibility facade inputs. References/ownership still go through the ledger service. */
export interface CreateCheckoutParams {
	user: PaymentUser;
	priceId: string;
	successUrl?: string;
	cancelUrl?: string;
}
export interface CheckoutResult extends ProviderCheckout {
	reference: string;
}
export interface CreatePortalParams {
	user: PaymentUser;
	returnUrl?: string;
	reference?: string;
}
export interface PortalResult {
	url: string;
}
export interface PaymentProvider {
	readonly requiresCustomerId?: boolean;
	readonly hostsPostCheckoutPage?: boolean;
	getProviderName(): string;
	createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;
	createCustomerPortal(params: CreatePortalParams): Promise<PortalResult>;
	handleWebhookEvent(payload: string, signature: string): Promise<void>;
}
export interface PaymentRecoveryResult extends PaymentCheckoutStatus {
	/** Freshly retrieved, owned open checkout only. Never persisted in history or ledger. */
	checkoutUrl?: string;
}

/** Backward-compatible name for the public provider contract. */
export type PaymentProviderFacade = PaymentProvider;
