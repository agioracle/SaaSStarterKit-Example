# Independent setup and deployment CLI

This is original implementation code for this starter, not TanStarter's CLI or its proprietary application. It models the public setup workflow but deliberately separates resource creation, application deployment, source push, and credential transmission. It does not download a paid template, create API tokens, log in automatically, install global tools, or silently provision payment accounts.

## Safety contract

Every action defaults to **dry-run**. `plan`, and every command without `--execute`, perform no external requests, subprocess executions, or file changes. `doctor` is the explicit exception: it runs read-only local tool/version checks; `doctor --check-auth` additionally checks authenticated provider access without mutations.

Actual operations require all of:

1. `--execute`.
2. `--confirm PROJECT`, matching the exact manifest project.
3. `--allow STAGE,...`, listing every selected capability.

There is no blanket `--yes` or wildcard allowlist. CLI arguments contain no secret values. A lock prevents simultaneous mutating runs in a project. Provider/child error bodies are suppressed because tools may echo secrets. Network/command uncertainty is journaled instead of silently retried. Provider/process tests use isolated fixtures; live operations require your own environment acceptance.

## Quick start: local setup first

From the starter root:

```sh
npm run setup -- create my-app --domain app.example.com --account-id YOUR_32_HEX_ACCOUNT_ID
# Review the dry-run; then initialize config and copy local env examples:
npm run setup -- create my-app --domain app.example.com --account-id YOUR_32_HEX_ACCOUNT_ID \
  --execute --confirm my-app --allow create
npm run doctor
npm run setup -- plan
```

The account placeholder must be replaced by a real 32-character account identifier even for validation. `--origin https://my-app.account.workers.dev` can replace `--domain` for a workers.dev deployment; the CLI does not guess the account subdomain. A custom domain must already belong to the selected Cloudflare account.

To copy the **local original starter** to a new sibling directory, add `--directory ../my-app` to `create`. The target must not exist and cannot be nested inside the source. Git history, symlinks, dependencies, output, CLI state, common env files, PEM/key files, and backups are excluded. Existing config files are not overwritten. No GitHub/private template cloning takes place. Review your own additional files before copying; filename exclusions are not a complete secret scanner.

`create` writes `.saas/setup.json` and copies `.env.example`/`.dev.vars.example` when absent. It does not generate authentication secrets. Supply a unique strong `BETTER_AUTH_SECRET` yourself through the documented secure workflow. Run from the new root after copying.

## Non-secret manifest

`.saas/setup.json` has a strict, versioned schema:

```json
{
  "schemaVersion": 1,
  "project": "my-app",
  "accountId": "<CLOUDFLARE_ACCOUNT_ID>",
  "domain": "app.example.com",
  "origin": "https://app.example.com",
  "repository": "my-owner/my-app",
  "githubEnvironment": "production",
  "payment": "none",
  "resources": {
    "d1": { "name": "my-app-db" },
    "r2": { "name": "my-app-files" },
    "kv": { "name": "my-app-cache" }
  }
}
```

Do not place credentials or env values in this manifest or the state journal. Account IDs and resource IDs are identifiers, not authentication credentials. `--config PATH`, `--state PATH`, and `--directory PATH` select explicit local files/project roots. Named Wrangler `env` blocks are intentionally refused; use separately reviewed project directories/manifests for staging and production. Project/resource names are conservative lowercase DNS-like names.

## Provision or adopt resources

Export a least-privilege `CLOUDFLARE_API_TOKEN` in your shell using your own secure secret manager. The CLI never creates or saves it. If `CLOUDFLARE_ACCOUNT_ID` is also exported, it must match the manifest.

```sh
npm run setup -- apply
npm run setup -- apply --execute --confirm my-app --allow provision,configure
```

Default `apply` selects **only** `provision,configure`:

- Query exact configured names before creating D1/R2/KV.
- Refuse a preexisting matching name until explicitly adopted.
- Record each successful resource immediately with `created` ownership.
- Verify recorded IDs and names on every resume. Missing/drifted resources are not automatically recreated.
- Update DB / BUCKET / CACHE bindings, Worker name, account, production origin, and optional exact custom-domain route in `wrangler.jsonc`. Existing source/compatibility settings are preserved; existing domain routes are replaced by the selected route, or removed when no domain is selected.
- Preserve one local Wrangler backup and write only allowlisted public build values to `.env.production`.

To adopt existing resources, put exact IDs in the manifest or pass flags. Set D1/KV resource names in the manifest to match the actual provider names; IDs alone are not sufficient:

```sh
npm run setup -- adopt --database-id UUID --bucket existing-bucket --kv-id KV_ID
npm run setup -- adopt --database-id UUID --bucket existing-bucket --kv-id KV_ID \
  --execute --confirm my-app --allow provision,configure
```

`adopt` never creates missing resources. Adopted resources are never eligible for CLI deletion. For `apply`, a mixture of explicit existing IDs and new names is supported.

## Resume and failure recovery

```sh
npm run setup -- resume
npm run setup -- resume --execute --confirm my-app --allow provision,configure
```

`.saas/state.json` contains schema version, project/account, resource IDs/names/ownership, completed stage names, and a pending operation marker. It contains **no secret values**, copies of provider responses, or secret digests. State writes use mode 0600 and atomic rename.

- A definite rejected create request clears its pending marker; correct the account/permissions/configuration and resume.
- A timeout or ambiguous create response keeps the marker. Inspect the exact name in the account, then adopt its exact ID. Matching a name alone does not prove ownership, so such recovery is intentionally recorded as `adopted`.
- If provider inspection establishes that an uncertain create did not happen, remove only that pending marker from the local journal after reviewing the result; never delete the whole journal to retry.
- Uncertain remote migration/deployment/secret-sync/repository outcomes block blind retries. Inspect the exact target and reconcile only the pending marker locally, then run the explicit stage again.
- A crashed process may leave `.saas/execution.lock`. Confirm the process has stopped before removing that lock. Do not run parallel setup commands for one project.
- Completed stage markers are an audit trail, not a stale-input cache. Explicitly selected builds/migrations/secret syncs rerun; resource IDs are verified and reused. D1 tracks which migrations have already applied.

## Install, migrate, build, deploy

Stages are always dependency-ordered. Only requested stages run:

```sh
npm run setup -- apply --steps install,migrate-local,build
npm run setup -- apply --steps install,migrate-local,build \
  --execute --confirm my-app --allow install,migrate-local,build

npm run setup -- migrate                         # local D1 plan
npm run setup -- migrate --execute --confirm my-app --allow migrate-local
npm run setup -- migrate --remote                # separate remote plan
npm run setup -- migrate --remote --execute --confirm my-app --allow migrate-remote

npm run setup -- deploy                          # build + deploy plan
npm run setup -- deploy --execute --confirm my-app --allow build,deploy
```

`install` is `npm ci` using the independent starter's lockfile. Local migration uses Wrangler `--local`; remote migration uses `--remote`, the verified DB binding, and an exact-account token. Production migrations never run inside `check`, `build`, or `deploy` implicitly. Back up/review migrations before explicitly applying them remotely.

Deployment requires a build in the same invocation; stale standalone deploy stages are refused. Build receives allowlisted public variables, not inherited deployment/application credentials. Deployment receives the selected account/token only. `.env.production` should contain **public build values only**. It is never a source for unfiltered bulk secret upload.

Run the application's validation commands and local production smoke tests before deployment. A successful CLI deploy process is not proof of successful health checks, payment webhooks, OAuth, mail delivery, or live-provider readiness. This CLI does not automatically contact the deployed application.

## Three explicit environment categories

| Category | Source/destination | Rule |
| --- | --- | --- |
| Public browser build variables | `.env.production`, GitHub Actions `vars.VITE_*` | Explicit allowlist; baked into the browser bundle; never secret |
| Worker runtime settings/secrets | A separately selected private env file → Worker secrets | Exact allowlist in `scripts/cli/secrets.ts`; sent as JSON via stdin |
| Provision/deploy credentials | Shell for Cloudflare; selected private env file → GitHub Actions secrets | `CLOUDFLARE_API_TOKEN` is never a Worker secret |

`CLOUDFLARE_ACCOUNT_ID` is the deliberate non-secret dual-use exception: mail/AI runtime adapters need the account identifier, and CI needs it as a GitHub variable. Runtime email/AI use separate scoped `CLOUDFLARE_EMAIL_API_TOKEN` / `CLOUDFLARE_AI_API_TOKEN`. The broad deployment-token runtime fallback is deliberately not synced. Empty values are skipped. Unknown non-empty keys cause an error before any upload, preventing surprise `VITE_SECRET_KEY` exposure. Environment files support comments, quoted/multiline values and escaped newlines but never evaluate shell expressions/interpolation.

```sh
npm run sync-worker-secrets -- --env-file .dev.vars.production
npm run sync-worker-secrets -- --env-file .dev.vars.production \
  --execute --confirm my-app --allow worker-secrets

npm run sync-github-secrets -- --env-file .env.production --public-vars
npm run sync-github-secrets -- --env-file .env.production --public-vars \
  --execute --confirm my-app --allow github-secrets

# Separately select a private file holding CI token/account (never passed in argv):
npm run sync-github-secrets -- --env-file .env.deployment --credentials \
  --execute --confirm my-app --allow github-secrets
```

GitHub synchronization requires `repository` (or `--repo owner/name`) and prior `gh auth login`. `--github-environment production` targets an already configured environment. `--runtime-secrets` explicitly copies runtime settings to GitHub Secrets, but is optional and **does not sync them to Workers**. The provided workflow intentionally consumes selected variables; the CLI does not rewrite YAML or dynamically expose every env key. When adding a public build variable to the allowlist, explicitly add its `vars.KEY` reference to your workflow.

Every child command uses argv arrays without a shell; values go only through stdin or narrowly scoped child environments. Command logs list destination/key names, never values. Raw provider/process output is suppressed on failure; inspect commands locally if more diagnostic detail is needed, keeping your secrets out of shared logs.

## Private repository and reviewed source push

```sh
npm run setup -- repo --repo owner/my-app
npm run setup -- repo --repo owner/my-app --execute --confirm my-app --allow repo
# Initialize/commit locally yourself, inspect tracked files AND history, then:
npm run setup -- push --repo owner/my-app
npm run setup -- push --repo owner/my-app --execute --confirm my-app --allow push
```

Repository creation uses `gh repo create owner/name --private` with no automatic push. Push verifies the exact private repository, requires a clean reviewed commit, rejects common tracked secret/output paths, and sends only `HEAD` to `refs/heads/main` without force. The CLI never runs `git add`, commits for you, replaces origins, rewrites history, or pushes all branches/tags. Filename screening does not prove the entire history is secret-free; review it first. Existing repositories can be used as explicit push/sync destinations without claiming they were created by the CLI.

## Destructive deletion (operator-run only)

Start with the plan and make backups. Only D1/R2/KV resources recorded as **created** by this CLI are candidates. Worker/GitHub deletion is intentionally manual because successful deployments/pushes do not establish ownership of existing services.

```sh
npm run setup -- delete
# This permanently deletes ONLY the specified recorded resources. Review twice.
npm run setup -- delete --delete-resources d1,r2,kv \
  --execute --confirm my-app --allow delete --confirm-delete "DELETE my-app"
```

Deletion verifies every selected ID/name/account before the first delete request. It does not search names to infer deletion targets, delete adopted resources, recursively empty buckets, or delete unrecorded resources. A nonempty R2 bucket fails without purging objects. Each completed deletion leaves an ID-only tombstone, making repeated deletion idempotent and preventing accidental reprovisioning from that same journal. An ambiguous deletion is reconciled by GET of the exact recorded ID; only an exact-ID 404 for the pending delete is accepted as evidence of completion. No destructive command has been run by the assistant as part of implementation/testing.

## Deliberate parity boundaries

- Waffo automatic account/store/product/webhook provisioning is **not implemented**. `--payment waffo` fails explicitly. Use `none` or `manual`, configure sandbox products using official provider tools, and separately review go-live settings. Stripe/Creem also remain manual.
- No template licensing bypass, proprietary source clone, automatic global tool installation, credential generation, or authentication grant creation.
- No automatic source staging/commit/origin rewrite, YAML secret injection, remote migration inside deploy, or wildcard domain binding.
- D1/R2/KV create/adopt/delete and process contracts are covered by mocks. Live Cloudflare/GitHub/provider acceptance still requires explicit credentials and approval.

References used for independently authored behavior: [TanStarter CLI](https://docs.tanstarter.dev/cli/), [setup](https://docs.tanstarter.dev/start/), [env](https://docs.tanstarter.dev/env/), [deployment](https://docs.tanstarter.dev/deployment/), [Cloudflare API](https://developers.cloudflare.com/api/), [GitHub CLI secrets](https://cli.github.com/manual/gh_secret_set), and [GitHub CLI variables](https://cli.github.com/manual/gh_variable_set).

## Database Studio: explicit local or remote target

```sh
npm run db:studio:local
npm run db:studio:local -- --execute --confirm local
# If more than one local D1 exists, inspect and select the exact SQLite file:
npm run db:studio:local -- --file .wrangler/state/v3/d1/miniflare-D1DatabaseObject/EXACT.sqlite

# Remote requires shell CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_API_TOKEN:
npm run db:studio:remote
npm run db:studio:remote -- --execute --confirm EXACT_DATABASE_UUID
```

Studio is **not read-only**: the browser UI can inspect and modify the selected database. The listener is fixed to loopback 127.0.0.1, never a public bind. Local selection ignores Miniflare metadata databases/symlinks and refuses ambiguous multiple SQLite files or D1 bindings unless you select an exact in-project file. Run local migrations first. Local Studio requires the pinned `@libsql/client` dependency. Remote Studio uses Drizzle's `d1-http` driver and refuses a shell account/database that does not match Wrangler's DB binding. Temporary config files contain process-env references, not credential values, and are removed on normal exit; interrupted runs may require removing the value-free temporary config after confirming the old process stopped. No Studio server or remote data query was started during CLI implementation.

## Better Auth schema review

```sh
npm run auth:schema:generate
npm run auth:schema:generate -- --execute
```

Default mode validates/prints the generation contract; execution uses the locally installed **pinned `auth` CLI matching the installed `better-auth` version**. It never downloads `latest` or runs `auth secret`, `migrate`, `init`, or `create-admin`. The offline `scripts/auth.schema.config.ts` includes schema-affecting admin/bearer/API-key plugins and database rate limiting, without a runtime D1 connection or application credentials. Keep those options aligned when changing `src/auth/index.server.ts`.

The only output is a new `.saas/auth-schema.generated.ts` review artifact. Existing output is not overwritten, and `src/db/schema.ts` is never changed automatically. Compare and merge intended auth changes into the authored schema; retain application tables, relations, indexes, column naming, and migration history. Generate/review the Drizzle migration separately. A generated schema is not evidence that local or production migrations were applied. See [Better Auth CLI](https://better-auth.com/docs/concepts/cli) and [Drizzle Studio](https://orm.drizzle.team/docs/drizzle-kit-studio).

## Direct schema push (separate from versioned migrations)

`db:push:local` / `db:push:remote` provide Drizzle's direct schema reconciliation interface. Prefer generated, reviewed, versioned migrations for production. Push can drop columns/tables and destroy data; it does not update the migration history.

```sh
npm run db:push:local
# Copy the exact resolved SQLite target printed by the plan:
npm run db:push:local -- --execute --confirm "/absolute/project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/EXACT.sqlite" --ack-data-loss

# Remote uses explicit shell account/database/token, matching the Wrangler DB binding:
npm run db:push:remote
npm run db:push:remote -- --execute --confirm EXACT_DATABASE_UUID --ack-data-loss
```

Dry-run only validates/displays the target and command. It does not inspect the database, compute a live SQL diff, start a process, or write any file. Back up the exact target and review the authored schema before execution. Both local and remote execution require the exact target confirmation plus `--ack-data-loss`; the acknowledged command uses Drizzle `push --force`, which accepts destructive reconciliation without another prompt. There is no inferred approval from a migration/deploy request.

Target selection reuses Studio's safeguards: one unambiguous local DB (or explicit in-project `--file`, no metadata/symlinks) and exact remote D1/account matching. Public log/temporary-config text never contains credential values. A value-free pending journal blocks blind retries if the process fails or its outcome is uncertain. Inspect the resulting schema/data and reconcile `.saas/db-push-pending.json` before retrying. Config files are removed on normal process exit; a crash may leave a value-free config that should be removed only after confirming the old process stopped. Tests use injected mock runners; no local or remote schema push was executed during implementation.

### 管理员角色

`npm run db:admin:local -- user@example.com` 默认仅显示目标。提升/撤销管理员权限会改变账户安全边界，执行需要 `--execute --confirm EXACT_EMAIL --confirm-target EXACT_DISPLAYED_DATABASE_TARGET`；撤销加 `--revoke`。远程版本还验证显式账户 ID、D1 ID 与 Wrangler 配置一致，目标确认使用数据库 UUID。它只更新已有账户，不创建账户。先注册并验证邮箱，再由站点所有者审核后执行。不要盲目重试结果不确定的远程命令。

## Public GitHub variables: explicit clearing and verification

Omitting a public key leaves its remote value unchanged. An explicitly blank `VITE_*` value now stops synchronization instead of silently preserving an old enabled integration. To remove a reviewed public variable, use `--public-vars --clear-public VITE_CRISP_WEBSITE_ID` (comma-separated exact allowlisted names). Remove any nonempty local value first. This plans `gh variable delete`, checks absence first, and verifies the result with `gh variable list --json name,value` against the same repository/environment. A mismatched or failed read-back retains the uncertain pending journal; inspect it before retrying. This option can never delete runtime or deployment secrets. `payment: none` writes `VITE_PAYMENT_PROVIDER="none"`, a nonempty disabled build value that synchronizes normally. No GitHub mutation was run during implementation; regression transports are mocked.
