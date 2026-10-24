# Localization customization

`messages/{locale}.json` at the repository root is the only message catalog. This is an intentional path difference from the reference documentation's `project.inlang/messages/{locale}.json`: the configured `plugin.inlang.messageFormat.pathPattern` resolves to the root catalog. Do not create a second copy under `project.inlang/messages`. Generated files under `src/locale/paraglide` are build output, never hand-edited. UI copy uses typed, module-prefixed `m.*()` functions, with named interpolation values rather than assembled translated sentences. Message functions are called during a request/render, not at module initialization.

To add a language:

1. Add its BCP-47 code to `project.inlang/settings.json` (`locales`). Keep `baseLocale` in that list.
2. Add a complete `messages/<locale>.json` with matching keys and interpolation names. Translate the content; copying English is not a completed translation.
3. Add its name, optional flag and hreflang to `localeConfig` in `src/lib/locale.ts`. The selector renders these names and flags, and SEO uses the same language tags. Unknown display names fall back to the locale's native display name.
4. Add translated content files such as `content/blog/welcome.<locale>.md`. Content without a configured locale suffix belongs to `baseLocale`. Missing translated legal/blog pages fall back to the available base-language route, not a fabricated translation.
5. Run `npm run locale:check`, `npm run locale:compile`, and `npm run check`. Vite and the compiler share URL patterns derived from the configured locale inventory; the unprefixed base catch-all stays last.

`src/lib/locale.ts` is the public runtime entrypoint for configuration and locale URL helpers. Keep build tools on the pure `src/config/locale-settings.ts` module: importing the runtime entrypoint from Vite before Paraglide has generated its files would break clean builds.

`src/components/layout/locale-switcher.tsx` owns the real language selector used by the shell. Changing languages preserves the current path, query string and anchor; unsupported locale values do not trigger navigation.

Add fully translated static routes to `LOCALIZED_PATHS` in `src/lib/locale.ts`. Only listed routes receive implicit hreflang alternates, and the sitemap reads this same registry while retaining feature-flag and private-route exclusions. Content routes pass `alternateLocales` for real translations; an unknown route does not claim translations exist. Missing translations must still redirect to real content rather than only changing metadata.

The checker validates all configured catalogs, interpolation parity and absence of inline bilingual `t()` calls. It does not certify custom merchant copy, user content, AI/provider output, API errors, proper names or illustrative code samples as translated. Backend diagnostic text and transactional emails remain English. Default starter plan copy has a UI message registry; custom plan copy must be explicitly added there or is displayed unchanged.

Calendar values use UTC civil dates. Pass `initialMonth` or `selected` for immediate deterministic SSR. Without either, a localized loading state is server-rendered and the current UTC month appears after hydration. Caller-provided labels/data in generic tables/charts remain the caller's localization responsibility.

Landing blocks have independent implementations in `src/components/blocks/*.tsx`; `homepage.tsx` only composes/re-exports them. Edit each block's layout there and its text in the catalog.
