import "@tanstack/react-start/server-only";
/** Authoritative editable Clef rubric and pure validation; no network execution. */
import { record, ServiceError, stringField } from "../ai/http.server";
import {
	DECISION_MODELS,
	type DecisionModel,
	type DecisionResult,
} from "../ai/types";

/** Independent support-ticket rubric. Wire types follow Cloudflare's published Clef schema. */
export const CLEF_QUESTIONS = {
	urgent: {
		type: "noul",
		instructions: "Does this ticket require an urgent response?",
	},
	team: {
		type: "choice",
		instructions: "Select the team best able to resolve the ticket.",
		criteria: {
			billing: "Invoice, charge, and refund requests",
			technical: "Service failures and configuration problems",
			sales: "Plan changes and purchase enquiries",
		},
	},
	severity: {
		type: "score",
		instructions: "Estimate the customer impact.",
		criteria: [
			"None",
			"Small inconvenience",
			"Significant disruption",
			"Complete outage",
		],
	},
} as const;
const TEAMS = ["billing", "technical", "sales"] as const;
const LEVELS = ["0", "1", "2", "3"] as const;
function invalid(): never {
	throw new ServiceError("UPSTREAM", "Clef returned invalid decision results");
}
function bounded(value: unknown, max = 1): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > max
	)
		return invalid();
	return value;
}
function distribution<T extends string>(
	value: unknown,
	keys: readonly T[],
): Record<T, number> {
	const source = record(value);
	if (
		Object.keys(source).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(source, key))
	)
		return invalid();
	const result = Object.fromEntries(
		keys.map((key) => [key, bounded(source[key])]),
	) as Record<T, number>;
	// Allow rounding at the API's decimal precision, but never normalize invalid probabilities.
	if (
		Math.abs(Object.values<number>(result).reduce((sum, p) => sum + p, 0) - 1) >
		0.01
	)
		return invalid();
	return result;
}
export function parseDecisionResult(
	value: unknown,
	expectedModel: DecisionModel,
): DecisionResult {
	const source = record(value);
	if (
		!DECISION_MODELS.includes(source.model as DecisionModel) ||
		source.model !== expectedModel
	)
		return invalid();
	const answers = record(source.answers);
	const urgent = record(answers.urgent);
	const team = record(answers.team);
	const severity = record(answers.severity);
	if (
		urgent.type !== "noul" ||
		team.type !== "choice" ||
		severity.type !== "score" ||
		!TEAMS.includes(team.choice as (typeof TEAMS)[number])
	)
		return invalid();
	const probabilities = distribution(team.probabilities, TEAMS);
	const choice = team.choice as (typeof TEAMS)[number];
	if (probabilities[choice] + 0.001 < Math.max(...Object.values(probabilities)))
		return invalid();
	const severityProbabilities = distribution(severity.probabilities, LEVELS);
	const score = bounded(severity.score, LEVELS.length - 1);
	const weighted = LEVELS.reduce(
		(sum, key) => sum + Number(key) * severityProbabilities[key],
		0,
	);
	if (Math.abs(score - weighted) > 0.02) return invalid();
	const legend = record(severity.legend);
	if (Object.keys(legend).length !== LEVELS.length) return invalid();
	const validatedLegend = Object.fromEntries(
		LEVELS.map((key) => [key, stringField(legend[key])]),
	) as Record<(typeof LEVELS)[number], string>;
	const usage = record(source.usage);
	if (
		![usage.input_tokens, usage.output_tokens].every(
			(n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
		)
	)
		return invalid();
	return {
		model: expectedModel,
		answers: {
			urgent: { type: "noul", noul: bounded(urgent.noul) },
			team: {
				type: "choice",
				choice,
				probabilities,
				confidence: bounded(team.confidence),
			},
			severity: {
				type: "score",
				score,
				probabilities: severityProbabilities,
				legend: validatedLegend,
				confidence: bounded(severity.confidence),
			},
		},
		usage: {
			input_tokens: usage.input_tokens as number,
			output_tokens: usage.output_tokens as number,
		},
	};
}

export { DECISION_MODELS } from "../config/ai-models";
export type { DecisionModel, DecisionResult } from "../ai/types";
