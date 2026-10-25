# Lumina · 私有图片工作室

[SaaSStarterKit](https://github.com/agioracle/SaaSStarterKit) 的完整 SaaS 示例：把模板的账户、支付账本、私有存储和安全默认连接成图片生成产品。Lumina 为演示品牌，尚未部署为真实服务。

基线 **v0.3.0 / `0a1c2a64ce63b7f026ace939766e7819628c7225`**，于 2026-10-24 实际核验远程 main。沿用 MIT 和来源版权；目标仓库初始化历史保留。详见[模板到产品](docs/template-baseline.md)。

## 可以做什么

- 中英双语首页、价格、注册/验证/登录、桌面与手机工作室。
- fal / Workers AI 的 FLUX.1 Schnell，按模型展示比例和种子；摄影、插画、电影风格是可见的提示词修饰。
- 每次一张图片；持久任务、私有 R2 作品库、详情、下载、删除、复用提示词。
- 原子月度额度、每日安全容量、全站/用户并发和请求幂等；刷新/断线恢复同一任务。
- 账户、安全、订阅与支付历史、管理员用户和生成任务处理。

真实 AI 和支付默认关闭。缺配置时显示不可用；不会伪造生成成功。没有后台无人值守生成队列：打开任务详情后恢复查询，供应商本身的队列不等于本应用有后台处理器。

## 无密钥本地演示

Node **24 LTS**（完整支持范围见 package.json）。

```sh
git clone https://github.com/agioracle/SaaSStarterKit-Example.git
cd SaaSStarterKit-Example
npm ci
npm run demo:local
```

打开 `http://127.0.0.1:4173`。使用脚本显示的虚构账号 `e2e.member@example.invalid` / `E2eFixturePassword!23` 登录。界面持续标记 **LOCAL FIXTURE / 非 AI 生成**。这是独立 opt-in 本地测试副本，使用临时 D1/R2/KV、真实鉴权和额度；供应商仅返回本地原创几何图案，不发出真实邮件、AI 或支付请求。生成副本在 `.local-smoke/`，禁止部署或打包。Ctrl-C 停止。端口被占用时可使用 `E2E_PORT=4473 npm run demo:local`；测试命令也支持 `E2E_PORT`。

测试场景提示词可加入 `[fixture:fail]`、`[fixture:unknown]`、`[fixture:pending]`。这些行为只存在于生成的本地测试副本。

## 正常本地开发和真实配置

```sh
npm ci
cp .env.example .env
cp .dev.vars.example .dev.vars
# 设置强随机 BETTER_AUTH_SECRET；配置邮件后才能完成注册验证。
npm run db:migrate:local
npm run dev
```

打开 `http://localhost:3000`。先保持 `IMAGE_GENERATION_ENABLED=false`、`websiteConfig.ai.enabled=false` 和空支付供应商。启用真实 AI 必须同时审阅并启用两个开关、有限安全预算，以及 fal 或 Cloudflare 凭据。无需 OpenAI 凭据。真实服务可能收费，不属于本地测试。

[配置](docs/configuration.md) · [部署](docs/deployment.md) · [数据库与运维](docs/operations.md) · [状态与额度](docs/product.md)

## 验证

```sh
npm run check            # build + type + lint + 所有单元/本地 D1/R2 测试
npm run i18n:check
npm run test:production  # 隔离 Worker HTTP、真实 Chromium 和捕获邮件
npm run test:lumina      # opt-in fixture 图片全流程，真实浏览器 + 本地 Worker
npm run test:performance
```

首次浏览器运行需 `npx playwright install chromium`；也可显式指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用受支持的本机 Chrome。所有测试使用虚构账号，不能使用真实环境文件或远程数据库。CI 运行同样本地检查，无部署、远程迁移或真实供应商调用。

[界面设计](DESIGN.md) · [交互改动](docs/ui-redesign.md) · [本轮验证与边界](docs/verification.md) · [文档索引](docs/README.md)

示例政策：免费每 UTC 月 10 张/保留 30 条，付费 200/500，默认用户并发 2。价格为演示配置；每日安全单位不是美元，也不是供应商硬账单上限。公开运营前须完成真实服务验收、成本预算、模型条款和运营主体/法律文本配置。

English: Lumina is the private image-generation SaaS example for SaaSStarterKit v0.3.0. Use `npm run demo:local` for an explicitly labelled, credential-free local fixture. Real AI and checkout are disabled by default. See the linked configuration and operations guides for production setup; no production deployment or live-provider acceptance is claimed.
