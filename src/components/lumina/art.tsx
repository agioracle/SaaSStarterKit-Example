import { l } from "./copy";
/** Original vector proof studies. Explicit shapes, not generated model results. */
export function AbstractArt({
	variant = "arch",
	className = "",
}: {
	variant?: "arch" | "orbit" | "bloom";
	className?: string;
}) {
	return (
		<svg
			className={`lm-art lm-art-${variant} ${className}`}
			viewBox="0 0 640 560"
			role="img"
			aria-label={l("original_abstract_illustration_not_an_ai_generated_image")}
		>
			<rect width="640" height="560" fill="#d9d7cb" />
			{variant === "arch" ? (
				<>
					<rect x="100" y="66" width="232" height="420" fill="#58405f" />
					<circle cx="393" cy="244" r="151" fill="#c5a25c" />
					<rect x="331" y="244" width="62" height="242" fill="#f5f3eb" />
				</>
			) : variant === "orbit" ? (
				<>
					<circle cx="316" cy="280" r="192" fill="#b99b5b" />
					<circle cx="316" cy="280" r="104" fill="#dedbd0" />
					<rect x="80" y="300" width="480" height="99" fill="#58405f" />
				</>
			) : (
				<>
					<rect x="92" y="80" width="456" height="400" fill="#58405f" />
					<circle cx="250" cy="200" r="101" fill="#ece7d8" />
					<circle cx="390" cy="350" r="101" fill="#c5a25c" />
				</>
			)}
		</svg>
	);
}
