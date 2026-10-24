import { aiTextConstraints, type AiTask } from "../../ai/navigation";
import { m } from "../../locale/paraglide/messages";
import type { AiCardFieldsProps, AiCardResultProps } from "./card-contract";

export function AiTextField({
	values,
	onChange,
	task,
	label,
	placeholder,
}: AiCardFieldsProps & {
	task: AiTask;
	label: string;
	placeholder?: string;
}) {
	const constraints = aiTextConstraints(task);
	return (
		<label className="field">
			{label}
			<textarea
				value={values.text}
				onChange={(event) => onChange({ text: event.target.value })}
				{...constraints}
				rows={7}
				placeholder={placeholder ?? m.ai_studio_what_would_you_like_to_create()}
			/>
			<small className="muted">
				{values.text.length} / {constraints.maxLength}
			</small>
		</label>
	);
}
export function AiModelField({
	values,
	onChange,
	options,
}: AiCardFieldsProps & { options: readonly string[] }) {
	return (
		<label className="field">
			{m.ai_studio_model_provider()}
			<select
				value={values.option}
				onChange={(event) => onChange({ option: event.target.value })}
			>
				<option value="">{m.ai_studio_default()}</option>
				{options.map((value) => (
					<option key={value}>{value}</option>
				))}
			</select>
		</label>
	);
}
export function AiImageField({
	values,
	onChange,
	onError,
	snapshot,
	maxMb,
}: AiCardFieldsProps & { maxMb: number }) {
	return (
		<label className="field">
			{m.ai_studio_source_image()}
			<input
				type="file"
				accept="image/png,image/jpeg,image/webp"
				required
				onChange={(event) => {
					onChange({ image: "" });
					const file = event.target.files?.[0];
					if (!file) return;
					if (file.size > maxMb * 1024 * 1024) {
						onError(
							m.ai_studio_choose_an_image_smaller_than_mb({ value1: maxMb }),
						);
						event.target.value = "";
						return;
					}
					const reader = new FileReader();
					const isCurrent = snapshot();
					reader.onload = () => {
						if (isCurrent()) onChange({ image: String(reader.result) });
					};
					reader.readAsDataURL(file);
				}}
			/>
			{values.image && (
				<img
					className="ai-input-image"
					src={values.image}
					alt={m.ai_studio_image_input_preview()}
				/>
			)}
		</label>
	);
}
export function AiTextResult({ result }: AiCardResultProps) {
	return typeof result?.text === "string" ? (
		<p className="preserve-lines">{result.text}</p>
	) : null;
}
export function AiImageResult({ result }: AiCardResultProps) {
	const images = Array.isArray(result?.images)
		? result.images.filter((value): value is { url: string } => {
				if (
					!value ||
					typeof value !== "object" ||
					typeof value.url !== "string"
				)
					return false;
				if (
					/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
						value.url,
					)
				)
					return true;
				try {
					const url = new URL(value.url);
					return url.protocol === "https:" && !url.username && !url.password;
				} catch {
					return false;
				}
			})
		: [];
	return (
		<div className="ai-images">
			{images.map(({ url }) => (
				<a key={url} href={url} target="_blank" rel="noreferrer">
					<img src={url} alt={m.ai_studio_ai_generated_result()} />
				</a>
			))}
		</div>
	);
}
