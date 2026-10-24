# Lumina 开发参考

产品开发步骤和新增目录以 [模板到产品](template-baseline.md) 为准。以下保留最新模板的通用扩展契约；在 Lumina 中不要启用通用 `/api/ai` 路由替代产品的鉴权、额度、持久化和恢复流程。演示 fixture 只由本地脚本在独立副本中安装，正式源码不含测试供应商分支。

# Development and extension

## Architecture

- `src/routes`: file routes, protected loaders/middleware and API entrypoints.
- `src/auth`, `src/db`: Better Auth, Drizzle schemas and D1 integration.
- `src/payment`, `src/storage`, `src/cache`: server-side payment facts, private objects and advisory cache.
- `src/ai`, `src/mail`, `src/newsletter`, `src/notification`: bounded provider services and registries.
- `src/components`: shared UI, layout, production landing blocks and business settings.
- `messages`, `project.inlang`: one EN/ZH message source and locale generation.
- `content`: production Markdown. `tests/fixtures/blog`: synthetic/test-only article collections.
- `examples`: optional business recipes and illustrative layouts, not default production behavior.

Keep provider clients, secrets and Cloudflare bindings in server-only modules. Every protected API authorizes independently of navigation. Preserve same-origin mutations, raw webhook signatures, immutable payment identity and owner checks. Hidden menus never authorize an operation.

## Branding and pages

`websiteConfig.metadata.name/title/description` resolves at render time; edit its defaults or `messages/*` `site_*` entries. Do not cache localized metadata in module-level variables. Header, footer, account pages and article fallback branding use that configuration. Replace the supplied logo/OG assets and `public/manifest.webmanifest` for your product.

Navigation owners are `navbar-config.ts`, `footer-config.ts`, `sidebar-config.ts`, `avatar-config.ts`, `social-config.ts`. Public `Routes`, locale helpers and menu types remain available. Role arrays use exact role matches; empty arrays hide an item. New API endpoints still need server-side authorization.

The default homepage composes hero, features, optional configured pricing, FAQs and optional newsletter. Original illustrative cards/testimonials/layouts moved to `examples/landing-page`; they must not be presented as real customers or revenue. Dashboard sample charts are explicitly labeled examples and closed by default; real business metrics need your own source.

## Content

Production blog posts live in `content/blog`; use `.zh.md` for the Chinese translation. The welcome article is a starting guide, not a content library. Frontmatter requires title, description, date, category, image and optional `published` (defaults true). Add real image dimensions/variants when known.

`published:false` is excluded at generation time, including metadata, bodies and maps. Full post helpers are server-only; listing queries return summaries so article bodies do not enter client bundles. Preserve canonical/hreflang and sensitive-page `noIndex` handling. Legal examples are mandatory replacement material before launch.

`npm run locale:check`, `locale:sort` and `locale:compile` manage one message inventory. Build generates routes/content/locales before typechecking. A changed provider response or custom feature is not automatically translated.

## Business entities and services

Start with [private notes](../examples/private-notes/README.md): schema, API, owner checks, UI, paid-ledger gate and tests. Its installer previews changes by default, refuses collisions/symlinks and requires an exact target confirmation for writes. It does not migrate or deploy automatically. The extension client example demonstrates the limited authenticated bridge, not a complete extension store product.

Use the existing service registries to add a provider. Payment adapters must verify signed/mode/merchant authority and return normalized facts; an arbitrary callback cannot grant access. Cache is advisory. New mail templates share one runtime/preview component; see the [mail reference](../src/mail/README.md). Custom AI models need reviewed weights, provider limits and failure semantics.

## Verification

`npm run check` performs build/types/lint plus complete unit/integration tests. `test:worker`, `test:browser` and `test:production` create credential-excluding copies and synthetic local databases. Pagination articles are seeded **only** into those copies. Test suites use existing supported browsers; no script silently installs one or turns on system remote automation.

`npm run test:production` runs HTTP and browser suites with separate local state, then a separate captured-mail browser checkout. The mail boundary captures delivery, while the real auth handler still requires verification. Never deploy this fixture build or use its fixed test accounts/secrets in an application.

`npm run test:performance` compares isolated baseline/content-scale builds and checks SSR/cache/SEO/bundle budgets. It is not Lighthouse or field CWV. Optional local Lighthouse diagnostics require explicitly installed tools, preserve simulated and DevTools results separately, and cap each sample at 90 seconds. `npm run email:dev` is template preview only. Component controls are available at `/developer/components` in development and return 404 in production.
