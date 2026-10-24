import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowRight,
	ArrowUpRight,
	Cloud,
	Image,
	Layers3,
	RefreshCw,
	Sparkles,
	WandSparkles,
} from "lucide-react";
import type {
	AspectRatio,
	GenerationConfig,
	GenerationInput,
	GenerationJob,
	GenerationResult,
	ModelId,
} from "../../generation/types";
import { localePath } from "../../locale";
import { Button, Loading, Notice } from "../ui/primitives";
import { l, promptText } from "./copy";
import {
	readPendingRequest,
	savePendingRequest,
	clearPendingRequest,
} from "./pending-request";
import { productError } from "./errors";
import {
	GenerationRequestError,
	generationRequest,
	useGenerationConfig,
	useGenerationJob,
} from "./client";
import {
	GenerationVisual,
	JobActions,
	JobStatus,
	PrivateNote,
	UsageMeter,
} from "./generation-view";
function styleOptions() {
	return [
		{ id: "none", label: l("as_written"), modifier: "" },
		{
			id: "photo",
			label: l("photography"),
			modifier: l("editorial_photography_natural_light_refined_composition"),
		},
		{
			id: "illustration",
			label: l("illustration"),
			modifier: l(
				"expressive_illustration_tactile_shapes_thoughtful_color_palette",
			),
		},
		{
			id: "cinematic",
			label: l("cinematic"),
			modifier: l("cinematic_atmosphere_dramatic_light_considered_framing"),
		},
	];
}
export function StudioPage({
	reuse,
	idea,
	userId,
}: {
	reuse?: string;
	idea?: number;
	userId: string;
}) {
	const styles = styleOptions();
	const client = useQueryClient();
	const config = useGenerationConfig();
	const [prompt, setPrompt] = useState(() =>
		idea !== undefined ? promptText(idea) : "",
	);
	const [modelId, setModelId] = useState<ModelId>("fal-flux-schnell");
	const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
	const [seed, setSeed] = useState("");
	const [style, setStyle] = useState("none");
	const [jobId, setJobId] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [uncertainRequest, setUncertainRequest] =
		useState<GenerationInput | null>(null);
	const [storageReady, setStorageReady] = useState(false);
	const [storageError, setStorageError] = useState("");
	const [reuseLoading, setReuseLoading] = useState(!!reuse);
	const submitted = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const selectedOnce = useRef(false);
	const currentJob = useGenerationJob(jobId);
	const model = config.data?.models.find((item) => item.id === modelId);
	const modifier = styles.find((item) => item.id === style)?.modifier || "";
	const finalPrompt = [prompt.trim(), modifier].filter(Boolean).join("\n\n");
	const usage = config.data?.usage;
	const quotaBlocked =
		!!usage &&
		(usage.remaining < 1 ||
			usage.active >= usage.concurrencyLimit ||
			usage.retained >= usage.retainedLimit);
	useEffect(() => {
		try {
			const pending = readPendingRequest(sessionStorage, userId);
			if (pending) {
				setUncertainRequest(pending);
				setPrompt(pending.prompt);
				setModelId(pending.model);
				setAspectRatio(pending.aspectRatio);
				setSeed(pending.seed === undefined ? "" : String(pending.seed));
				setStyle("none");
				selectedOnce.current = true;
			}
			setStorageReady(true);
		} catch {
			setStorageError(
				l(
					"this_browser_could_not_restore_your_saved_request_check_your_library_b",
				),
			);
		}
	}, [userId]);
	useEffect(() => {
		if (!config.data || selectedOnce.current || reuse) return;
		selectedOnce.current = true;
		const first =
			config.data.models.find((item) => item.available) ||
			config.data.models[0];
		if (first) setModelId(first.id);
	}, [config.data, reuse]);
	useEffect(() => {
		if (!reuse || !storageReady || uncertainRequest) return;
		const controller = new AbortController();
		setReuseLoading(true);
		generationRequest<{ job: GenerationJob }>(
			`/api/generations/${encodeURIComponent(reuse)}`,
			{ signal: controller.signal },
		)
			.then(({ job }) => {
				if (controller.signal.aborted) return;
				setPrompt(job.prompt);
				setModelId(job.model);
				setAspectRatio(job.aspectRatio);
				setSeed(job.seed === null ? "" : String(job.seed));
				setStyle("none");
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: l("could_not_load_this_prompt"),
					);
			})
			.finally(() => {
				if (!controller.signal.aborted) setReuseLoading(false);
			});
		return () => controller.abort();
	}, [reuse, storageReady, uncertainRequest]);
	function chooseModel(next: ModelId) {
		const chosen = config.data?.models.find((item) => item.id === next);
		setModelId(next);
		if (chosen && !chosen.aspectRatios.includes(aspectRatio))
			setAspectRatio(chosen.aspectRatios[0]);
		if (!chosen?.supportsSeed) setSeed("");
	}
	async function send(input: GenerationInput) {
		if (submitted.current || !storageReady) return;
		try {
			savePendingRequest(sessionStorage, userId, input);
		} catch {
			setStorageReady(false);
			setStorageError(
				l(
					"your_browser_could_not_save_a_recovery_key_no_request_was_sent_enable_",
				),
			);
			return;
		}
		submitted.current = true;
		setBusy(true);
		setError("");
		try {
			const result = await generationRequest<GenerationResult>(
				"/api/generations",
				{ method: "POST", body: JSON.stringify(input) },
			);
			try {
				clearPendingRequest(sessionStorage, userId);
			} catch {
				/* Keeping the same key is safe on the next visit. */
			}
			if (!mounted.current) return;
			setUncertainRequest(null);
			setJobId(result.job.id);
			client.setQueryData(["lumina-job", result.job.id], result.job);
			client.setQueryData<GenerationConfig>(["lumina-config"], (value) =>
				value ? { ...value, usage: result.usage } : value,
			);
			void client.invalidateQueries({ queryKey: ["lumina-library"] });
		} catch (cause) {
			if (!mounted.current) return;
			setError(
				cause instanceof Error
					? cause.message
					: l("the_connection_was_interrupted"),
			);
			if (!(cause instanceof GenerationRequestError) || cause.status >= 500)
				setUncertainRequest(input);
			else {
				setUncertainRequest(null);
				try {
					clearPendingRequest(sessionStorage, userId);
				} catch {
					/* Retain for safe recovery if storage fails. */
				}
			}
			void config.refetch();
		} finally {
			submitted.current = false;
			if (mounted.current) setBusy(false);
		}
	}
	const job = currentJob.data;
	return (
		<div className="lm-studio-page">
			<div className="lm-page-heading">
				<div>
					<span className="lm-kicker">{l("your_creative_space")}</span>
					<h1>{l("a_good_place_to_begin")}</h1>
					<p>
						{l("follow_a_thought_find_a_new_direction_make_something_yours")}
					</p>
				</div>
				<a href={localePath("/library")} className="button secondary">
					<Layers3 size={16} />
					{l("my_library")}
					<ArrowUpRight size={14} />
				</a>
			</div>
			{storageError && (
				<Notice kind="error">
					{storageError}{" "}
					<a href={localePath("/library")}>{l("check_library")}</a>
				</Notice>
			)}
			{config.error && (
				<Notice kind="error">
					{l("we_couldn_t_load_your_workspace_settings")}{" "}
					{productError(config.error.message)}{" "}
					<button
						type="button"
						className="lm-inline-button"
						onClick={() => void config.refetch()}
					>
						{l("try_again")}
					</button>
				</Notice>
			)}
			{config.data && !config.data.available && (
				<Notice>
					{l("image_generation_is_not_connected_yet")}{" "}
					{productError(config.data.unavailableReason)}{" "}
					<span className="lm-notice-detail">
						{l(
							"ask_your_workspace_operator_to_enable_and_configure_cloudflare_workers",
						)}
					</span>
				</Notice>
			)}
			<div className="lm-studio-grid">
				<section className="lm-controls">
					<div className="lm-panel-title">
						<WandSparkles size={17} />
						<h2>{l("the_starting_point")}</h2>
						<span>01</span>
					</div>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (
								!storageReady ||
								busy ||
								uncertainRequest ||
								!model?.available ||
								quotaBlocked ||
								!finalPrompt ||
								finalPrompt.length > 2000
							)
								return;
							void send({
								model: modelId,
								prompt: finalPrompt,
								aspectRatio,
								...(model.supportsSeed && seed ? { seed: Number(seed) } : {}),
								idempotencyKey: crypto.randomUUID(),
							});
						}}
					>
						<fieldset
							disabled={busy || reuseLoading || !!uncertainRequest}
							className="lm-control-fields"
						>
							<label className="lm-field" htmlFor="image-prompt">
								<span>
									{l("your_prompt")}
									<small>{finalPrompt.length} / 2000</small>
								</span>
								<textarea
									id="image-prompt"
									value={prompt}
									onChange={(event) => setPrompt(event.target.value)}
									placeholder={l(
										"a_quiet_little_house_by_the_sea_warm_morning_light_soft_film_grain",
									)}
									rows={6}
									maxLength={2000}
									required
									aria-describedby="prompt-hint"
								/>
							</label>
							<p className="lm-field-hint" id="prompt-hint">
								{l("include_the_subject_setting_light_and_feeling")}
							</p>
							<button
								type="button"
								className="lm-prompt-idea"
								onClick={() => {
									setPrompt(promptText(Math.floor(Math.random() * 3)));
									setStyle("none");
								}}
							>
								<Sparkles size={13} />
								{l("give_me_a_starting_point")}
								<ArrowRight size={13} />
							</button>
							<div className="lm-field">
								<label htmlFor="image-model">{l("model_provider")}</label>
								{config.isPending ? (
									<Loading />
								) : (
									<select
										id="image-model"
										value={modelId}
										onChange={(event) =>
											chooseModel(event.target.value as ModelId)
										}
									>
										{config.data?.models.map((item) => (
											<option key={item.id} value={item.id}>
												{item.label} ·{" "}
												{item.provider === "fal" ? "fal.ai" : "Cloudflare"}
												{item.available ? "" : ` (${l("not_configured")})`}
											</option>
										))}
									</select>
								)}
								{model && (
									<small className="lm-field-hint">
										<Cloud size={12} />
										{model.provider === "fal"
											? l("fal_ai_flux_1_schnell_flexible_formats")
											: l("cloudflare_workers_ai_flux_1_schnell_square_output")}
									</small>
								)}
							</div>
							{model && !model.available && (
								<p className="lm-inline-warning">
									{productError(model.unavailableReason) ||
										l(
											"this_model_is_not_configured_choose_an_available_provider",
										)}
								</p>
							)}
							<div className="lm-field">
								<span>{l("aspect_ratio")}</span>
								<div className="lm-ratios">
									{(model?.aspectRatios || ["1:1"]).map((ratio) => (
										<button
											type="button"
											key={ratio}
											className={aspectRatio === ratio ? "selected" : ""}
											onClick={() => setAspectRatio(ratio as AspectRatio)}
											aria-pressed={aspectRatio === ratio}
										>
											<span
												className={`lm-ratio-icon lm-ratio-${ratio.replace(":", "-")}`}
											/>
											<small>{ratio}</small>
										</button>
									))}
								</div>
								<small className="lm-field-hint">
									{model?.provider === "cloudflare"
										? l("this_model_supports_square_images_only")
										: l("choose_the_shape_that_suits_your_idea")}
								</small>
							</div>
							<div className="lm-field">
								<span>
									{l("creative_direction")}
									<small>{l("prompt_modifier")}</small>
								</span>
								<div className="lm-styles">
									{styles.map((item) => (
										<button
											type="button"
											key={item.id}
											className={style === item.id ? "selected" : ""}
											onClick={() => setStyle(item.id)}
											aria-pressed={style === item.id}
										>
											{item.label}
										</button>
									))}
								</div>
								{modifier && (
									<small className="lm-field-hint">
										{l("added_to_your_prompt")} {modifier}
									</small>
								)}
							</div>
							{model?.supportsSeed && (
								<details className="lm-advanced">
									<summary>{l("more_control")}</summary>
									<label className="lm-field" htmlFor="image-seed">
										<span>
											{l("seed")}
											<small>{l("optional")}</small>
										</span>
										<input
											id="image-seed"
											type="number"
											value={seed}
											onChange={(event) => setSeed(event.target.value)}
											min={0}
											max={2147483647}
											step={1}
											placeholder={l("random_each_time")}
										/>
									</label>
									<p className="lm-field-hint">
										{l(
											"a_seed_helps_explore_variations_identical_output_is_not_guaranteed",
										)}
									</p>
								</details>
							)}
						</fieldset>
						{finalPrompt.length > 2000 && (
							<p className="lm-inline-warning">
								{l(
									"shorten_your_prompt_or_remove_the_style_modifier_to_stay_within_2_000_",
								)}
							</p>
						)}
						{usage && quotaBlocked && (
							<p className="lm-inline-warning">
								{usage.remaining < 1
									? l(
											"this_month_s_allowance_has_been_used_or_reserved_check_pending_request",
										)
									: usage.active >= usage.concurrencyLimit
										? l(
												"your_concurrent_request_limit_is_reached_let_an_active_request_finish_",
											)
										: l(
												"your_saved_image_limit_is_reached_delete_finished_work_you_no_longer_n",
											)}
							</p>
						)}
						<Button
							type="submit"
							className="lm-generate"
							busy={busy}
							disabled={
								!storageReady ||
								!model?.available ||
								!finalPrompt ||
								finalPrompt.length > 2000 ||
								quotaBlocked ||
								reuseLoading ||
								!!uncertainRequest
							}
						>
							<Sparkles size={17} />
							{busy ? l("sending_your_idea") : l("create_image")}
							<span>1 {l("credit")}</span>
						</Button>
						<p className="lm-submit-note">
							{l("one_image_saved_privately_in_your_library")}
						</p>
					</form>
					{usage && <UsageMeter usage={usage} />}
				</section>
				<section className="lm-preview">
					<div className="lm-panel-title">
						<Image size={17} />
						<h2>{l("your_canvas")}</h2>
						{job ? (
							<JobStatus job={job} />
						) : (
							<span>{l("ready_when_you_are")}</span>
						)}
					</div>
					{error && <Notice kind="error">{productError(error)}</Notice>}
					{uncertainRequest && (
						<Notice>
							<strong>{l("the_outcome_is_not_confirmed")}</strong>
							<p>
								{l(
									"your_request_may_already_exist_recover_the_exact_same_request_without_",
								)}
							</p>
							<div className="lm-job-actions">
								<Button busy={busy} onClick={() => void send(uncertainRequest)}>
									<RefreshCw size={15} />
									{l("recover_same_request")}
								</Button>
								<a href={localePath("/library")} className="lm-text-link">
									{l("check_library")}
								</a>
							</div>
						</Notice>
					)}
					<GenerationVisual key={job?.id || "empty"} job={job} />
					{job && (
						<div className="lm-preview-info">
							<div className="lm-preview-caption">
								<span>
									{job.model === "fal-flux-schnell" ? "fal.ai" : "Workers AI"} ·
									FLUX.1 Schnell · {job.aspectRatio}
								</span>
								<PrivateNote />
							</div>
							{job.error && (
								<Notice kind={job.status === "failed" ? "error" : "info"}>
									{productError(job.error)}
								</Notice>
							)}
							{currentJob.pollError && (
								<Notice kind="error">
									{l(
										"automatic_status_checks_paused_use_check_status_to_try_again",
									)}{" "}
									{productError(currentJob.pollError)}
								</Notice>
							)}
							<JobActions
								job={job}
								refresh={() => void currentJob.refresh()}
								refreshing={currentJob.refreshing}
							/>
						</div>
					)}
					{!job && (
						<div className="lm-canvas-tip">
							<Sparkles size={15} />
							<p>
								{l(
									"try_describing_the_light_instead_of_just_the_subject_a_small_detail_ca",
								)}
							</p>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
