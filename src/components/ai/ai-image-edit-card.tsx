import { m } from "../../locale/paraglide/messages";
import type { AiToolCard, AiCardFieldsProps } from "./card-contract";
import { AiTextField, AiImageField, AiImageResult } from "./card-fields";

/** Editable avatar inputs, request mapping, presets, and result presentation. */
export function AiImageEditCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiImageField {...props} maxMb={5} />
			<AiTextField {...props} task="avatar" label={m.ai_studio_prompt()} />
		</>
	);
}
export const imageEditCard: AiToolCard = {
	id: "avatar",
	title: () => m.ai_studio_avatar_editing(),
	needsImage: true,
	presets: [
		{
			label: () => m.ai_preset_bobblehead_label(),
			text: () => m.ai_preset_bobblehead_prompt(),
		},
		{
			label: () => m.ai_preset_pixar_label(),
			text: () => m.ai_preset_pixar_prompt(),
		},
		{
			label: () => m.ai_preset_anime_label(),
			text: () => m.ai_preset_anime_prompt(),
		},
		{
			label: () => m.ai_studio_studio_portrait(),
			text: () =>
				m.ai_studio_transform_this_portrait_into_a_clean_professional(),
		},
		{
			label: () => m.ai_studio_watercolor(),
			text: () => m.ai_studio_create_a_gentle_watercolor_avatar_based_on(),
		},
	],
	buildRequest: (values) => ({
		task: "avatar",
		prompt: values.text,
		image: values.image,
	}),
	Fields: AiImageEditCard,
	Result: AiImageResult,
};
