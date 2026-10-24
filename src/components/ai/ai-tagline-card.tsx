import { m } from "../../locale/paraglide/messages";
import type {
	AiToolCard,
	AiCardFieldsProps,
	AiCardResultProps,
} from "./card-contract";
import { AiTextField } from "./card-fields";

/** Editable taglines inputs, request mapping, presets, and result presentation. */
export function AiTaglineCard(props: AiCardFieldsProps) {
	return (
		<AiTextField {...props} task="taglines" label={m.ai_studio_your_text()} />
	);
}
function Result({ result }: AiCardResultProps) {
	return Array.isArray(result?.taglines) ? (
		<ol>
			{result.taglines
				.filter((line): line is string => typeof line === "string")
				.map((line) => (
					<li key={line}>{line}</li>
				))}
		</ol>
	) : null;
}
export const taglineCard: AiToolCard = {
	id: "taglines",
	title: () => m.ai_studio_saas_tagline_generator(),
	presets: [],
	buildRequest: (values) => ({ task: "taglines", text: values.text }),
	Fields: AiTaglineCard,
	Result: Result,
};
