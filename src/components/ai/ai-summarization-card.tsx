import { m } from "../../locale/paraglide/messages";
import type { AiToolCard, AiCardFieldsProps } from "./card-contract";
import { AiTextField, AiTextResult } from "./card-fields";

/** Editable summarize inputs, request mapping, presets, and result presentation. */
export function AiSummarizationCard(props: AiCardFieldsProps) {
	return (
		<AiTextField
			{...props}
			task="summarize"
			label={m.ai_studio_your_text()}
			placeholder={m.ai_studio_paste_50_500_characters_to_summarize()}
		/>
	);
}
export const summarizationCard: AiToolCard = {
	id: "summarize",
	title: () => m.ai_studio_summarization(),
	presets: [
		{
			label: () => m.ai_studio_product_update(),
			text: () => m.ai_studio_this_week_we_improved_account_security_added(),
		},
	],
	buildRequest: (values) => ({ task: "summarize", text: values.text }),
	Fields: AiSummarizationCard,
	Result: AiTextResult,
};
