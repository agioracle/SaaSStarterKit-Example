import type { ComponentType } from "react";
import type { AiTask } from "../../ai/navigation";

/** Independent starter contract, not an assertion about unpublished reference props. */
export interface AiCardValues {
	text: string;
	image: string;
	option: string;
	source: string;
	target: string;
}
export interface AiCardFieldsProps {
	values: AiCardValues;
	onChange(patch: Partial<AiCardValues>): void;
	onError(message: string): void;
	snapshot(): () => boolean;
}
export interface AiCardResultProps {
	result: Record<string, unknown> | null;
	audio: string;
}
export interface AiToolCard {
	id: AiTask;
	title(): string;
	needsImage?: boolean;
	presets: readonly { label(): string; text(): string }[];
	buildRequest(values: AiCardValues): Record<string, unknown>;
	Fields: ComponentType<AiCardFieldsProps>;
	Result: ComponentType<AiCardResultProps>;
}
