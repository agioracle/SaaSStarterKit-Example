import { m } from "../../locale/paraglide/messages";
import type {
	AiToolCard,
	AiCardFieldsProps,
	AiCardResultProps,
} from "./card-contract";
import { AiTextField, AiModelField } from "./card-fields";
import { SEARCH_PROVIDERS } from "../../config/ai-models";
import { ArrowUpRight } from "lucide-react";
import { validSearchResults } from "../../lib/web-search";

/** Editable web-search inputs, request mapping, presets, and result presentation. */
export function AiWebSearchCard(props: AiCardFieldsProps) {
	return (
		<>
			<AiTextField
				{...props}
				task="web-search"
				label={m.ai_studio_search_query()}
			/>
			<AiModelField {...props} options={SEARCH_PROVIDERS} />
		</>
	);
}
function Result({ result }: AiCardResultProps) {
	const items = validSearchResults(result?.items);
	return (
		<div className="search-results">
			{items.map((item, index) => (
				<a href={item.url} target="_blank" rel="noreferrer" key={item.url}>
					<strong>
						<span className="result-number">{index + 1}</span>
						{item.title}
						<ArrowUpRight size={15} />
					</strong>
					<p>{item.description}</p>
					<small>{item.hostname}</small>
				</a>
			))}
		</div>
	);
}
export const webSearchCard: AiToolCard = {
	id: "web-search",
	title: () => m.ai_studio_web_search(),
	presets: [
		{
			label: () => m.ai_preset_travel_label(),
			text: () => m.ai_preset_travel_prompt(),
		},
		{
			label: () => m.ai_preset_english_label(),
			text: () => m.ai_preset_english_prompt(),
		},
		{
			label: () => m.ai_preset_dinner_label(),
			text: () => m.ai_preset_dinner_prompt(),
		},
		{
			label: () => m.ai_studio_cloudflare_news(),
			text: () => m.ai_studio_what_are_the_latest_cloudflare_workers_product(),
		},
		{
			label: () => m.ai_studio_product_research(),
			text: () => m.ai_studio_how_do_small_saas_teams_validate_demand(),
		},
	],
	buildRequest: (values) => ({
		task: "web-search",
		query: values.text,
		...(values.option ? { provider: values.option } : {}),
	}),
	Fields: AiWebSearchCard,
	Result: Result,
};
