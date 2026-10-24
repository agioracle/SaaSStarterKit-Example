import { m } from "../../locale/paraglide/messages";
import type {
	AiToolCard,
	AiCardFieldsProps,
	AiCardResultProps,
} from "./card-contract";
import { AiTextField, AiModelField } from "./card-fields";
import { DECISION_MODELS } from "../../config/ai-models";
import type { DecisionResult } from "../../ai/types";
import { Notice } from "../ui/primitives";

/** Editable decision inputs, request mapping, presets, and result presentation. */
export function AiDecisionCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiTextField {...props} task="decision" label={m.ai_studio_your_text()} />
			<AiModelField {...props} options={DECISION_MODELS} />
		</>
	);
}
function Result({ result }: AiCardResultProps) {
	return result?.answers ? (
		<DecisionOutput result={result as unknown as DecisionResult} />
	) : null;
}
export const decisionCard: AiToolCard = {
	id: "decision",
	title: () => m.ai_studio_decision(),
	presets: [
		{
			label: () => m.ai_studio_billing_ticket(),
			text: () => m.ai_studio_i_was_charged_twice_for_my_annual(),
		},
		{
			label: () => m.ai_studio_service_outage(),
			text: () => m.ai_studio_our_entire_team_cannot_sign_in_production(),
		},
	],
	buildRequest: (values) => ({
		task: "decision",
		text: values.text,
		...(values.option ? { model: values.option } : {}),
	}),
	Fields: AiDecisionCard,
	Result: Result,
};

function DecisionOutput({ result }: { result: DecisionResult }) {
	const { urgent, team, severity } = result.answers;
	const percentage = (value: number) => `${Math.round(value * 100)}%`;
	return (
		<div className="decision-output">
			<Notice>
				{m.ai_studio_model_predictions_not_verified_facts_review_the()}
			</Notice>
			<div className="grid three">
				<div>
					<span>{m.ai_studio_urgent_probability()}</span>
					<strong>{percentage(urgent.noul)}</strong>
				</div>
				<div>
					<span>{m.ai_studio_suggested_team()}</span>
					<strong>{team.choice}</strong>
					<small>
						{percentage(team.confidence)} {m.ai_studio_confidence()}
					</small>
				</div>
				<div>
					<span>{m.ai_studio_severity_score()}</span>
					<strong>{severity.score.toFixed(2)} / 3</strong>
					<small>
						{percentage(severity.confidence)} {m.ai_studio_confidence()}
					</small>
				</div>
			</div>
			<h3>{m.ai_studio_team_probabilities()}</h3>
			{Object.entries(team.probabilities).map(([name, value]) => (
				<div className="probability-row" key={name}>
					<span>{name}</span>
					<meter min={0} max={1} value={value} />
					<span>{percentage(value)}</span>
				</div>
			))}
			<h3>{m.ai_studio_severity_probabilities()}</h3>
			{Object.entries(severity.probabilities).map(([level, value]) => (
				<div className="probability-row" key={level}>
					<span>
						{level}: {severity.legend[level as keyof typeof severity.legend]}
					</span>
					<meter min={0} max={1} value={value} />
					<span>{percentage(value)}</span>
				</div>
			))}
			<p className="fine-print">
				{result.model} ·{" "}
				{m.ai_usage_tokens({
					input: result.usage.input_tokens,
					output: result.usage.output_tokens,
				})}
			</p>
		</div>
	);
}
