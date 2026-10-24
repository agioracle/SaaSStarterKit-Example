# 从 SaaSStarterKit 到 Lumina

2026-10-24 实际查询远程 main：`0a1c2a64ce63b7f026ace939766e7819628c7225`，版本 v0.3.0。源仓库 https://github.com/agioracle/SaaSStarterKit.git 。本项目在目标仓库初始化提交 `eb6d4ead32b1ddc6c22e3307a399da541d70847d` 后普通提交，未改动/推送模板仓库。

旧 Lumina 源包 SHA256：`04af4953934a0f278fb70abddcd446a2a2c59d12ff297559b662f0f8f9474742`。先以最新模板建立工程，再按模块迁入产品；未用旧源整体覆盖。保留模板的支付账本与索引投影、受租约保护的账户清理、CSRF/鉴权中间件、惰性组件、结构化诊断、内容/SEO、隔离测试和 CI。

## 模块地图

| 目录或模块 | Lumina 的改动 |
| --- | --- |
| `src/generation/` | 模型目录、验证、原子准入、任务状态、供应商队列、R2 持久化、管理员核查 |
| `src/components/lumina/` | 首页、价格、工作室、作品库/详情、恢复 UI 与 EN/ZH 产品文案 |
| `src/routes/_app.studio*`, `_app.library*`, `_app.admin.generations*` | 产品鉴权页面；dashboard/ai 兼容跳转 |
| `src/api/generation.server.ts`, `src/api/index.server.ts` | 受鉴权/同源保护的产品 API；关闭通用 AI 旁路 |
| `src/db/generation.schema.ts`, `drizzle/0004_lumina_generations.sql`, `0007_lumina_capacity.sql` | 追加业务实体、审计与独立安全容量；旧任务原样升级 |
| `src/auth/deletion.server.ts` | 未决生成阻止账户删除；作品 R2 键加入最新清理清单 |
| `src/config/`, `messages/`, `src/styles.css`, `public/` | 品牌、菜单、示例套餐和原创安全视觉 |
| `scripts/local/lumina-fixtures.ts`, `scripts/lumina-demo.ts`, `tests/*generation*`, `tests/lumina*`, `tests/e2e/lumina.spec.ts` | 独立本地测试生成器与回归，正式路由无 fixture 分支 |

## 开发顺序

1. 固定并记录模板版本；保留模板的锁文件、许可证和质量门。
2. 创建产品 schema/migrations，定义浏览器安全的数据契约和服务端边界。
3. 迁入供应商实现，核对官方模型参数；先保存 fal request ID，再进行 GET 查询。
4. 将产品月额度、部署每日容量和并发检查放入同一条 SQLite 写入；触发器原子写容量事实。
5. 把结果存入私有 R2，再确认完成/扣产品额度；增加幂等、断线恢复、未知结果与管理员核查。
6. 用新模板支付权益投影计算套餐，保留账本为唯一来源；不从支付重定向授予额度。
7. 连接双语 UI、移动端、账户和管理；通过无密钥隔离测试覆盖，再配置真实供应商。

模板样例组件和相关测试保留供开发参考，包括拆出的 `sample-chart-preview.tsx`；产品页面不把样本数据当作实时指标。旧的重复评审、原始日志和模板副本 README 未迁入。

MIT 许可证沿用目标仓库，保留 Agi 和 EdgeKit contributors 的版权；第三方声明见 `THIRD_PARTY_NOTICES.md`。原创 CSS 展示图明确标注非 AI 作品，无私有 TanStarter 资产。
