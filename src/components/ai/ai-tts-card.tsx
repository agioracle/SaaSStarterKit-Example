import { m } from "../../locale/paraglide/messages";
import type {
	AiToolCard,
	AiCardFieldsProps,
	AiCardResultProps,
} from "./card-contract";
import { AiTextField, AiModelField } from "./card-fields";
import { SPEECH_VOICES } from "../../config/ai-models";

/** Editable speech inputs, request mapping, presets, and result presentation. */
export function AiTtsCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiTextField {...props} task="speech" label={m.ai_studio_your_text()} />
			<AiModelField {...props} options={SPEECH_VOICES} />
		</>
	);
}
function Result({ audio }: AiCardResultProps) {
	return audio ? (
		<audio controls src={audio}>
			<track kind="captions" />
		</audio>
	) : null;
}
export const ttsCard: AiToolCard = {
	id: "speech",
	title: () => m.ai_studio_text_to_speech(),
	presets: [],
	buildRequest: (values) => ({
		task: "speech",
		text: values.text,
		...(values.option ? { voice: values.option } : {}),
	}),
	Fields: AiTtsCard,
	Result: Result,
};
