import { getLocale } from "../locale";
import { m } from "../locale/paraglide/messages";

/** Localize starter catalog copy; custom merchant copy falls back unchanged until explicitly translated. */
export function getPlanLabel(text: string) {
	const labels: Record<string, () => string> = {
		Free: m.config_plan_messages_free,
		Pro: m.config_plan_messages_pro,
		"Pro annual": m.config_plan_messages_pro_annual,
		Lifetime: m.config_plan_messages_lifetime,
		"Explore the starter": m.config_plan_messages_explore_the_starter,
		"For products ready to grow":
			m.config_plan_messages_for_products_ready_to_grow,
		"Build for the long run": m.config_plan_messages_build_for_the_long_run,
		"One payment. Lasting access.":
			m.config_plan_messages_one_payment_lasting_access,
		"Your account": m.config_plan_messages_your_account,
		"Developer-friendly foundation":
			m.config_plan_messages_developer_friendly_foundation,
		"Community resources": m.config_plan_messages_community_resources,
		"Everything in Free": m.config_plan_messages_everything_in_free,
		"Pro entitlement": m.config_plan_messages_pro_entitlement,
		"Monthly billing": m.config_plan_messages_monthly_billing,
		"Everything in Pro": m.config_plan_messages_everything_in_pro,
		"Annual billing": m.config_plan_messages_annual_billing,
		"Two months included": m.config_plan_messages_two_months_included,
		"Lifetime entitlement": m.config_plan_messages_lifetime_entitlement,
		"No recurring subscription":
			m.config_plan_messages_no_recurring_subscription,
	};
	const product: Record<string, string> = {
		"Find your first spark": "找到第一点灵感",
		"More room for your ideas": "给创意更多空间",
		"Private image library": "私有图片作品库",
		"Original image downloads": "原图下载",
		"Reusable prompts": "复用提示词",
		"Paid workspace allowance": "付费工作区额度",
	};
	return getLocale().startsWith("zh") && product[text]
		? product[text]
		: labels[text]?.() || text;
}
