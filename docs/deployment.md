# Lumina 部署流程

本轮只发布源码；未执行生产部署、远程迁移或凭据创建。不要部署 `.local-smoke/` 生成的 fixture 副本。Cloudflare 配置使用 `wrangler.jsonc` 的 `DB`（D1）、`BUCKET`（私有 R2）、`CACHE`（KV），资源名为示例，ID 为占位。先配置独立测试资源，按下文设置 Worker secrets、公开构建 URL、支付产品和签名模式，再从干净源码构建。正式启用 AI 前先完成 [产品约束](product.md) 和 [真实供应商验收](provider-acceptance.md)。旧数据库按 [升级说明](operations.md) 应用追加迁移，禁止 schema push 替代。

# Deploy to Cloudflare Workers

This guide performs real operations only when **you** execute them. The repository's verification CI never deploys, migrates a remote database or calls a paid provider. No deployment workflow is enabled by default.

## 1. Separate environments

Use separately reviewed checkouts/configuration for disposable test and production deployments. Give each a distinct Worker, D1 database, R2 bucket, KV namespace, domain, authentication secret and provider test/live settings. Do not reuse a paid test database as production or switch its payment identity.

Use your existing Cloudflare login or an appropriately scoped deployment token through a secret manager. Typical provisioning/deployment capabilities are Worker scripts, selected D1/R2/KV resources and any required route/domain management. Limit them to the relevant account/resources. Runtime mail/AI/payment secrets are separate from deployment credentials. Do not commit account/resource IDs or real credentials to this public template.

The optional CLI in [scripts/README.md](../scripts/README.md) supports dry-run plans, exact project confirmation, selected stages, create/adopt and interrupted-operation reconciliation. Named Wrangler `env` blocks are deliberately not the CLI's environment-isolation mechanism. Existing resources require explicit adoption; uncertain creates must be inspected before retrying.

## 2. Provision or identify resources

Using the Cloudflare dashboard or reviewed Wrangler commands, create/identify the environment's D1 database, private R2 bucket and KV namespace. Replace the placeholders in your private deployment configuration:

- Worker `name`.
- `DB` database name/ID and `migrations_dir: drizzle`.
- `BUCKET` bucket name; do not expose a public bucket for private user files.
- `CACHE` namespace ID.
- Runtime `APP_ENV=production`, HTTPS `APP_URL` and reviewed `MAINTENANCE_ENABLED`.
- Exact route/custom domain if you use one; do not guess a workers.dev account subdomain.

Apply the same requirements to a public test deployment; distinguish it through its resources and `PAYMENT_MODE=test`, not by sharing the production database.

## 3. Configure public values and secrets

Set the deployment's public `.env.production` values, especially matching HTTPS `VITE_BASE_URL`. Only selected provider public product IDs and optional analytics/chat IDs belong in `VITE_*`.

Configure runtime secrets with the Cloudflare dashboard or individual `wrangler secret put NAME` operations against the exact reviewed Worker/config. Enter values securely when prompted, never in shell arguments or documentation. At minimum configure `BETTER_AUTH_SECRET` and the selected authentication mail provider. Add OAuth/payment/AI secrets only when enabling those services. The deploy token is not automatically copied to Worker runtime.

`npm run doctor -- --profile deploy` validates local prerequisites/configuration shape; `--check-auth` is an additional explicit remote read. Neither proves provider delivery or runtime readiness. Review CLI plans before authorizing their selected stages.

## 4. Migrate and build

For a new local database, apply all local migrations first. For an existing environment, follow the backup and compatibility checks in [Operations](operations.md), review every SQL file, then explicitly apply pending migrations to the exact remote D1. Remote migration is separate from deployment and is never triggered by verification CI.

Typical operator sequence, after selecting the correct private configuration:

```sh
npm ci
npm run check
npm run i18n:check
npm run db:migrate:local
# Review pending SQL and take/verify the remote backup before the remote step.
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
npm run build
npx wrangler deploy --config wrangler.jsonc
```

The last two Wrangler commands are actual remote operations. Do not execute them with the repository's placeholder configuration. The existing guarded CLI can instead execute separately approved migrate/build/deploy stages with an exact project confirmation and capability allowlist; see its reference. Ensure production public values are present for the **final** build, while unit tests use their own isolated fixture origins.

## 5. Accept the deployment

- Check `/api/health` and `/api/ready`; admins can inspect protected readiness detail. A green health probe is not business acceptance.
- Test email verification/reset, Google if enabled, session revocation, account settings and protected pages.
- Test private file upload/download/delete and owner isolation.
- For payments, configure `/api/webhooks/PROVIDER`, preserve raw bytes/signatures, test duplicate/out-of-order events, cancellation/refund/expiry and return pages. A return URL is not proof of payment.
- Confirm scheduled maintenance runs and drain/observe cleanup failures. Local development does not automatically trigger schedules.
- Validate monitoring, backup restore, rollback and your actual legal/privacy notices.

Keep checkout/AI disabled until their acceptance succeeds. Use the [provider checklist](provider-acceptance.md); this template does not certify external accounts or live services.
