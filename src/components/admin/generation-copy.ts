import { getLocale } from "../../locale";
const en = {
	title: "Generation operations",
	ineligible:
		"This request cannot be reconciled online yet. Stop polling and wait at least five minutes. An interrupted storage-write lock requires offline operator recovery; waiting alone will not unlock it.",
	requestError:
		"The operation could not be completed. Check your administrator session, configuration, and inspection evidence, then refresh the list.",
	description:
		"Review unresolved requests without starting another paid generation.",
	refresh: "Refresh list",
	empty: "No unresolved requests",
	emptyDetail: "Every accepted request currently has a settled outcome.",
	limit:
		"Showing up to 100 oldest unresolved requests. Resolve older items before reviewing newer ones.",
	job: "Request",
	owner: "Owner ID",
	provider: "Provider request ID",
	unknown: "Not available",
	updated: "Last update",
	review: "Review outcome",
	close: "Close",
	settle: "Record verified outcome",
	charged: "Provider consumed this request: keep one credit charged",
	released: "Provider confirms no consumption: release the reserved credit",
	reason: "Inspection evidence and reason",
	reasonHint:
		"20–1,000 characters. Reference the provider record or support case, not secrets or credentials.",
	confirm:
		"I checked the provider record, confirmed processing has ended, and verified the selected outcome.",
	warning:
		"Stop status polling and wait at least five minutes before reconciliation. This is an accounting action, not a retry. A wrong release may allow extra provider charges; a wrong charge may deduct a credit unfairly. Never guess from a timeout.",
	success: "The verified outcome was recorded with an audit entry.",
	status: "Status",
	started: "Created",
	outcome: "Verified outcome",
	minimum:
		"Provide at least 20 characters of inspection evidence and confirm that provider processing has ended.",
	note: "Inspect the matching request in the provider console. If no request ID was received, correlate the time and your provider logs. Do not settle without evidence.",
} as const;
const zh: Record<keyof typeof en, string> = {
	title: "生成运维",
	ineligible:
		"此请求当前不能在线结算。请停止轮询并等待至少五分钟。中断的存储写入锁必须由管理员离线核查恢复，仅等待不会解锁。",
	requestError:
		"操作未能完成。请检查管理员会话、配置与核查依据，然后刷新列表。",
	description: "核对未决请求，不会触发第二次付费生成。",
	refresh: "刷新列表",
	empty: "暂无未决请求",
	emptyDetail: "当前所有已受理的请求均已有明确结果。",
	limit: "最多展示最早的 100 个未决请求。请先处理较早的记录，再检查后续请求。",
	job: "请求",
	owner: "账户 ID",
	provider: "服务商请求 ID",
	unknown: "未取得",
	updated: "最后更新",
	review: "核对结果",
	close: "关闭",
	settle: "记录已核实的结果",
	charged: "服务商确认已消耗：记账 1 次额度",
	released: "服务商确认未消耗：释放预留额度",
	reason: "核查依据与原因",
	reasonHint:
		"20–1000 字符，可引用服务商记录或支持工单，但不要填入秘密或凭据。",
	confirm: "我已检查服务商记录，确认处理结束，并核实所选结果。",
	warning:
		"请停止状态轮询并等待至少五分钟后再处理。这是记账操作，不是重试。错误释放可能放行额外费用，错误记账可能不当扣减用户额度。切勿仅凭超时猜测。",
	success: "已记录核实结果并保留审计记录。",
	status: "状态",
	started: "创建时间",
	outcome: "已核实的结果",
	minimum: "请填写至少 20 字符的核查依据，并确认服务商已结束处理。",
	note: "请在对应服务商控制台检查该请求。如果未取得请求 ID，请通过时间和服务商日志核对。没有证据时不要结算。",
};
export function generationAdminCopy() {
	return getLocale() === "zh" ? zh : en;
}
