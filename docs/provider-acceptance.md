# Lumina 真实服务验收边界

本地 fixture 通过不代表 fal、Workers AI、Google OAuth、邮件、支付、远程 D1/R2 或部署验收。实际接入前在独立测试资源核对：Schnell 参数/返回格式、request ID 持久化与延后查询、供应商余额不足/安全拦截/队列失败、R2 权限/失败与下载、支付签名/重复事件/退款/到期投影、真实邮箱验证/重置、安全预算及费用告警。不得在未明确授权时触发收费验证或远程迁移。

# Provider acceptance before launch

Local fixtures validate application contracts; they do not certify provider credentials, delivery, settlement, model quality or production operations. Use your own disposable test environment/data and approved budget. Never run a live charge or paid request just to demonstrate a template.

## Authentication and mail

Test registration, verification/resend cooldown, verified sign-in, password reset, logout/session revocation, anonymous protection and administrator restrictions. Confirm actual inbox delivery and that URLs point to the intended HTTPS origin. Google needs its exact callback/allowed-origin configuration and a real OAuth round trip. Email preview is not delivery.

## Private files

Test upload validation/size limits, preview/download/delete, pagination, empty/error states, cross-user ownership and deletion cleanup against the selected R2/D1 bindings. Private attachments must not become an executable public website. No antivirus or aggregate tenant billing quota is included.

## Payments

For the selected Stripe/Creem/Waffo sandbox:

- Verify account/store/mode and product mapping; use the exact authenticated checkout and matching return reference.
- Preserve raw webhook bytes and signature headers. Exercise legitimate duplicate/out-of-order paid events, pending/failed states, cancellation, expiration and supported refunds.
- Confirm only verified ledger facts update access; success redirects never grant access.
- Check portal behavior, retired-provider management and provider-specific recovery limitations. Inspect ambiguous outcomes before retries.

The `e2e:stripe`, `e2e:creem` and `e2e:waffo` aliases invoke a guarded, manual-assisted sandbox harness. Read its preflight output; it requires an existing disposable deployment/test account, mode checks, explicit scenario acknowledgements and cost authorization. It does not create a merchant account, deploy, open a tunnel or execute automatically in CI. See [payment contracts](../src/payment/README.md).

## AI, newsletters, notifications and browser scripts

AI remains disabled until you review keys, provider billing, quotas, weighted units and uncertainty/retry behavior. Test each enabled task/model with harmless inputs and a small explicit budget. Limits are not a monetary guarantee.

Verify newsletter opt-in/status/unsubscribe and required double opt-in with the actual provider. Confirm best-effort Discord/Feishu delivery without logging sensitive events. Check analytics/Crisp consent, network behavior and exclusion from sensitive pages. UI showing a configuration is not proof a provider accepted or delivered it.

## Deployment and ongoing operation

Validate test/production separation, scheduled maintenance, readiness/health, monitoring/alerts, D1 plus R2 restore, schema-compatible rollback, actual mobile/browser behavior and legal/privacy notices. Measure deployed field CWV when real traffic exists. This project supplies the code and procedures, not a production-service or legal certification.
