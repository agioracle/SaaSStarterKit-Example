# 本轮验证与限制

日期：2026-10-24。以下结果来自当前 Lumina 工程的实际运行，不继承模板历史通过记录。

环境：macOS arm64 / Node 24.22.1、独立 Chrome、本地 D1/R2/KV、虚构账号与捕获邮件。未读取用户真实环境文件；未调用真实 AI、支付、邮件、远程数据库或生产部署。

| 检查 | 本轮结果 |
| --- | --- |
| build / typecheck / lint | 通过；125 条 CSS 等 warnings，无 errors |
| 全部单元/集成 | 67 文件、1,026 测试通过 |
| 迁移兼容 | 7 份模板 SQL 和原 Lumina 0004 字节未变；旧库追加升级保留提示词、供应商 request ID、预留和锁 |
| 原子准入/安全容量 | 并发唯一胜者、同键同输入重放、不同输入冲突、全站预算、旧模板 AI 记录、删除账户不重置容量、未知任务不超时释放 |
| EN/ZH | 694 个共享消息键对齐；产品词典由类型与回归校验，均无空字符串 |
| 本地 Worker HTTP | 18 项通过 |
| 正式禁用模式 Chrome | 23 项通过；EN/ZH、1440/390px、实际表单、移动导航、文件私有访问、键盘和恢复 |
| axe | 24 组页面/主题/视口检查，所选 WCAG A/AA 规则无违规；非完整人工无障碍认证 |
| 捕获邮件 Chrome | 1 条完整注册→验证→登录→重置→退出闭环通过；未发外部邮件 |
| Lumina 图片 fixture Chrome | 5 项通过；1440/390px 真实登录/模型参数/重复点击/保存/下载/私有权限/复用/取消删除/刷新/幂等/失败/未知/并发/管理员/中文 |
| 内容规模/打包 | 128 篇附加合成文章；公共入口 raw 338,640 B / gzip9 107,595 B；首页声明 JS raw 545,896 B / gzip9 180,960 B；客户端增长 0 B，24 个文章正文哨兵未泄入客户端 |

所有图片生成结果均为明确标记的原创建模 fixture，正式源码没有该供应商分支。正式模式缺配置时不可生成；`/api/ai` 返回 410。截图取自实际 UI，仅保留在忽略的 `evidence/`，原始日志、临时库和测试副本不发布。

干净 checkout：另行本地 clone 后重新 npm ci（锁文件离线缓存）、9 份本地迁移、全新 build、dev 启动及 6 个 EN/ZH 390px 页面通过；无 page errors/overflow，工作室匿名访问重定向登录，checkout 没有 tracked changes。最终发布以交付 SHA 对应的 CI 终态为准。CI 仅运行本地隔离检查，不部署、不迁移远程资源、不使用真实供应商凭据。[查看本仓库 Actions](https://github.com/agioracle/SaaSStarterKit-Example/actions)。

## 尚未验收

- fal、Workers AI、Google OAuth、真实邮件投递、支付/退款、远程 Cloudflare 资源和部署均未验收。
- 仅验证 Chrome；未声称 Safari、Firefox 或 WebKit 等效。
- 性能数字是本地构建/SSR 诊断，不是部署实测、网络传输或线上 Core Web Vitals。
- 安全容量不是供应商硬账单上限。没有无人值守后台生成队列；打开详情恢复查询。
- `npm audit` 当前有 4 个 moderate 开发工具链问题（Drizzle Kit / esbuild / @esbuild-kit），未强制降级；125 条 lint warnings 主要为 CSS specificity/order/important，保留可见并由浏览器回归验证。
- 法律页面、价格与套餐均为示例，真实运营前需配置主体、隐私/保留/退款规则和模型许可。
