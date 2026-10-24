/** Legacy names are live accessors, never copied values or a second configuration. */
export function withAliases<
	Source extends object,
	const Aliases extends Record<string, keyof Source>,
>(
	source: Source,
	aliases: Aliases,
): Source & { -readonly [Key in keyof Aliases]: Source[Aliases[Key]] } {
	for (const [alias, key] of Object.entries(aliases)) {
		Object.defineProperty(source, alias, {
			configurable: false,
			enumerable: false,
			get: () => source[key],
			set: (value: Source[typeof key]) => {
				source[key] = value;
			},
		});
	}
	return source as Source & {
		-readonly [Key in keyof Aliases]: Source[Aliases[Key]];
	};
}
/** Public keys win if a caller provides both spellings in an explicit override. */
export function featureEnabled(config: {
	enable?: boolean;
	enabled?: boolean;
}) {
	return config.enable ?? config.enabled ?? false;
}
