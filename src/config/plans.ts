// Optional access also supports standalone React Email previews outside Vite.
/** Public catalogue: amounts are integer minor units; provider ids are public, never credentials. */
export interface PlanDefinition {
	id: string;
	groupId?: string;
	name: string;
	description: string;
	amount: number;
	currency: string;
	kind: "free" | "subscription" | "one_time";
	interval?: "month" | "year";
	trialPeriodDays?: number;
	allowPromotionCodes?: boolean;
	disabled?: boolean;
	popular?: boolean;
	isFree?: boolean;
	isLifetime?: boolean;
	limits?: readonly string[];
	features: readonly string[];
}
export interface Price {
	type: "subscription" | "one_time";
	priceId: string;
	amount: number;
	currency: string;
	interval?: "month" | "year";
	trialPeriodDays?: number;
	allowPromotionCode?: boolean;
	disabled?: boolean;
	/** EdgeKit stable ledger/checkout identity. Never rename after accepting payments. */
	catalogId?: string;
	/** Optional per-price presentation overrides used by the flat legacy UI. */
	name?: string;
	description?: string;
	features?: readonly string[];
}
export interface PricePlan {
	id: string;
	name?: string;
	description?: string;
	features?: readonly string[];
	limits?: readonly string[];
	prices: Price[];
	isFree: boolean;
	isLifetime: boolean;
	popular?: boolean;
	disabled?: boolean;
}
/** Provider product/price identifiers are public, not credentials. Vite replaces these at build time. */
export const publicPriceIds: Record<
	string,
	Record<string, string | undefined>
> = {
	stripe: {
		"pro-monthly": import.meta.env?.VITE_STRIPE_PRICE_PRO_MONTHLY,
		"pro-yearly": import.meta.env?.VITE_STRIPE_PRICE_PRO_YEARLY,
		lifetime: import.meta.env?.VITE_STRIPE_PRICE_LIFETIME,
	},
	creem: {
		"pro-monthly": import.meta.env?.VITE_CREEM_PRODUCT_PRO_MONTHLY,
		"pro-yearly": import.meta.env?.VITE_CREEM_PRODUCT_PRO_YEARLY,
		lifetime: import.meta.env?.VITE_CREEM_PRODUCT_LIFETIME,
	},
	waffo: {
		"pro-monthly": import.meta.env?.VITE_WAFFO_PRODUCT_PRO_MONTHLY,
		"pro-yearly": import.meta.env?.VITE_WAFFO_PRODUCT_PRO_YEARLY,
		lifetime: import.meta.env?.VITE_WAFFO_PRODUCT_LIFETIME,
	},
};

function configuredPriceId(catalogId: string) {
	return (
		publicPriceIds[import.meta.env?.VITE_PAYMENT_PROVIDER || ""]?.[catalogId] ??
		""
	);
}
/** Canonical three-plan structure. Legacy records below are views, not a second catalogue. */
export const groupedPlans: Record<string, PricePlan> = {
	free: {
		id: "free",
		name: "Free",
		description: "Find your first spark",
		features: [
			"Private image library",
			"Original image downloads",
			"Reusable prompts",
		],
		limits: [],
		prices: [],
		isFree: true,
		isLifetime: false,
	},
	pro: {
		id: "pro",
		name: "Pro",
		description: "More room for your ideas",
		popular: true,
		features: ["Private image library", "Paid workspace allowance"],
		limits: [],
		isFree: false,
		isLifetime: false,
		prices: [
			{
				catalogId: "pro-monthly",
				type: "subscription",
				get priceId() {
					return configuredPriceId(this.catalogId ?? "");
				},
				amount: 1900,
				currency: "USD",
				interval: "month",
				allowPromotionCode: true,
				features: ["Private image library", "Paid workspace allowance", "Monthly billing"],
			},
			{
				catalogId: "pro-yearly",
				type: "subscription",
				get priceId() {
					return configuredPriceId(this.catalogId ?? "");
				},
				amount: 19000,
				currency: "USD",
				interval: "year",
				allowPromotionCode: true,
				name: "Pro annual",
				description: "Build for the long run",
				features: [
					"Everything in Pro",
					"Annual billing",
					"Two months included",
				],
			},
		],
	},
	lifetime: {
		id: "lifetime",
		name: "Lifetime",
		description: "One payment. Lasting access.",
		features: [
			"Everything in Pro",
			"Lifetime entitlement",
			"No recurring subscription",
		],
		limits: [],
		isFree: false,
		isLifetime: true,
		prices: [
			{
				catalogId: "lifetime",
				type: "one_time",
				get priceId() {
					return configuredPriceId(this.catalogId ?? "");
				},
				amount: 29900,
				currency: "USD",
				allowPromotionCode: true,
			},
		],
	},
};
/** Shared stable checkout identity for both the public view and server price lookup.
 * Ordinary month/year public price objects need no EdgeKit-specific field. */
export function paymentCatalogId(
	plan: Pick<PricePlan, "id">,
	price?: Price,
): string {
	return (
		price?.catalogId ??
		(price?.type === "subscription"
			? `${plan.id}-${price.interval === "year" ? "yearly" : "monthly"}`
			: plan.id)
	);
}
/** Never select the first of multiple prices sharing a derived ledger identity.
 * Historical prices keep their existing ID; assign a distinct catalogId to a new replacement. */
export function assertUniquePaymentCatalogIds(
	plans: Record<string, PricePlan>,
): void {
	const ids = new Set<string>();
	for (const plan of Object.values(plans)) {
		for (const price of plan.isFree ? [undefined] : plan.prices) {
			const id = paymentCatalogId(plan, price);
			if (!id || ids.has(id))
				throw new Error(
					`Payment catalog identity '${id}' is empty or duplicated. Keep historical IDs unchanged and give each additional price a distinct catalogId.`,
				);
			ids.add(id);
		}
	}
}
export function flattenPricePlans(
	plans: Record<string, PricePlan>,
): PlanDefinition[] {
	assertUniquePaymentCatalogIds(plans);
	return Object.values(plans).flatMap((plan) => {
		const prices: Array<Price | undefined> = plan.isFree
			? [undefined]
			: plan.prices;
		return prices.map(
			(price): PlanDefinition => ({
				get id() {
					return paymentCatalogId(plan, price);
				},
				get groupId() {
					return plan.id;
				},
				get name() {
					return price?.name ?? plan.name ?? plan.id;
				},
				get description() {
					return price?.description ?? plan.description ?? "";
				},
				get amount() {
					return price?.amount ?? 0;
				},
				set amount(value) {
					if (price) price.amount = value;
					else if (value !== 0)
						throw new Error("A free plan cannot have a payment amount.");
				},
				get currency() {
					return price?.currency ?? "USD";
				},
				get kind() {
					return plan.isFree ? "free" : (price?.type ?? "one_time");
				},
				get interval() {
					return price?.interval;
				},
				get trialPeriodDays() {
					return price?.trialPeriodDays;
				},
				get allowPromotionCodes() {
					return price?.allowPromotionCode;
				},
				get disabled() {
					return plan.disabled || price?.disabled || false;
				},
				set disabled(value) {
					if (price) price.disabled = value;
					else plan.disabled = value;
				},
				get popular() {
					return plan.popular ?? false;
				},
				get isFree() {
					return plan.isFree;
				},
				get isLifetime() {
					return plan.isLifetime;
				},
				get features() {
					return price?.features ?? plan.features ?? [];
				},
				get limits() {
					return plan.limits ?? [];
				},
			}),
		);
	});
}
// Keep disabled historical entries for reconciliation. Filtering belongs to checkout/presentation.
export const publicPlans: readonly PlanDefinition[] =
	flattenPricePlans(groupedPlans);
