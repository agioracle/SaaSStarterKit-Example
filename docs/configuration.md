# Lumina 配置要点

默认 AI 与付费 checkout 均关闭；价格页仍显示明确标记的示例套餐。正式生成接口为 `/api/generations`，`/api/ai` 固定 410。模板其他 AI 适配器仅保留为开发参考。真实图像生成需在 `src/config/website.ts` 设置 `ai.enabled=true`，审阅有限每日预算，同时设置服务端 `IMAGE_GENERATION_ENABLED=true`。配置 `FAL_API_KEY`，或 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_AI_API_TOKEN`，不需要 OpenAI 凭据。

`IMAGE_FREE_MONTHLY_LIMIT=10`、`IMAGE_PRO_MONTHLY_LIMIT=200`、`IMAGE_FREE_RETAINED_LIMIT=30`、`IMAGE_PRO_RETAINED_LIMIT=500`、`IMAGE_MAX_CONCURRENT=2` 为示例默认；每日安全容量另行限制。Google OAuth 未配置时应先关闭 `websiteConfig.auth.enableGoogleLogin`。账户注册验证需真实邮件；无密钥演示使用 README 的隔离 fixture，不放宽正常鉴权。

# Configuration

## Configuration boundaries

- `src/config/website.ts` selects features/providers and resolves brand metadata. Related editable files are in `src/config/`.
- `.env` contains **public, build-time** `VITE_*` values. They enter browser bundles; never put credentials there.
- `.dev.vars` contains local Worker runtime values. Deployed values belong in Worker variables/secrets. Examples ship blank credentials and placeholder resource IDs.
- Restart development after runtime changes; rebuild after public build-time changes. `VITE_BASE_URL` and runtime `APP_URL` must have the same origin, including port. Production uses HTTPS.
- Stable legacy identifiers such as the `edgekit` package marker, `ek_` key prefix and storage keys remain compatibility details. Branding is configured independently; do not rename identifiers on an operating database casually.

## Feature matrix

| Feature | Public/source configuration | Runtime configuration | Default / acceptance |
|---|---|---|---|
| Site | `metadata`, messages, `VITE_BASE_URL` | `APP_URL`, `APP_ENV` | Local preview; replace brand, content and domain |
| Email/password | `auth.enable`, `enableCredentialLogin` | `BETTER_AUTH_SECRET`, mail provider | Enabled; secret/mail required for actual registration |
| Google | `auth.enableGoogleLogin` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Button appears only when configured; actual OAuth must be tested |
| D1 | `wrangler.jsonc` DB binding | D1 binding `DB` | Local migrations; supply environment-specific remote ID |
| Private files | `storage.enable/maxFileSize/allowedTypes/userFilesFolder` | R2 binding `BUCKET` | Enabled; owner checks and attachment delivery |
| Cache | `cache.enable/provider/ttl` | KV binding `CACHE` | Advisory cache; never authorization or payment authority |
| Mail | `mail.provider/fromEmail/supportEmail` | Selected provider credentials below | Enabled for authentication; no delivery simulation |
| Newsletter | `newsletter.enable/provider` | Selected provider key/list | Disabled; explicit consent required even when automatic opt-in UI is enabled |
| Payments | `VITE_PAYMENT_PROVIDER`, `payment.price.plans`, provider price IDs | `PAYMENT_MODE`, selected provider secrets | Disabled; verify signed events before granting access |
| AI | `websiteConfig.ai`, `src/config/ai-models.ts` | Selected model/provider credentials | Disabled; capacity limits are not currency or a cost guarantee |
| Notifications | `notification.enable/provider` | Discord/Feishu webhook credentials | Disabled; delivery is best effort |
| Analytics/chat | Optional public `VITE_*` IDs | None for browser scripts | Disabled without IDs; sensitive pages are excluded |

## Minimal registration setup

Keep Google, newsletter, payments, notifications and AI disabled initially. In `website.ts`, choose mail provider `resend`, set `mail.enable=true`, and keep `auth.enableCredentialLogin=true`. Configure locally:

```dotenv
APP_URL=http://localhost:3000
APP_ENV=development
BETTER_AUTH_SECRET=
RESEND_API_KEY=
MAIL_FROM_EMAIL=
MAIL_SUPPORT_EMAIL=
```

Supply a unique strong secret of at least 32 characters from your secret manager and a Resend key restricted to your verified sending domain. Fill the real verified sender/support mailbox yourself; do not use fixture addresses for delivery. The application accepts one bare mailbox or display-name mailbox, not arbitrary address lists. Source-configured addresses take precedence over runtime aliases.

Cloudflare mail instead uses `CLOUDFLARE_ACCOUNT_ID` and a dedicated `CLOUDFLARE_EMAIL_API_TOKEN`, plus a verified sender. Sending eligibility depends on your Cloudflare account/domain. Do not install the deployment token as an application mail secret. [Mail reference](../src/mail/README.md).

Restart, run `npm run doctor -- --profile auth`, then register, receive and follow the verification email, sign out/in, reset a password and verify anonymous protection. Doctor checks configuration shape, not delivery. `npm run email:dev` only renders templates; it does not verify an inbox or send.

## Storage and database

Run `npm run db:migrate:local` for a new local database. Auth and application schemas are in `src/db/`; reviewed migrations are in `drizzle/`. Never reset an operating database to match a template.

R2 files are private, identified in D1 and scoped to their owner. The default maximum is 10 MiB; an empty extension allowlist still applies content validation and safe attachment handling. No antivirus or aggregate commercial storage quota is claimed. KV failures fall back to the source; KV is eventually consistent. [Storage reference](../src/storage/README.md).

## Payments

Choose exactly one current provider with `VITE_PAYMENT_PROVIDER=stripe|creem|waffo`. Configure the matching public price/product IDs and the server's plan map. Keep test and live D1, credentials, mode and payment namespace separate. `PAYMENT_MODE` is explicit. Retained providers and their historical price maps must remain configured to manage existing customers.

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and price mappings.
- Creem: `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET` and product mappings.
- Waffo: `WAFFO_STORE_ID`, `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY` and product mappings. SDK signature verification and store/mode checks remain mandatory.

Checkout redirects never authorize access. Read [webhook, ledger and reconciliation contracts](../src/payment/README.md) before enabling checkout; use the provider-acceptance guide before launch.

## AI and optional services

AI is disabled in `src/ai/policy.ts`. Enabling it requires an explicit owner decision, server-side provider keys and reviewed per-user/global request, weighted capacity and concurrency limits. Weights are capacity estimates, not dollars, subscription credits or prepaid balances. Request IDs persist across reloads; uncertain dispatched work must be checked instead of blindly retried. Provider errors can still incur cost.

Cloudflare AI uses its dedicated account/API token configuration; fal and search providers have separate keys. Do not enable everything just to make a demo button work. Newsletter requires explicit user consent and the configured provider/list. Notifications, analytics and Crisp require their own provider acceptance and privacy review. See `.env.example`, `.dev.vars.example` and source-adjacent adapter references for the complete variable inventory.
