# Lumina 旧版升级与未知结果运维

升级前备份 D1 和私有 R2，停用新生成与后台/用户轮询，先在本地恢复备份演练。保留既有迁移文件及 D1 `d1_migrations`；Wrangler 按完整文件名跟踪迁移，两份 `0004_*` 名称不同且均需保留。

- 全新库：`npm run db:migrate:local` 应用全部 SQL，包括 `0004_concerned_ben_urich.sql`、`0004_lumina_generations.sql`、0005、0006、`0007_lumina_capacity.sql`。
- 旧 Lumina：原 0000–0003 与 `0004_lumina_generations.sql` 内容不变；追加缺少的模板 0004/0005/0006 和容量 0007。原作品/提示词/供应商 ID/锁/账务原样保留；容量按 4 单位回填，未知任务不释放。
- v0.3.0 模板库：追加 Lumina 0004 和 0007。SQL 不删除/重建既有产品数据。
- 模板新增支付投影对旧 checkout 为 NULL 时需显式回填：使用下文模板支付恢复工具的 dry-run/rebuild 流程，核对原支付事件与模式；不要将 NULL 当作免费权益或直接改账本。

本地支付投影回填可先运行只读计划：

```sh
npm run payment:recover -- --action rebuild --file /path/to/local-copy.sqlite
```

实际写入要求已停止对应 Worker、精确文件确认及显式 `--execute`，详情见 `scripts/README.md`；本轮没有对真实数据库执行恢复。

`db:generate` 已纳入产品 schema 快照，后续业务改动继续追加迁移。禁止用 `db:push`/schema push 取代这些含安全触发器的迁移。远程迁移需要运营者另行授权，不能对不明资源运行。

未知任务先用管理员生成页面记录 request ID，查供应商控制台是否计费/终止；不要按新键重新发起。没有 request ID 的模糊 POST 也不能自动重试。`save:` 写锁仅可安全 HEAD 确认完成；如需释放，必须先停止所有写入进程和路由，等待最长请求及外部操作排空，再离线核查 R2/供应商。无对象或时间过期不是释放证据。离线修改须备份、审计和二次核验后才恢复服务。

每日容量表无外键是为了防止删除账户重置安全预算；仅哈希账号键、任务 ID、时间、容量和活动标记，不存提示词/图片/邮箱。定时维护仅清理旧的已结束容量与已授权账户清理，**不处理生成任务**；未知容量长期保留直至核查。

# Operations, upgrades and recovery

## Monitoring

Worker observability is enabled in the sample configuration. Inspect health/readiness, structured operation failures, provider acceptance/reconciliation errors, webhook retries, scheduled-maintenance progress, D1 usage and R2 storage growth. Alerts should name a request/reference and safe error code, never request contents, authentication tokens, customer details or hosted payment URLs.

`/api/health` checks process/binding availability. `/api/ready` checks selected feature configuration and exposes only minimal public information; authenticated administrators receive detail. Neither proves inbox delivery, OAuth, payment settlement or AI quality.

Maintenance runs through the Worker scheduled lifecycle with bounded cleanup, limiter and AI-usage housekeeping. Review failure/unknown states and retry only operations whose semantics permit it. Notifications are best effort, not a durable business-event outbox.

## Backups

Before migration, export the **exact remote D1** to a private encrypted backup destination or use the account's supported D1 backup/time-travel facilities. Do not commit exports, payment/customer records or credentials. Back up private R2 objects separately; a D1 export alone is not a file backup. KV is an advisory cache and can be repopulated.

Record the application commit, migration sequence, environment, resource identities and tested restoration steps. Test restoration into a disposable environment and reconcile file metadata/object contents before relying on a backup. Provider retention and legal records require your policy; the template does not invent one.

## Upgrading an operating application

1. Review the source diff and dependency/migration changes. Keep your business files and environment secrets out of template overwrites.
2. Take and verify backups; run the change on an isolated test deployment with its own providers/data.
3. Review generated Drizzle SQL. Auth schema generation produces a review artifact; it does not overwrite the maintained application schema automatically.
4. Apply pending migrations to the selected database once; D1 tracks migration history. Never reset the production database, remove migration history or rename a payment namespace/catalog identity casually.
5. Build with the deployment's public values, deploy the reviewed commit and run health plus business acceptance.

The base migration chain is `drizzle/0000` through `0006`; the opt-in private-notes example generates its own later migration. Review names/content rather than relying only on file numbers. The operations example contains a no-write planner; it does not execute restoration or deployment for you.

## Payment reconciliation and deletion

Payment access derives from verified append-only facts and projections. Retired providers and their credentials/price mappings may still be required for existing subscriptions. Do not treat a successful redirect, ordinary active update or user claim as a paid grant.

Inspect ambiguous/unknown checkout and cancellation states using the provider dashboard and the guarded recovery workflow. Stripe/Creem can recover some owned open checkouts; Waffo does not expose the same validated recovery path. Lost Creem sessions or provider data outside recoverable windows can require operator assistance. Account deletion may remain blocked when financial state is unknown; do not bypass this by guessing age or inventing a successful cancellation.

## Rollback

Worker version rollback and database restoration are different actions. Roll back application code only when it remains compatible with the current schema. Prefer forward corrective migrations; restoring D1 can discard writes and requires explicit review, downtime/reconciliation and an exact recovery point. Coordinate R2, payment facts and external providers rather than restoring one component in isolation.

After rollback/recovery, recheck protected routes, queues/maintenance, file consistency, payment entitlements and provider delivery. Keep production secrets out of incident documents. The repository has no automatic production rollback or destructive restore workflow.
