# 可安装纵向示例：私人笔记

这个例子完整连接表、迁移、现有认证、API、页面、所有权、付费功能与测试。默认不安装路由、不添加业务表、不修改产品功能。它是供你改造成自己的业务的 opt-in recipe，不是默认产品功能或已通过浏览器验收的线上服务。

## 先跑测试，再安装

在 starter 根目录、npm ci 后：

```sh
npx vitest run tests/developer-recipes.test.ts tests/developer-recipes.integration.test.ts
node examples/private-notes/apply.mjs
```

第二条只打印目标和文件计划，不写文件、不打开数据库、不调用网络、不执行命令。确认你有当前源码备份，再显式安装到当前开发项目（只改本地源码）：

```sh
node examples/private-notes/apply.mjs --execute --confirm "$(pwd -P)"
npm run db:generate -- --name private_notes
# 审查 drizzle/ 新的 SQL、meta journal/snapshot，只应新增笔记表、归属 FK 和索引。
npm run db:migrate:local
npm run check
npm run dev
```

安装器先检查全部目标，拒绝覆盖、符号链接和重复安装；只新增七个业务/路由/schema 文件，并向 src/db/schema.ts 追加 export。不会安装依赖、运行迁移、生成生产密钥或部署。若你的根路径本身是 symlink，先进入真实路径。可使用 --target /absolute/other-project，执行时 --confirm 必须精确匹配显示的绝对路径。

先按 [最小认证配置](../../docs/configuration.md) 完成正常登录，再打开 http://localhost:3000/settings/notes（中文为 /zh/settings/notes）。没有配置支付时，创建/读取/删除正常，置顶返回明确 402；不提供开发生产通用的“已付款”旁路。安装不强改你的侧栏，可自行在 src/config/sidebar-config.ts 中添加到 /settings/notes 的链接。

## 每层在哪里，为什么这样写

| 层 | 安装后的文件 | 责任 |
|---|---|---|
| 数据模型 | src/db/private-notes.schema.ts | user_id FK、删除用户 cascade、owner/时间/id 索引 |
| 迁移 | npm run db:generate 创建的下一编号 SQL + snapshot | 保持 Drizzle 历史一致；不要手工复制 fixture SQL 到 drizzle |
| 纯服务器业务 | src/features/private-notes/service.server.ts | Zod strict、输入上限、同源、所有权、配额与付费检查 |
| 运行时适配 | src/features/private-notes/runtime.server.ts | 实际 requireUser、D1 binding、支付服务的 namespace 与 ledger |
| API 路由 | src/routes/api.private-notes.ts | 专用 /api/private-notes，动态导入服务器实现，不改大分发器 |
| 页面保护 | src/routes/_app.settings.notes.tsx | _app 会话保护、noindex、受保护 settings 路径、懒加载 |
| 交互 | src/features/private-notes/page.tsx | 列表/创建/置顶/删除、忙碌/空/错误/成功、React Query 失效 |
| 英中消息 | src/features/private-notes/messages.ts | 两种语言 key 对齐；正式产品可迁入 messages/*.json 并重新生成 |

请求流程：Cookie 或已签名 Bearer → requireUser 校验会话/封禁 → 从会话取 user.id → SQL 的 user_id 条件 → 私有响应 no-store。客户端绝不提交 ownerId、role、paid、SQL。管理员也没有读取别人的笔记的默认例外。

## API 契约

- GET /api/private-notes：只返回当前用户最多 100 条，按 pinned、createdAt、id 排序，不返回 owner 字段。
- POST：严格 JSON {"title":"…","body":"…"}；标题 trim 后 1–120、正文最多 4000 字符，body 最大 20 KB。原子 INSERT 条件限制每用户 100 条，并发也不能绕过上限。
- PATCH ?id=UUID：严格 JSON {"pinned":true|false}；查找/修改都带相同 owner 条件。只在新置顶时重新检查付费；过期用户仍可取消置顶。
- DELETE ?id=UUID：只删自己的笔记。页面先确认，API 不接受另一个用户 ID。
- 401 未登录、403 跨源/封禁、404 不存在或不属于自己（不泄露区别）、400 非法字段、402 无有效已付款权益、409 数量已满、413 超大正文。其他配置错误 fail closed，保留安全 request ID，不回传堆栈/秘密。

该示例上限 100 条，故刻意不实现分页、更新正文、搜索或团队共享。若增加这些能力，保留每个分支的 owner 条件和排序稳定性；不要删掉上限后一次返回无限数据。

## 付费门控：实际调用已有服务

runtime.server.ts 仅在配置了 payment.provider 时调用 paymentRuntime(env).service.getEntitlement(user)。已有服务验证 mode/account/deployment namespace，从 D1 的持久账本投影选取权益，不向支付商发送网络请求。随后要求 entitlement.paid 且 hasPaymentAccess(entitlement)。

这条 recipe 的“付费”特意排除未付款试用；有效取消到期保留权限的策略由现有 entitlement 函数决定。关闭支付 Provider 时置顶关闭；缺投影/错误 namespace 时报配置错误，不假装免费或付费。没有使用前端购买成功页、隐藏按钮、URL 查询参数、用户自报套餐作为依据。

## 测试和验收

```sh
npx vitest run tests/developer-recipes*.test.ts
npm run check
npm run smoke:local
```

专用测试实际运行本地 D1、生产迁移、Better Auth 签名会话和支付 ledger projection；覆盖双用户/admin 隔离、无效会话、同源、输入伪造、大小、并发数量边界、付费/免费/到期/试用/错误 namespace、删用户 cascade。所有 Provider fetch 被断言禁止。安装器测试确认无写 dry-run、确认目标、覆盖拒绝、symlink 拒绝和可安装文件清单。

测试在未安装时用 schema.sql fixture，在已安装时使用新生成的实际迁移，不重复创建表。schema.sql 只是对照 fixture，不是要发布的迁移文件。页面类型与迁移生成必须在实际安装副本通过；本轮精确证据见 [当前记录](../../docs/verification.md)。

浏览器仍需手工/自动化验证：未登录跳转及返回、两用户切换不残留、加载/空态/错误重试、连续点击、中文文本、确认取消、键盘和小屏。HTTP 或 renderToString 不等于水合通过。

## 私有页面与撤销安装

使用 /settings/notes 是为了继承现有敏感路径策略，避免注入可选统计/Crisp。不要随手改成 /notes 而不补隐私测试。noIndex 不等于授权；_app 与 API 独立保护不能去掉。不要把笔记文本放入 SEO、公开缓存、分析事件、URL 或日志。

安装后撤销：先在自己的版本控制中审查并撤回新增源码/export；若迁移从未应用，可一起撤回未发布的新迁移及其 snapshot。迁移一旦应用到共享/生产库，不能从历史中删除或回改旧 SQL。需要新 forward migration；DROP 表会永久删除笔记，必须先备份和独立确认。关闭功能不要求立刻删表。
