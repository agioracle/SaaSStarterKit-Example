import { useState } from "react";
import type { GenerationJob } from "../../generation/types";
import { getLocale } from "../../locale";
import {
	Button,
	Card,
	Empty,
	Loading,
	Modal,
	Notice,
	SectionTitle,
	api,
	errorMessage,
	useResource,
} from "../ui/primitives";
import { generationAdminCopy } from "./generation-copy";
import { JobStatus } from "../lumina/generation-view";
type OperationalJob = GenerationJob & {
	userId: string;
	providerRequestId: string | null;
};
export function GenerationOperations() {
	const c = generationAdminCopy();
	const resource = useResource<{ jobs: OperationalJob[]; limit: number }>(
		"/api/admin/generations",
	);
	const [selected, setSelected] = useState<OperationalJob | null>(null);
	const [outcome, setOutcome] = useState<"charged" | "released">("charged");
	const [reason, setReason] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const date = (value: number) =>
		new Intl.DateTimeFormat(getLocale(), {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(value);
	async function settle() {
		if (!selected || busy) return;
		if (!confirmed || reason.trim().length < 20) {
			setError(c.minimum);
			return;
		}
		setBusy(true);
		setError("");
		try {
			await api(`/api/admin/generations/${selected.id}/reconcile`, {
				method: "POST",
				body: JSON.stringify({
					outcome,
					reason: reason.trim(),
					providerInspectionConfirmed: true,
				}),
			});
			setSelected(null);
			setMessage(c.success);
			await resource.reload();
		} catch (cause) {
			setError(
				errorMessage(cause).includes("cannot be reconciled online")
					? c.ineligible
					: c.requestError,
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div>
			<SectionTitle
				title={c.title}
				description={c.description}
				action={
					<Button variant="secondary" onClick={() => void resource.reload()}>
						{c.refresh}
					</Button>
				}
			/>
			<Notice>{c.warning}</Notice>
			{message && <Notice kind="success">{message}</Notice>}
			{resource.error && <Notice kind="error">{c.requestError}</Notice>}
			{resource.loading ? (
				<Loading />
			) : resource.data?.jobs.length === 0 ? (
				<Empty title={c.empty}>{c.emptyDetail}</Empty>
			) : (
				<div className="settings-stack">
					{resource.data?.jobs.map((job) => (
						<Card
							key={job.id}
							title={job.provider === "fal" ? "fal.ai" : "Cloudflare"}
						>
							<JobStatus job={job} />
							<dl className="lm-operational-details">
								<dt>{c.job}</dt>
								<dd>{job.id}</dd>
								<dt>{c.owner}</dt>
								<dd>{job.userId}</dd>
								<dt>{c.provider}</dt>
								<dd>{job.providerRequestId || c.unknown}</dd>
								<dt>{c.started}</dt>
								<dd>{date(job.createdAt)}</dd>
								<dt>{c.updated}</dt>
								<dd>{date(job.updatedAt)}</dd>
							</dl>
							<Button
								variant="secondary"
								onClick={() => {
									setSelected(job);
									setReason("");
									setConfirmed(false);
									setOutcome("charged");
									setError("");
									setMessage("");
								}}
							>
								{c.review}
							</Button>
						</Card>
					))}
					{resource.data &&
						resource.data.jobs.length >= resource.data.limit && (
							<Notice>{c.limit}</Notice>
						)}
				</div>
			)}
			{selected && (
				<Modal
					title={c.review}
					onClose={() => {
						if (!busy) setSelected(null);
					}}
					error={error}
				>
					<p>{c.note}</p>
					<p style={{ overflowWrap: "anywhere" }}>{selected.id}</p>
					<label className="field">
						<span>{c.outcome}</span>
						<select
							value={outcome}
							disabled={busy}
							onChange={(event) =>
								setOutcome(event.target.value as "charged" | "released")
							}
						>
							<option value="charged">{c.charged}</option>
							<option value="released">{c.released}</option>
						</select>
					</label>
					<label className="field">
						<span>{c.reason}</span>
						<textarea
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							minLength={20}
							maxLength={1000}
							rows={4}
							disabled={busy}
						/>
						<small>{c.reasonHint}</small>
					</label>
					<label className="checkbox-row">
						<input
							type="checkbox"
							checked={confirmed}
							onChange={(event) => setConfirmed(event.target.checked)}
							disabled={busy}
						/>
						{c.confirm}
					</label>
					<div className="lm-job-actions">
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => setSelected(null)}
						>
							{c.close}
						</Button>
						<Button
							busy={busy}
							disabled={!confirmed || reason.trim().length < 20}
							onClick={() => void settle()}
						>
							{c.settle}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
