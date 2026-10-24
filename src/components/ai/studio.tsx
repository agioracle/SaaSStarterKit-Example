import { websiteConfig } from "../../config/website";
import {
	aiClientOutcome,
	readAiClientRequest,
	saveAiClientRequest,
	type AiClientRequest,
} from "../../ai/request-state";
import { m } from "../../locale/paraglide/messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { AI_CARDS } from "../../ai/types";
import { AI_TOOL_CARDS } from "./cards";
import type { AiCardValues } from "./card-contract";
import {
	Button,
	Card,
	Notice,
	SectionTitle,
	errorMessage,
} from "../ui/primitives";
import { localePath } from "../../locale";
import { authClient } from "../../auth/client";
import { ApiError, apiError } from "../../lib/api-client";
import {
	aiTaskHash,
	createAiRequestTracker,
	DEFAULT_AI_TASK,
	observeAiTaskNavigation,
	type AiTask as Task,
} from "../../ai/navigation";
export function AiStudio() {
	const { data: session } = authClient.useSession();
	const [task, setTask] = useState<Task>(DEFAULT_AI_TASK);
	const [text, setText] = useState("");
	const [image, setImage] = useState("");
	const [option, setOption] = useState("");
	const [source, setSource] = useState("en");
	const [target, setTarget] = useState("zh");
	const [result, setResult] = useState<Record<string, unknown> | null>(null);
	const [audio, setAudio] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const requests = useRef(createAiRequestTracker());
	const [usage, setUsage] = useState<AiClientRequest | null>(null);
	const [storageReady, setStorageReady] = useState(false);
	const [checkingStatus, setCheckingStatus] = useState(false);
	const pendingUsage = useRef<AiClientRequest | null>(null);
	const userId = session?.user.id;
	const readPendingUsage = (): AiClientRequest | null => pendingUsage.current;
	const rememberUsage = useCallback(
		(value: AiClientRequest | null) => {
			if (!userId) throw new Error("Sign in before starting an AI request.");
			saveAiClientRequest(window.sessionStorage, userId, value);
			pendingUsage.current = value;
			setUsage(value);
		},
		[userId],
	);
	useEffect(() => {
		requests.current.invalidate();
		pendingUsage.current = null;
		setUsage(null);
		setStorageReady(false);
		setResult(null);
		setAudio("");
		setError("");
		setBusy(false);
		setCheckingStatus(false);
		if (!userId) return;
		try {
			const restored = readAiClientRequest(window.sessionStorage, userId);
			pendingUsage.current = restored;
			setUsage(restored);
			setStorageReady(true);
		} catch {
			setError(m.ai_usage_storage_unavailable());
		}
	}, [userId]);
	const activeTask = useRef<Task>(DEFAULT_AI_TASK);
	const changeTask = useCallback((next: Task) => {
		if (next === activeTask.current) return;
		activeTask.current = next;
		requests.current.invalidate();
		setTask(next);
		setText("");
		setImage("");
		setOption("");
		setResult(null);
		setAudio("");
		setError("");
		setBusy(false);
	}, []);
	useEffect(() => {
		const unsubscribe = observeAiTaskNavigation(window, changeTask);
		const tracker = requests.current;
		return () => {
			unsubscribe();
			tracker.invalidate();
		};
	}, [changeTask]);
	useEffect(
		() => () => {
			if (audio) URL.revokeObjectURL(audio);
		},
		[audio],
	);
	const card = AI_TOOL_CARDS[task];
	const needsImage = card.needsImage;
	const Fields = card.Fields;
	const Result = card.Result;
	const values: AiCardValues = { text, image, option, source, target };
	function updateFields(patch: Partial<AiCardValues>) {
		clearResult();
		if (patch.text !== undefined) setText(patch.text);
		if (patch.image !== undefined) setImage(patch.image);
		if (patch.option !== undefined) setOption(patch.option);
		if (patch.source !== undefined) setSource(patch.source);
		if (patch.target !== undefined) setTarget(patch.target);
	}
	function clearResult() {
		requests.current.invalidate();
		setResult(null);
		setAudio("");
		setError("");
		setBusy(false);
	}
	return (
		<div className="container ai-page">
			<SectionTitle
				eyebrow={m.ai_studio_the_creative_toolkit()}
				title={m.ai_studio_a_little_intelligence_a_lot_of_possibility()}
				description={m.ai_studio_explore_ten_useful_ways_to_turn_a()}
			/>
			<div className="ai-layout">
				<nav className="ai-nav" aria-label={m.ai_studio_ai_tools()}>
					{AI_CARDS.map((card) => (
						<button
							key={card.id}
							className={task === card.id ? "active" : ""}
							aria-current={task === card.id ? "true" : undefined}
							onClick={() => {
								changeTask(card.id);
								window.location.hash = aiTaskHash(card.id);
							}}
						>
							<Sparkles size={17} />
							<div>
								<strong>{AI_TOOL_CARDS[card.id].title()}</strong>
								<small>{card.provider}</small>
							</div>
						</button>
					))}
				</nav>
				<div className="stack">
					<div key={task} id={aiTaskHash(task).slice(1)}>
						<Card
							title={card.title()}
							description={m.ai_studio_generated_output_can_be_inaccurate_review_it()}
						>
							{!session && websiteConfig.auth.enabled && (
								<Notice>
									{m.ai_studio_you_can_explore_the_tools_now_sign()}{" "}
									<a
										href={`${localePath("/auth/login")}?redirect=${encodeURIComponent("/ai")}`}
									>
										{m.ai_studio_sign_in()}
									</a>
								</Notice>
							)}
							{!websiteConfig.auth.enabled && (
								<Notice>{m.auth_disabled_description()}</Notice>
							)}
							{!websiteConfig.ai.enabled && (
								<Notice>{m.ai_usage_disabled()}</Notice>
							)}
							{error && <Notice kind="error">{error}</Notice>}
							{usage && (
								<Notice
									kind={usage.outcome === "unknown" ? "error" : undefined}
								>
									<p>{m.ai_usage_reference({ id: usage.requestId })}</p>
									<p>
										{usage.outcome === "pending"
											? m.ai_usage_pending()
											: usage.outcome === "succeeded"
												? m.ai_usage_completed()
												: ["released", "not_started"].includes(usage.outcome)
													? m.ai_usage_released()
													: m.ai_usage_unknown()}
									</p>
									<div className="row">
										<Button
											type="button"
											variant="secondary"
											busy={checkingStatus}
											disabled={busy || checkingStatus}
											onClick={async () => {
												const saved = pendingUsage.current;
												if (!saved || !userId) return;
												setCheckingStatus(true);
												const isCurrent = requests.current.snapshot();
												try {
													const response = await fetch(
														`/api/ai?requestId=${encodeURIComponent(saved.requestId)}`,
													);
													if (!response.ok)
														throw await apiError(response, saved.requestId);
													const details = (await response.json()) as {
														outcome?: unknown;
													};
													if (
														isCurrent() &&
														pendingUsage.current?.requestId === saved.requestId
													)
														rememberUsage({
															...saved,
															outcome: aiClientOutcome(details.outcome),
														});
												} catch (error) {
													if (isCurrent())
														setError(
															errorMessage(
																error instanceof ApiError
																	? error
																	: new ApiError(502, {
																			requestId: saved.requestId,
																			code: "AI_STATUS_UNAVAILABLE",
																		}),
															),
														);
												} finally {
													setCheckingStatus(false);
												}
											}}
										>
											{m.ai_usage_check_status()}
										</Button>
										<Button
											type="button"
											variant="secondary"
											disabled={busy || checkingStatus}
											onClick={() => {
												if (
													["pending", "unknown"].includes(usage.outcome) &&
													!window.confirm(m.ai_usage_confirm_new())
												)
													return;
												try {
													rememberUsage(null);
													clearResult();
												} catch {
													setStorageReady(false);
													setError(m.ai_usage_storage_unavailable());
												}
											}}
										>
											{m.ai_usage_new_request()}
										</Button>
									</div>
								</Notice>
							)}
							<div className="ai-presets">
								{card.presets.map((preset) => (
									<button
										key={preset.label()}
										onClick={() => {
											clearResult();
											setText(preset.text());
										}}
									>
										{preset.label()}
									</button>
								))}
							</div>
							<form
								className="stack"
								onSubmit={async (event) => {
									event.preventDefault();
									if (
										busy ||
										pendingUsage.current ||
										!storageReady ||
										!websiteConfig.ai.enabled ||
										!userId
									)
										return;
									const request = requests.current.start();
									setBusy(true);
									setError("");
									setResult(null);
									setAudio("");
									try {
										const body = card.buildRequest(values);
										const requestId = crypto.randomUUID();
										// Persist the opaque ID BEFORE dispatch. Reload, navigation or
										// Stop waiting must not silently create a second paid request.
										try {
											rememberUsage({ requestId, outcome: "pending" });
										} catch {
											setStorageReady(false);
											throw new Error(m.ai_usage_storage_unavailable());
										}
										const response = await fetch("/api/ai", {
											method: "POST",
											headers: {
												"Content-Type": "application/json",
												"Idempotency-Key": requestId,
											},
											body: JSON.stringify(body),
											signal: request.signal,
										});
										if (!response.ok) {
											const failure = await apiError(response, requestId);
											if (request.isCurrent())
												rememberUsage({
													requestId,
													outcome: aiClientOutcome(failure.outcome),
												});
											throw failure;
										}
										if (!request.isCurrent()) return;
										if (
											response.headers.get("content-type")?.startsWith("audio/")
										) {
											const blob = await response.blob();
											if (request.isCurrent())
												setAudio(URL.createObjectURL(blob));
										} else {
											const value = (await response.json()) as Record<
												string,
												unknown
											>;
											if (request.isCurrent()) setResult(value);
										}
										if (request.isCurrent())
											rememberUsage({ requestId, outcome: "succeeded" });
									} catch (error) {
										const saved = readPendingUsage();
										if (request.isCurrent() && saved?.outcome === "pending") {
											try {
												rememberUsage({
													...saved,
													outcome: "unknown",
												});
											} catch {
												setStorageReady(false);
											}
										}
										if (
											request.isCurrent() &&
											!(
												error instanceof DOMException &&
												error.name === "AbortError"
											)
										)
											setError(
												errorMessage(
													error instanceof ApiError ||
														!saved ||
														saved.outcome !== "pending"
														? error
														: new ApiError(502, {
																requestId: saved.requestId,
																outcome: "unknown",
															}),
												),
											);
									} finally {
										if (request.isCurrent()) setBusy(false);
									}
								}}
							>
								<Fields
									values={values}
									onChange={updateFields}
									onError={setError}
									snapshot={() => requests.current.snapshot()}
								/>
								<div className="row">
									<Button
										type="submit"
										busy={busy}
										disabled={
											!websiteConfig.auth.enabled ||
											!websiteConfig.ai.enabled ||
											!session ||
											!storageReady ||
											!!usage ||
											(needsImage && !image)
										}
									>
										<Sparkles size={17} />
										{m.ai_studio_generate()}
									</Button>
									{busy && (
										<Button
											variant="secondary"
											type="button"
											onClick={() => {
												requests.current.invalidate();
												if (pendingUsage.current) {
													try {
														rememberUsage({
															...pendingUsage.current,
															outcome: "unknown",
														});
													} catch {
														setStorageReady(false);
													}
												}
												setBusy(false);
												setError(
													m.ai_studio_stopped_waiting_a_provider_may_still_finish(),
												);
											}}
										>
											{m.ai_studio_stop_waiting()}
										</Button>
									)}
								</div>
							</form>
						</Card>
					</div>
					{(result || audio) && (
						<Card title={m.ai_studio_your_result()}>
							<div className="ai-result">
								<Result result={result} audio={audio} />
							</div>
						</Card>
					)}
					<p className="fine-print">
						{m.ai_studio_ai_providers_must_be_configured_by_the()}
					</p>
				</div>
			</div>
		</div>
	);
}
