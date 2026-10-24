import { Modal } from '../ui/modal';
import { m } from "../../locale/paraglide/messages";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Route as AppRoute } from "../../routes/_app";
import { invalidateBilling, queryKeys } from "../../lib/query-keys";
import { getPlanLabel } from "../../config/plan-messages";
import type {
	PaymentCheckoutStatus,
	PaymentProviderId,
	PaymentRecoveryResult,
} from "../../payment/types";
import { ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react";
import { localePath } from "../../locale";
import {
	Button,
	Card,
	Empty,
	Loading,
	Notice,
	SectionTitle,
	api,
	errorMessage,
	formatDate,
	useResource,
} from "../ui/primitives";
import { publicPlans } from "../../config/plans";
type Checkout = PaymentCheckoutStatus;
interface Billing {
	checkouts: Checkout[];
	entitlement: { plan: { id: string }; provider: PaymentProviderId } | null;
	nextCursor: string | null;
	plans: Array<{ id: string; available: boolean }>;
}
export function BillingPage() {
	const { session } = AppRoute.useRouteContext();
	const queryClient = useQueryClient();
	const [cursor, setCursor] = useState("");
	const [previous, setPrevious] = useState<string[]>([]);
	const billing = useResource<Billing>(
		`/api/payments?limit=20&cursor=${encodeURIComponent(cursor)}`,
		queryKeys.billingHistory(session.user.id, cursor),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [cancel, setCancel] = useState<Checkout | null>(null);
	const [resume, setResume] = useState<{ key: string; url: string } | null>(
		null,
	);
	async function openPortal(item: Checkout) {
		setBusy(true);
		setError("");
		try {
			const result = await api<{ url: string }>("/api/payments", {
				method: "POST",
				body: JSON.stringify({
					action: "portal",
					provider: item.provider,
					reference: item.reference,
					returnUrl: window.location.origin + localePath("/settings/billing"),
				}),
			});
			window.location.assign(result.url);
		} catch (error) {
			setError(errorMessage(error));
			setBusy(false);
		}
	}
	async function reconcile(item: Checkout) {
		setResume(null);
		setBusy(true);
		setError("");
		try {
			const result = await api<PaymentRecoveryResult>("/api/payments", {
				method: "POST",
				body: JSON.stringify({
					action: "reconcile",
					provider: item.provider,
					reference: item.reference,
				}),
			});
			if (
				result.reference !== item.reference ||
				result.provider !== item.provider
			)
				throw new Error(m.settings_billing_reference_mismatch());
			if (result.checkoutUrl)
				setResume({
					key: `${item.provider}:${item.reference}`,
					url: result.checkoutUrl,
				});
			await invalidateBilling(queryClient, session.user.id);
		} catch (error) {
			setError(errorMessage(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<SectionTitle
				title={m.settings_billing_billing()}
				description={m.settings_billing_manage_your_plan_payment_method_and_subscription()}
			/>
			{error && <Notice kind="error">{error}</Notice>}
			{billing.loading ? (
				<Loading />
			) : billing.error ? (
				<Card>
					<Notice kind="error">{billing.error}</Notice>
					<Button variant="secondary" onClick={billing.reload}>
						{m.settings_billing_try_again()}
					</Button>
				</Card>
			) : (
				<>
					<Card title={m.settings_billing_your_plan()}>
						<div className="row between">
							<div>
								<span className="eyebrow">
									{m.settings_billing_current_access()}
								</span>
								<h2>
									{billing.data?.entitlement
										? getPlanLabel(
												publicPlans.find(
													(plan) =>
														plan.id === billing.data?.entitlement?.plan.id,
												)?.name || billing.data.entitlement.plan.id,
											)
										: m.settings_billing_free()}
								</h2>
								<p>
									{m.settings_billing_entitlements_are_updated_only_after_a_verified()}
								</p>
							</div>
							<a href={localePath("/pricing")} className="button primary">
								{m.settings_billing_explore_plans()}
								<ArrowUpRight size={16} />
							</a>
						</div>
					</Card>
					<Card title={m.settings_billing_payment_history()}>
						{!billing.data?.checkouts.length ? (
							<Empty title={m.settings_billing_no_payments_yet()}>
								{m.settings_billing_your_completed_and_pending_checkouts_will_appear()}
							</Empty>
						) : (
							<div className="table-scroll">
								<table>
									<thead>
										<tr>
											<th>{m.settings_billing_plan()}</th>
											<th>{m.settings_billing_status()}</th>
											<th>{m.settings_billing_period_ends()}</th>
											<th>{m.settings_billing_actions()}</th>
										</tr>
									</thead>
									<tbody>
										{billing.data.checkouts.map((item) => (
											<tr key={`${item.provider}:${item.reference}`}>
												<td>
													{getPlanLabel(
														publicPlans.find((plan) => plan.id === item.planId)
															?.name || item.planId,
													)}
													<small className="table-caption">
														{item.provider} · {item.reference.slice(0, 16)}
													</small>
												</td>
												<td>
													<span
														className={`badge ${item.hasAccess ? "success" : ""}`}
													>
														{paymentStateLabel(
															item.state === "pending"
																? item.lifecycle
																: item.state,
														)}
													</span>
													{item.cancelAtPeriodEnd && (
														<small className="table-caption">
															{m.settings_billing_cancels_at_period_end()}
														</small>
													)}
												</td>
												<td>
													{item.periodEnd ? formatDate(item.periodEnd) : "—"}
												</td>
												<td>
													<div className="row">
														{item.canCancel && (
															<Button
																variant="secondary"
																disabled={busy}
																onClick={() => {
																	setError("");
																	setCancel(item);
																}}
															>
																{m.settings_billing_cancel_renewal()}
															</Button>
														)}
														{item.canManage && (
															<Button
																variant="secondary"
																busy={busy}
																onClick={() => void openPortal(item)}
															>
																{m.settings_billing_open_billing_portal()}
															</Button>
														)}
														{item.canReconcile && (
															<Button
																variant="secondary"
																busy={busy}
																onClick={() => void reconcile(item)}
															>
																{m.settings_billing_reconcile()}
															</Button>
														)}
														{resume?.key ===
															`${item.provider}:${item.reference}` &&
															item.lifecycle === "open" &&
															item.state === "pending" &&
															!item.paid &&
															!item.reconciliationRequired && (
																<Button
																	disabled={busy}
																	onClick={() =>
																		window.location.assign(resume.url)
																	}
																>
																	{m.payment_continue_checkout()}
																</Button>
															)}
														<a
															href={`${localePath("/settings/payment")}?reference=${encodeURIComponent(item.reference)}&provider=${item.provider}`}
														>
															{m.settings_billing_check_status()}
														</a>
													</div>
													{item.reconciliationRequired &&
														!item.canReconcile && (
															<small className="table-caption">
																{m.settings_billing_support_required()}
															</small>
														)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						<nav
							className="pagination"
							aria-label={m.settings_billing_history_pages()}
						>
							<span>
								{m.settings_files_page({ value1: previous.length + 1 })}
							</span>
							<div className="row">
								<Button
									variant="secondary"
									disabled={!previous.length || billing.loading || busy}
									onClick={() => {
										setCursor(previous[previous.length - 1] || "");
										setPrevious((values) => values.slice(0, -1));
									}}
								>
									{m.settings_files_previous()}
								</Button>
								<Button
									variant="secondary"
									disabled={
										!billing.data?.nextCursor || billing.loading || busy
									}
									onClick={() => {
										setPrevious((values) => [...values, cursor]);
										setCursor(billing.data?.nextCursor || "");
									}}
								>
									{m.settings_files_next()}
								</Button>
							</div>
						</nav>
					</Card>
				</>
			)}
			{cancel && (
				<Modal
					error={error}
					title={m.settings_billing_cancel_automatic_renewal()}
					onClose={() => setCancel(null)}
				>
					<div className="stack">
						<p>
							{m.settings_billing_your_access_remains_active_until_the_paid()}
						</p>
						<Button
							variant="danger"
							busy={busy}
							onClick={async () => {
								setBusy(true);
								setError("");
								try {
									await api("/api/payments", {
										method: "POST",
										body: JSON.stringify({
											action: "cancel",
											reference: cancel.reference,
											provider: cancel.provider,
											atPeriodEnd: true,
										}),
									});
									setCancel(null);
									await invalidateBilling(queryClient, session.user.id);
								} catch (error) {
									setError(errorMessage(error));
								} finally {
									setBusy(false);
								}
							}}
						>
							{m.settings_billing_cancel_renewal()}
						</Button>
					</div>
				</Modal>
			)}
		</>
	);
}
export function paymentStateLabel(state: string) {
	const labels: Record<string, () => string> = {
		pending: m.settings_billing_state_pending,
		active: m.settings_billing_state_active,
		trialing: m.settings_billing_state_trialing,
		past_due: m.settings_billing_state_past_due,
		unpaid: m.settings_billing_state_unpaid,
		canceled: m.settings_billing_state_canceled,
		refunded: m.settings_billing_state_refunded,
		disputed: m.settings_billing_state_disputed,
		creating: m.settings_billing_state_creating,
		open: m.settings_billing_state_open,
		failed: m.settings_billing_state_failed,
		expired: m.settings_billing_state_expired,
		completed: m.settings_billing_state_completed,
		unknown: m.settings_billing_state_unknown,
	};
	return labels[state]?.() || state;
}

interface CheckoutView {
	key: string;
	status: Checkout | null;
	error: string;
	checking: boolean;
	stopped: boolean;
}
export function PaymentStatusPage({
	reference,
	provider,
}: {
	reference?: string;
	provider?: PaymentProviderId;
}) {
	const { session } = AppRoute.useRouteContext();
	const queryClient = useQueryClient();
	const key = `${provider || ""}:${reference || ""}`;
	const [view, setView] = useState<CheckoutView | null>(null);
	const [revision, setRevision] = useState(0);
	// Guard the render itself, not only the effect: a new URL must never borrow old success/error.
	const { status, error, checking, stopped } =
		view?.key === key
			? view
			: { status: null, error: "", checking: !!reference, stopped: false };
	useEffect(() => {
		if (revision < 0 || !reference) return;
		let alive = true;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		let count = 0;
		setView({ key, status: null, error: "", checking: true, stopped: false });
		function update(value: Partial<CheckoutView>) {
			if (alive)
				setView((current) =>
					current?.key === key ? { ...current, ...value } : current,
				);
		}
		async function check() {
			update({ checking: true });
			try {
				const search = new URLSearchParams({ reference: reference || "" });
				if (provider) search.set("provider", provider);
				const value = await api<Checkout>(`/api/payments?${search}`, {
					signal: controller.signal,
				});
				if (!alive) return;
				// Provider return URLs may use a session ID that the server resolves to a
				// canonical checkout reference. The request key + alive guard owns correlation.
				if (provider && value.provider !== provider) {
					throw new Error(m.settings_billing_reference_mismatch());
				}
				update({ status: value, error: "" });
				if (value.hasAccess) {
					await invalidateBilling(queryClient, session.user.id).catch(() => {});
					if (alive)
						timer = setTimeout(() => {
							if (alive)
								window.location.replace(localePath("/settings/billing"));
						}, 1200);
					return;
				}
				count++;
				const waiting =
					value.state === "pending" &&
					!["failed", "expired", "unknown"].includes(value.lifecycle);
				if (waiting && count < 30) timer = setTimeout(check, 2500);
				else if (waiting) update({ stopped: true });
			} catch (error) {
				update({ error: errorMessage(error), stopped: true });
			} finally {
				update({ checking: false });
			}
		}
		void check();
		return () => {
			alive = false;
			controller.abort();
			clearTimeout(timer);
		};
	}, [reference, provider, key, revision, queryClient, session.user.id]);
	return (
		<>
			<SectionTitle
				title={m.settings_billing_payment_status()}
				description={m.settings_billing_checking_this_checkout_securely_tied_to_your()}
			/>
			<Card>
				{!reference ? (
					<Notice kind="error">
						{m.settings_billing_no_checkout_reference_was_provided_open_billing()}
					</Notice>
				) : error ? (
					<Notice kind="error">{error}</Notice>
				) : status?.hasAccess ? (
					<div className="payment-success" role="status" aria-live="polite">
						<CheckCircle2 size={40} />
						<h2>{m.settings_billing_payment_confirmed()}</h2>
						<p>{m.settings_billing_your_access_is_ready()}</p>
						<p>{m.payment_returning_to_billing()}</p>
					</div>
				) : status &&
					(status.state !== "pending" ||
						["failed", "expired", "unknown"].includes(status.lifecycle)) ? (
					<Notice>
						{m.settings_billing_payment_status_access_has_not_been_granted({
							value1: paymentStateLabel(
								status.state === "pending" ? status.lifecycle : status.state,
							),
						})}
						{status.reconciliationRequired && (
							<p>{m.settings_billing_support_required()}</p>
						)}
					</Notice>
				) : (
					<div className="payment-pending">
						<Clock3 size={36} />
						<h2>{m.settings_billing_waiting_for_confirmation()}</h2>
						<p>
							{stopped
								? m.settings_billing_confirmation_is_taking_longer_than_usual_you()
								: m.settings_billing_your_payment_provider_is_confirming_the_payment()}
						</p>
						{checking && <Loading />}
					</div>
				)}
				<div className="row">
					{stopped && (
						<Button busy={checking} onClick={() => setRevision((r) => r + 1)}>
							{m.settings_billing_check_again()}
						</Button>
					)}
					<a
						className="button secondary"
						href={localePath("/settings/billing")}
					>
						{m.settings_billing_back_to_billing()}
					</a>
				</div>
			</Card>
		</>
	);
}
