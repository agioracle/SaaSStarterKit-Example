import { m } from "../../locale/paraglide/messages";
import type { AiToolCard, AiCardFieldsProps } from "./card-contract";
import { AiTextField, AiTextResult } from "./card-fields";
import { TRANSLATION_LANGUAGES } from "../../config/ai-models";
import { Button } from "../ui/primitives";

/** Editable translate inputs, request mapping, presets, and result presentation. */
export function AiTranslationCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiTextField
				{...props}
				task="translate"
				label={m.ai_studio_your_text()}
			/>
			<div className="stack">
				<Button
					type="button"
					variant="secondary"
					onClick={() =>
						props.onChange({
							source: props.values.target,
							target: props.values.source,
						})
					}
				>
					{m.ai_studio_swap_languages()}
				</Button>
				<div className="grid two">
					<label className="field">
						{m.ai_studio_from()}
						<select
							value={props.values.source}
							onChange={(event) =>
								props.onChange({ source: event.target.value })
							}
						>
							{TRANSLATION_LANGUAGES.map((value) => (
								<option key={value}>{value}</option>
							))}
						</select>
					</label>
					<label className="field">
						{m.ai_studio_to()}
						<select
							value={props.values.target}
							onChange={(event) =>
								props.onChange({ target: event.target.value })
							}
						>
							{TRANSLATION_LANGUAGES.map((value) => (
								<option key={value}>{value}</option>
							))}
						</select>
					</label>
				</div>
			</div>
		</>
	);
}
export const translationCard: AiToolCard = {
	id: "translate",
	title: () => m.ai_studio_translation(),
	presets: [],
	buildRequest: (values) => ({
		task: "translate",
		text: values.text,
		source: values.source,
		target: values.target,
	}),
	Fields: AiTranslationCard,
	Result: AiTextResult,
};
