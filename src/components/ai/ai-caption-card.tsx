import { m } from "../../locale/paraglide/messages";
import type { AiToolCard, AiCardFieldsProps } from "./card-contract";
import { AiTextField, AiImageField, AiTextResult } from "./card-fields";

/** Editable caption inputs, request mapping, presets, and result presentation. */
export function AiCaptionCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiImageField {...props} maxMb={1} />
			<AiTextField {...props} task="caption" label={m.ai_studio_prompt()} />
		</>
	);
}
export const captionCard: AiToolCard = {
	id: "caption",
	title: () => m.ai_studio_image_captioning(),
	needsImage: true,
	presets: [
		{
			label: () => m.ai_preset_short_caption_label(),
			text: () => m.ai_preset_short_caption_prompt(),
		},
		{
			label: () => m.ai_preset_detailed_description_label(),
			text: () => m.ai_preset_detailed_description_prompt(),
		},
		{
			label: () => m.ai_preset_keywords_label(),
			text: () => m.ai_preset_keywords_prompt(),
		},
		{
			label: () => m.ai_studio_describe_the_image(),
			text: () => m.ai_studio_describe_the_main_subject_and_visual_details(),
		},
		{
			label: () => m.ai_studio_write_alt_text(),
			text: () => m.ai_studio_write_concise_accessible_alt_text_for_this(),
		},
	],
	buildRequest: (values) => ({
		task: "caption",
		image: values.image,
		prompt: values.text || undefined,
	}),
	Fields: AiCaptionCard,
	Result: AiTextResult,
};
