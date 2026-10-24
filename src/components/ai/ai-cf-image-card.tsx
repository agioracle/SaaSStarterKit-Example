import { m } from "../../locale/paraglide/messages";
import type { AiToolCard, AiCardFieldsProps } from "./card-contract";
import { AiTextField, AiModelField, AiImageResult } from "./card-fields";
import { WORKERS_IMAGE_MODELS } from "../../config/ai-models";

/** Editable workers-image inputs, request mapping, presets, and result presentation. */
export function AiCfImageCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiTextField
				{...props}
				task="workers-image"
				label={m.ai_studio_prompt()}
			/>
			<AiModelField {...props} options={WORKERS_IMAGE_MODELS} />
		</>
	);
}
export const cfImageCard: AiToolCard = {
	id: "workers-image",
	title: () => m.ai_studio_image_generation_workers_ai(),
	presets: [],
	buildRequest: (values) => ({
		task: "workers-image",
		prompt: values.text,
		...(values.option ? { model: values.option } : {}),
	}),
	Fields: AiCfImageCard,
	Result: AiImageResult,
};
