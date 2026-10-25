import { localePath } from "../../locale";
import { useGenerationConfig } from "./client";
import { l } from "./copy";
import { UsageMeter } from "./generation-view";
import { Notice } from "../ui/core";
export function AllowanceSummary() {
	const config = useGenerationConfig();
	return (
		<section
			className="lm-account-allowance"
			aria-labelledby="allowance-heading"
		>
			<div className="lm-allowance-title">
				<h2 id="allowance-heading">{l("account_allowance")}</h2>
				<a href={localePath("/pricing")}>{l("account_plans")}</a>
			</div>
			{config.isPending ? (
				<div
					className="lm-skeleton"
					role="status"
					aria-label={l("monthly_image_allowance")}
				/>
			) : config.error ? (
				<Notice kind="error">
					{l("we_couldn_t_load_your_workspace_settings")}{" "}
					<button
						className="lm-inline-button"
						type="button"
						onClick={() => void config.refetch()}
					>
						{l("try_again")}
					</button>
				</Notice>
			) : config.data ? (
				<>
					<UsageMeter usage={config.data.usage} compact />
					<dl className="lm-account-facts">
						<div>
							<dt>{l("account_plan")}</dt>
							<dd>{config.data.usage.plan === "pro" ? l("pro") : l("free")}</dd>
						</div>
						<div>
							<dt>{l("account_retained")}</dt>
							<dd>
								{config.data.usage.retained} / {config.data.usage.retainedLimit}
							</dd>
						</div>
						<div>
							<dt>{l("account_active")}</dt>
							<dd>
								{config.data.usage.active} /{" "}
								{config.data.usage.concurrencyLimit}
							</dd>
						</div>
					</dl>
				</>
			) : null}
		</section>
	);
}
