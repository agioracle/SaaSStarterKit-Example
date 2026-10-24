import { m } from "../../locale/paraglide/messages";
import type { AiToolCard, AiCardFieldsProps } from "./card-contract";
import { AiTextField, AiModelField, AiImageResult } from "./card-fields";
import { FAL_IMAGE_MODELS } from "../../config/ai-models";

/** Editable fal-image inputs, request mapping, presets, and result presentation. */
export function AiImageCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiTextField {...props} task="fal-image" label={m.ai_studio_prompt()} />
			<AiModelField {...props} options={FAL_IMAGE_MODELS} />
		</>
	);
}
export const imageCard: AiToolCard = {
	id: "fal-image",
	title: () => m.ai_studio_image_generation_fal_ai(),
	presets: [],
	buildRequest: (values) => ({
		task: "fal-image",
		prompt: values.text,
		...(values.option ? { model: values.option } : {}),
	}),
	Fields: AiImageCard,
	Result: AiImageResult,
};
