# 额度、模型与任务契约

## 双层限额，一次产品计费

`src/config/website.ts` 的 `ai` 延续模板 `DEFAULT_AI_POLICY`：默认关闭；每日用户/全站请求 20/200，容量单位 40/400，全站并发 4，Lumina 用户并发 2。两个 Schnell 模型权重均来自 `src/config/ai-models.ts`，当前每次 4 单位。单位为相对容量，不是美元或供应商计价。`IMAGE_GENERATION_ENABLED=true` 是第二个运行时开关；只有两个开关、D1/R2 和合法模型配置均满足才可发起新请求。

产品示例月度政策在 `src/generation/policy.server.ts`：免费 10、付费 200，每 UTC 月重置；保留记录上限 30/500，并发 2，可由 `IMAGE_*` 有限正整数配置调整。有效并发同时受模板安全限额约束。付费资格仅来自当前支付账本投影，过期/退款后重新计算，旧用量不清零。

`reserveJob` 单条 `INSERT ... SELECT` 原子检查月度额度、记录保留、账户删除冻结、每日用户/全站请求与单位、用户/全站并发。成功插入的触发器同时写入无外键的 `generation_capacity`；没有第二个产品扣费。旧模板 `ai_usage_requests` 的记录也计入安全检查。旧 Lumina 数据升级回填保守的 4 单位，旧未知任务继续占用全站/用户并发。

产品 credit 在成功持久化或已完成安全拦截后扣一次；明确失败可释放月度 credit。但每日安全容量保守保留所有已准入请求的单位，即使供应商报错或运营人员释放产品 credit。作品删除保留幂等墓碑，账户删除也不会重置全站当天容量。到期维护只删除超过 retentionDays 的已结束容量，未知任务永不自动到期释放。

记录保留数量包含失败记录和未决任务。用户可删除已结束记录以释放存储记录槽位。每图下载最大 8 MiB；套餐不是字节硬容量、费用担保或现金余额，R2、请求、邮件、支付等费用另计。真实供应商控制台应另设预算/告警。

## 状态与恢复

`dispatching → queued/processing → succeeded`；模糊结果进入 `unknown`，保持月度预留及并发。`succeeded` 仅在受限格式图片写入私有 R2、验证对象身份并持久化 D1 状态后成立。Workers 为同步接口；连接中断不安全重发。

fal POST 返回 request ID 后先持久化，之后只查询既有状态与结果。HTTP 错误、超时、缺少 ID 或结果下载失败，均不会自动重新发起付费 POST。客户端先将带 UUID 幂等键的确切请求保存到当前账号的 sessionStorage；断线/刷新只恢复同一键。同键不同输入返回 409；重复点击仅唯一插入者调用供应商。

用户离开页面后没有应用后台队列，供应商可能继续工作。重新打开详情恢复查询/保存；关闭网页或浏览器“后退”不是供应商取消。当前产品不提供推理取消按钮，不承诺取消或退款。

`save:` R2 写入锁不依靠租约重抢。可以 HEAD 检查同一对象并确认完成；无对象不证明原写入停止。禁止在线释放该锁。管理员接口只对稳定至少 5 分钟、无在途写锁/轮询的任务核查；需要供应商检查声明和至少 20 字理由，记录审计，不调用推理。

## 官方接口核对（2026-10-24）

- [fal Schnell 模型 schema](https://fal.ai/models/fal-ai/flux/schnell/api)：提示词、比例、可选 seed、单图、4 步、安全检查、JPEG；风格为提示词修饰，非独立模型参数。
- [fal 异步队列](https://fal.ai/docs/documentation/model-apis/inference/queue)：状态/结果 URL 使用 owner/app `fal-ai/flux`，不附 `/schnell`；先保存 request ID。
- [Workers AI FLUX.1 Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/)：使用 `prompt`/`steps` 和 base64 图像结果。本产品保守只开放方形输出，不暴露未经支持的 seed/宽高参数。

没有真实推理调用验收；接口、模型可用性、供应商内部重试/计费和许可仍须上线前核验。
