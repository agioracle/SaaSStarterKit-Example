import {
	AlertCircle,
	ArrowUpRight,
	Check,
	Download,
	ImagePlus,
	Maximize2,
	Minimize2,
	LoaderCircle,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type {
	GenerationJob,
	GenerationStatus,
	GenerationUsage,
} from "../../generation/types";
import { localePath } from "../../locale";
import { l } from "./copy";

export function statusLabel(status: GenerationStatus) {
	const labels: Record<GenerationStatus, string> = {
		dispatching: l("submitting"),
		queued: l("in_the_queue"),
		processing: l("creating"),
		unknown: l("needs_a_status_check"),
		succeeded: l("ready"),
		failed: l("not_completed"),
		deleting: l("deleting"),
		deleted: l("deleted"),
	};
	return labels[status];
}
export function JobStatus({ job }: { job: GenerationJob }) {
	return (
		<span
			className={`lm-status lm-status-${job.status}`}
			role="status"
			aria-live="polite"
		>
			<span />
			{statusLabel(job.status)}
		</span>
	);
}
export function UsageMeter({
	usage,
	compact = false,
}: {
	usage: GenerationUsage;
	compact?: boolean;
}) {
	return (
		<div className={`lm-usage ${compact ? "lm-usage-compact" : ""}`}>
			<div>
				<span>{l("monthly_image_allowance")}</span>
				<strong>
					{usage.remaining}
					<small> / {usage.limit}</small>
				</strong>
			</div>
			<progress
				value={Math.max(0, usage.limit - usage.remaining)}
				max={Math.max(1, usage.limit)}
				aria-label={l("monthly_allowance_used_or_reserved")}
			/>
			<p>
				{usage.used} {l("used")} · {usage.reserved} {l("reserved")}
				<span>{usage.period} UTC</span>
			</p>
			{!compact && (
				<details>
					<summary>{l("how_allowance_works")}</summary>
					<p>{l("daily_safety")}</p>
					<p>
						{l(
							"example_workspace_policy_one_image_per_request_confirmed_uncharged_fai",
						)}
					</p>
				</details>
			)}
		</div>
	);
}
export function GenerationVisual({
	job,
	compact = false,
}: {
	job?: GenerationJob | null;
	compact?: boolean;
}) {
	const [broken, setBroken] = useState(false);
	const [zoomed, setZoomed] = useState(false);
	if (job?.status === "succeeded" && job.assetUrl && !broken)
		return (
			<div
				className={`lm-result-image ${compact ? "lm-result-compact" : ""} ${zoomed ? "zoomed" : ""}`}
			>
				{!compact && (
					<button
						className="lm-inspect-button"
						type="button"
						aria-pressed={zoomed}
						onClick={() => setZoomed(!zoomed)}
					>
						{zoomed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{" "}
						{zoomed ? l("fit_image") : l("inspect_image")}
					</button>
				)}
				<img
					src={job.assetUrl}
					alt={job.prompt}
					onError={() => setBroken(true)}
					loading={compact ? "lazy" : "eager"}
				/>
			</div>
		);
	if (!job)
		return (
			<div className="lm-preview-empty">
				<span className="lm-preview-empty-icon">
					<ImagePlus size={26} strokeWidth={1.5} />
				</span>
				<h3>{l("a_little_space_for_your_next_idea")}</h3>
				<p>
					{l(
						"your_image_will_appear_here_start_with_a_few_words_and_see_where_they_",
					)}
				</p>
			</div>
		);
	const pending = ["dispatching", "queued", "processing"].includes(job.status);
	return (
		<div
			className={`lm-job-placeholder ${compact ? "lm-result-compact" : ""} ${pending ? "lm-job-pending" : ""}`}
			role="status"
		>
			{pending ? (
				<span className="lm-loading-orbit" aria-hidden="true">
					<LoaderCircle size={compact ? 24 : 42} strokeWidth={1} />
				</span>
			) : broken ? (
				<ImagePlus size={30} strokeWidth={1.5} />
			) : job.status === "unknown" ? (
				<AlertCircle size={32} strokeWidth={1.5} />
			) : (
				<ImagePlus size={30} strokeWidth={1.5} />
			)}
			<h3>
				{broken ? l("image_could_not_be_loaded") : statusLabel(job.status)}
			</h3>
			{pending && !compact && <p>{l("pending_hint")}</p>}
			{!compact && (
				<p>
					{broken
						? l(
								"your_saved_job_is_still_here_reload_this_page_or_try_downloading_the_i",
							)
						: pending
							? l(
									"your_request_is_with_the_provider_we_ll_check_its_real_status_and_keep",
								)
							: job.status === "unknown"
								? l(
										job.canRefresh
											? "we_can_t_confirm_the_outcome_yet_do_not_submit_a_new_request_just_to_r"
											: "unknown_operator",
									)
								: l(
										"no_image_was_completed_review_the_details_below_before_starting_a_new_",
									)}
				</p>
			)}
		</div>
	);
}
export function JobActions({
	job,
	refresh,
	refreshing,
	showDetails = true,
}: {
	job: GenerationJob;
	refresh?: () => void;
	refreshing?: boolean;
	showDetails?: boolean;
}) {
	return (
		<div className="lm-job-actions">
			{job.status === "succeeded" && job.downloadUrl && (
				<a href={job.downloadUrl} className="button primary" download>
					<Download size={16} />
					{l("download_image")}
				</a>
			)}
			{job.canRefresh && refresh && (
				<button
					type="button"
					className="button secondary"
					disabled={refreshing}
					onClick={refresh}
				>
					<RefreshCw size={15} className={refreshing ? "spin" : ""} />
					{l("check_status")}
				</button>
			)}
			{["succeeded", "failed"].includes(job.status) && (
				<a
					href={`${localePath("/studio")}?reuse=${encodeURIComponent(job.id)}`}
					className="button secondary"
				>
					<RefreshCw size={15} />
					{l("reuse_prompt")}
				</a>
			)}
			{showDetails && (
				<a href={localePath(`/library/${job.id}`)} className="lm-text-link">
					{l("view_details")}
					<ArrowUpRight size={15} />
				</a>
			)}
		</div>
	);
}
export function PrivateNote() {
	return (
		<span className="lm-private-note">
			<ShieldCheck size={13} />
			{l("private_to_your_account")}
			<Check size={12} />
		</span>
	);
}
