import { l } from "./copy";
/** Original CSS compositions, intentionally never represented as AI-generated output. */
export function AbstractArt({
	variant = "arch",
	className = "",
}: {
	variant?: "arch" | "orbit" | "bloom";
	className?: string;
}) {
	return (
		<div
			className={`lm-art lm-art-${variant} ${className}`}
			role="img"
			aria-label={l("original_abstract_illustration_not_an_ai_generated_image")}
		>
			<div className="lm-art-grain" />
			<span className="lm-art-sun" />
			<span className="lm-art-shape lm-art-shape-one" />
			<span className="lm-art-shape lm-art-shape-two" />
			<span className="lm-art-shape lm-art-shape-three" />
			<span className="lm-art-ground" />
			<span className="lm-art-line" />
		</div>
	);
}
