import { useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { authClient } from "../../auth/client";
import { publicPlans } from "../../config/plans";
import { websiteConfig } from "../../config/website";
import { getPlanLabel } from "../../config/plan-messages";
import { getLocale, localePath } from "../../locale";
import { formatPlanAmount, visiblePricingPlans } from "../blocks/pricing";
import { Button, Notice, api } from "../ui/primitives";
import { l } from "./copy";
export function LuminaPricing() {
	const [annual, setAnnual] = useState(false);
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const { data: session } = authClient.useSession();
	return (
		<div className="container lm-pricing-page">
			<div className="lm-pricing-heading">
				<span className="lm-kicker">{l("a_little_more_room_to_create")}</span>
				<h1>
					{l("make_space_for")}
					<br />
					<em>{l("your_imagination")}</em>
				</h1>
				<p>
					{l(
						"an_example_plan_catalog_for_this_workspace_your_operator_configures_pr",
					)}
				</p>
				<div className="segmented">
					<button
						type="button"
						className={!annual ? "active" : ""}
						onClick={() => setAnnual(false)}
					>
						{l("monthly")}
					</button>
					<button
						type="button"
						className={annual ? "active" : ""}
						onClick={() => setAnnual(true)}
					>
						{l("yearly")}
					</button>
				</div>
			</div>
			{!websiteConfig.payment.enabled && (
				<Notice>
					{l(
						"paid_checkout_is_not_enabled_these_are_example_prices_not_an_active_of",
					)}
				</Notice>
			)}
			{error && <Notice kind="error">{error}</Notice>}
			<div className="pricing-grid lm-pricing-grid">
				{visiblePricingPlans(publicPlans, annual).map((plan) => (
					<section
						key={plan.id}
						className={`pricing-card ${plan.id.startsWith("pro") ? "featured" : ""}`}
					>
						{plan.id.startsWith("pro") && (
							<span className="popular-label">
								{l("a_little_more_possibility")}
							</span>
						)}
						<span className="lm-kicker">{getPlanLabel(plan.name)}</span>
						<p>{getPlanLabel(plan.description)}</p>
						<div className="price">
							<strong>
								{formatPlanAmount(plan.amount, plan.currency, getLocale())}
							</strong>
							<span>
								{plan.kind === "free"
									? l("to_get_started")
									: plan.interval === "month"
										? l("month")
										: plan.interval === "year"
											? l("year")
											: l("one_time")}
							</span>
						</div>
						<Button
							busy={busy === plan.id}
							variant={plan.id.startsWith("pro") ? "primary" : "secondary"}
							disabled={
								!!busy ||
								(plan.kind !== "free" && !websiteConfig.payment.enabled)
							}
							onClick={async () => {
								if (plan.kind === "free") {
									window.location.assign(
										localePath(session ? "/studio" : "/auth/register"),
									);
									return;
								}
								if (!session) {
									window.location.assign(
										`${localePath("/auth/login")}?redirect=${encodeURIComponent("/pricing")}`,
									);
									return;
								}
								setBusy(plan.id);
								setError("");
								try {
									const response = await api<{ url: string }>("/api/payments", {
										method: "POST",
										body: JSON.stringify({
											action: "checkout",
											planId: plan.id,
											returnUrl:
												window.location.origin +
												localePath("/settings/payment"),
										}),
									});
									window.location.assign(response.url);
								} catch (cause) {
									setError(
										cause instanceof Error
											? cause.message
											: l("checkout_could_not_be_opened"),
									);
									setBusy("");
								}
							}}
						>
							{plan.kind === "free"
								? l("start_exploring")
								: l("choose_this_plan")}
							<ArrowUpRight size={16} />
						</Button>
						<ul>
							{plan.features.map((feature) => (
								<li key={feature}>
									<Check size={15} />
									{getPlanLabel(feature)}
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
			<div className="lm-pricing-note">
				<p>
					{l(
						"example_default_policy_free_has_10_images_per_utc_month_and_30_retaine",
					)}
				</p>
				<p>
					{l(
						"payments_only_change_access_after_a_verified_provider_confirmation_pro",
					)}
				</p>
			</div>
		</div>
	);
}
