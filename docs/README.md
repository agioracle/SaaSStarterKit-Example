# Lumina 文档

从项目 [README](../README.md) 开始；以下为同一工程的操作参考。

1. [模板到产品](template-baseline.md)：采用 SHA、模块地图、迁移步骤与版权。
2. [产品约束](product.md)：额度、每日预算、状态机、幂等和失败恢复。
3. [配置](configuration.md)：公开/服务端配置、鉴权、邮件、AI 和支付。
4. [部署](deployment.md)：D1/R2/KV 绑定、隔离资源、迁移和发布步骤。
5. [运维和旧版升级](operations.md)：未知状态、离线排空、备份、迁移与回退。
6. [开发参考](development.md)：最新模板的组件和扩展契约，产品入口见上面的模块地图。
7. [验证](verification.md)与[真实供应商验收](provider-acceptance.md)。

来源模板的适配器参考仍保留在模块旁边。Lumina 只开放受鉴权保护的 `/api/generations`；模板 `/api/ai` 与经它转发的通用 facade 返回 410，不构成另一套可调用产品接口。
