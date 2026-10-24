import { lazy, Suspense, useState } from "react";
import { m } from "../../locale/paraglide/messages";
const DashboardChart = lazy(() =>
	import("./chart").then((module) => ({ default: module.BarChart })),
);
/** An opt-in component example, never presented as live account or business metrics. */
export function SampleChartPreview({
	initiallyOpen = false,
}: {
	initiallyOpen?: boolean;
}) {
	const [open, setOpen] = useState(initiallyOpen);
	return (
		<details
			className="card"
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary>{m.dashboard_chart_sample_toggle()}</summary>
			<p className="muted">{m.dashboard_chart_sample_description()}</p>
			{open && (
				<Suspense
					fallback={<p role="status">{m.dashboard_chart_sample_title()}</p>}
				>
					<DashboardChart
						title={m.dashboard_chart_sample_title()}
						description={m.dashboard_chart_sample_description()}
						data={[
							{ id: "sample-a", label: "A", value: 12 },
							{ id: "sample-b", label: "B", value: 18 },
							{ id: "sample-c", label: "C", value: 9 },
						]}
					/>
				</Suspense>
			)}
		</details>
	);
}
