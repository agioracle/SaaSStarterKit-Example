import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	Download,
	Grid2X2,
	ImagePlus,
	RefreshCw,
	Search,
	Sparkles,
	Trash2,
} from "lucide-react";
import type { GenerationJob, GenerationList } from "../../generation/types";
import { localePath, getLocale } from "../../locale";
import { Button, Loading, Modal, Notice } from "../ui/primitives";
import { productError } from "./errors";
import { l } from "./copy";
import {
	generationRequest,
	useGenerationConfig,
	useGenerationJob,
} from "./client";
import {
	GenerationVisual,
	JobActions,
	JobStatus,
	PrivateNote,
} from "./generation-view";
export function jobDate(value: number) {
	return new Intl.DateTimeFormat(getLocale(), {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}
function DeleteDialog({
	job,
	onClose,
	onDeleted,
}: {
	job: GenerationJob;
	onClose: () => void;
	onDeleted: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const client = useQueryClient();
	return (
		<Modal
			title={l("delete_this_creation")}
			onClose={() => {
				if (!busy) onClose();
			}}
			error={error ? productError(error) : undefined}
		>
			<div className="stack">
				<p>
					{l(
						"this_permanently_removes_this_record_and_any_saved_image_from_your_pri",
					)}
				</p>
				<div className="lm-delete-prompt">{job.prompt}</div>
				<div className="lm-job-actions">
					<Button
						variant="danger"
						busy={busy}
						onClick={async () => {
							setBusy(true);
							setError("");
							try {
								await generationRequest(
									`/api/generations/${encodeURIComponent(job.id)}`,
									{ method: "DELETE" },
								);
								void client.invalidateQueries({ queryKey: ["lumina-library"] });
								void client.invalidateQueries({ queryKey: ["lumina-config"] });
								client.removeQueries({ queryKey: ["lumina-job", job.id] });
								onDeleted();
							} catch (cause) {
								setError(
									cause instanceof Error
										? cause.message
										: l("delete_failed_try_again"),
								);
							} finally {
								setBusy(false);
							}
						}}
					>
						<Trash2 size={15} />
						{l("delete_permanently")}
					</Button>
					<Button variant="secondary" disabled={busy} onClick={onClose}>
						{l("keep_it")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
export function LibraryPage() {
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState("all");
	const [deleting, setDeleting] = useState<GenerationJob | null>(null);
	const config = useGenerationConfig();
	const list = useInfiniteQuery({
		queryKey: ["lumina-library"],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) =>
			generationRequest<GenerationList>(
				`/api/generations?limit=18${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
				{ signal },
			),
		getNextPageParam: (page) => page.nextCursor || undefined,
		retry: false,
		staleTime: 10_000,
	});
	const jobs = [
		...new Map(
			(list.data?.pages.flatMap((page) => page.jobs) || []).map((job) => [
				job.id,
				job,
			]),
		).values(),
	];
	const visible = jobs.filter(
		(job) =>
			job.status !== "deleted" &&
			(!search ||
				job.prompt.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
			(filter === "all" ||
				(filter === "ready"
					? job.status === "succeeded"
					: filter === "active"
						? ["dispatching", "queued", "processing"].includes(job.status)
						: ["failed", "unknown"].includes(job.status))),
	);
	return (
		<div className="lm-library-page">
			<div className="lm-page-heading">
				<div>
					<h1>{l("your_collection_of_possibilities")}</h1>
					<p>
						{l(
							"every_image_every_starting_point_a_little_archive_of_your_imagination",
						)}
					</p>
				</div>
				<a href={localePath("/studio")} className="button primary">
					<Sparkles size={16} />
					{l("create_something_new")}
				</a>
			</div>
			<div className="lm-library-toolbar">
				<fieldset
					className="lm-library-tabs"
					aria-label={l("filter_creations")}
				>
					{[
						["all", l("all_creations")],
						["ready", l("ready")],
						["active", l("in_progress")],
						["attention", l("needs_attention")],
					].map(([key, label]) => (
						<button
							type="button"
							className={filter === key ? "active" : ""}
							key={key}
							onClick={() => setFilter(key)}
							aria-pressed={filter === key}
						>
							{label}
						</button>
					))}
				</fieldset>
				<div className="lm-library-search">
					<Search size={15} />
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={l("search_loaded_prompts")}
						aria-label={l("search_loaded_prompts")}
					/>
				</div>
				<button
					type="button"
					className="icon-button"
					aria-label={l("refresh_library")}
					disabled={list.isFetching}
					onClick={() => {
						void list.refetch();
						void config.refetch();
					}}
				>
					<RefreshCw size={16} className={list.isFetching ? "spin" : ""} />
				</button>
			</div>
			<div className="lm-library-meta">
				<span>
					<Grid2X2 size={13} />
					{visible.length} {l("shown")}
					{config.data
						? ` · ${config.data.usage.retained} / ${config.data.usage.retainedLimit} ${l("saved_records")}`
						: ""}
				</span>
				<PrivateNote />
			</div>
			{jobs.some((job) =>
				["dispatching", "queued", "processing", "unknown"].includes(job.status),
			) && (
				<Notice>
					{l(
						"open_an_in_progress_creation_to_check_its_provider_status_refreshing_t",
					)}
				</Notice>
			)}
			{list.error && (
				<Notice kind="error">
					{l("your_library_could_not_be_loaded")}{" "}
					{productError(list.error.message)}
					<button
						type="button"
						className="lm-inline-button"
						onClick={() => void list.refetch()}
					>
						{l("try_again")}
					</button>
				</Notice>
			)}
			{list.isPending ? (
				<Loading />
			) : !jobs.length && !list.error ? (
				<div className="lm-library-empty">
					<span className="lm-empty-frame">
						<ImagePlus size={38} strokeWidth={1} />
					</span>

					<h2>
						{l("your_first_image_is_waiting")}
						<br />
						<em>{l("to_be_imagined")}</em>
					</h2>
					<p>
						{l(
							"there_s_nothing_here_yet_and_that_s_a_lovely_place_to_start_head_to_th",
						)}
					</p>
					<a href={localePath("/studio")} className="button primary">
						{l("create_your_first_image")}
						<ArrowUpRight size={15} />
					</a>
				</div>
			) : (
				<>
					<div className="lm-library-grid">
						{visible.map((job) => (
							<article className="lm-library-card" key={job.id}>
								<a
									href={localePath(`/library/${job.id}`)}
									className="lm-library-card-image"
									aria-label={`${l("view_creation")}: ${job.prompt}`}
								>
									<GenerationVisual job={job} compact />
									<span className="lm-card-open">
										<ArrowUpRight size={16} />
									</span>
								</a>
								<div className="lm-library-card-body">
									<div className="lm-card-meta">
										<JobStatus job={job} />
										<span>{job.aspectRatio}</span>
									</div>
									<a href={localePath(`/library/${job.id}`)}>
										<p>{job.prompt}</p>
									</a>
									<div className="lm-card-bottom">
										<time dateTime={new Date(job.createdAt).toISOString()}>
											{jobDate(job.createdAt)}
										</time>
										<div>
											{job.downloadUrl && (
												<a
													href={job.downloadUrl}
													download
													className="icon-button"
													aria-label={l("download_image")}
												>
													<Download size={14} />
												</a>
											)}
											{job.canDelete && (
												<button
													type="button"
													className="icon-button"
													onClick={() => setDeleting(job)}
													aria-label={l("delete_creation")}
												>
													<Trash2 size={14} />
												</button>
											)}
										</div>
									</div>
								</div>
							</article>
						))}
					</div>
					{!visible.length && (
						<div className="lm-no-results">
							<Search size={26} strokeWidth={1.3} />
							<h3>{l("no_matching_creations_in_the_loaded_results")}</h3>
							<p>{l("try_another_word_or_filter_or_load_more_if_available")}</p>
							<Button
								variant="secondary"
								onClick={() => {
									setSearch("");
									setFilter("all");
								}}
							>
								{l("clear_filters")}
							</Button>
						</div>
					)}
					{list.hasNextPage && (
						<div className="lm-load-more">
							<Button
								variant="secondary"
								busy={list.isFetchingNextPage}
								onClick={() => void list.fetchNextPage()}
							>
								{l("load_more_creations")}
								<ArrowRight size={15} />
							</Button>
						</div>
					)}
				</>
			)}
			{deleting && (
				<DeleteDialog
					job={deleting}
					onClose={() => setDeleting(null)}
					onDeleted={() => setDeleting(null)}
				/>
			)}
		</div>
	);
}
export function GenerationDetailPage({ id }: { id: string }) {
	const query = useGenerationJob(id);
	const [deleting, setDeleting] = useState(false);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState("");
	const job = query.data;
	return (
		<div className="lm-detail-page">
			<a className="lm-back" href={localePath("/library")}>
				<ArrowLeft size={15} />
				{l("back_to_your_library")}
			</a>
			{query.isPending ? (
				<Loading />
			) : query.error ? (
				<Notice kind="error">
					{l(
						"this_creation_could_not_be_opened_it_may_have_been_deleted_or_may_not_",
					)}{" "}
					{productError(query.error.message)}
					<button
						type="button"
						className="lm-inline-button"
						onClick={() => void query.refetch()}
					>
						{l("try_again")}
					</button>
				</Notice>
			) : job ? (
				<>
					<div className="lm-page-heading">
						<div>
							<h1>{l("a_closer_look")}</h1>
							<p>
								<time dateTime={new Date(job.createdAt).toISOString()}>
									{jobDate(job.createdAt)}
								</time>
							</p>
						</div>
						<JobStatus job={job} />
					</div>
					<div className="lm-detail-grid">
						<div className="lm-detail-canvas">
							<GenerationVisual key={job.id} job={job} />
							<div className="lm-preview-caption">
								<span>
									{job.status === "succeeded"
										? l("original_output")
										: l("saved_request")}
									{job.width && job.height
										? ` · ${job.width} × ${job.height}`
										: ""}
								</span>
								<PrivateNote />
							</div>
						</div>
						<section className="lm-detail-info">
							<div className="lm-panel-title">
								<Sparkles size={16} />
								<h2>{l("behind_the_image")}</h2>
							</div>
							<span className="lm-detail-label">{l("the_prompt")}</span>
							<p className="lm-detail-prompt">{job.prompt}</p>
							<button
								type="button"
								className="lm-text-link"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(job.prompt);
										setCopied(true);
										setCopyError("");
									} catch {
										setCopyError(
											l(
												"could_not_copy_automatically_select_the_prompt_text_and_copy_it_manual",
											),
										);
									}
								}}
							>
								{copied ? l("copied") : l("copy_prompt")}
							</button>
							{copyError && <Notice>{copyError}</Notice>}
							<dl className="lm-details">
								<div>
									<dt>{l("model")}</dt>
									<dd>FLUX.1 Schnell</dd>
								</div>
								<div>
									<dt>{l("provider")}</dt>
									<dd>
										{job.provider === "fal"
											? "fal.ai"
											: "Cloudflare Workers AI"}
									</dd>
								</div>
								<div>
									<dt>{l("aspect_ratio")}</dt>
									<dd>{job.aspectRatio}</dd>
								</div>
								{job.seed !== null && (
									<div>
										<dt>{l("seed")}</dt>
										<dd>{job.seed}</dd>
									</div>
								)}
								<div>
									<dt>{l("last_updated")}</dt>
									<dd>{jobDate(job.updatedAt)}</dd>
								</div>
							</dl>
							{job.error && (
								<Notice kind={job.status === "failed" ? "error" : "info"}>
									{job.status === "unknown" && !job.canRefresh
										? l("unknown_operator")
										: productError(job.error)}
								</Notice>
							)}
							{query.pollError && (
								<Notice kind="error">
									{l("status_checks_paused_check_again_when_you_re_ready")}{" "}
									{productError(query.pollError)}
								</Notice>
							)}
							<JobActions
								showDetails={false}
								job={job}
								refresh={() => void query.refresh()}
								refreshing={query.refreshing}
							/>
							{job.status === "unknown" && (
								<p className="lm-field-hint">
									{l(
										job.canRefresh
											? "a_credit_remains_reserved_while_the_result_is_uncertain_if_status_chec"
											: "unknown_reserved_operator",
									)}
								</p>
							)}
							<div className="lm-request-id">
								<span>{l("request_id")}</span>
								<code>{job.id}</code>
							</div>
							{job.canDelete && (
								<button
									type="button"
									className="lm-delete-link"
									onClick={() => setDeleting(true)}
								>
									<Trash2 size={14} />
									{l("delete_this_creation_2")}
								</button>
							)}
						</section>
					</div>
					{deleting && (
						<DeleteDialog
							job={job}
							onClose={() => setDeleting(false)}
							onDeleted={() => window.location.assign(localePath("/library"))}
						/>
					)}
				</>
			) : null}
		</div>
	);
}
