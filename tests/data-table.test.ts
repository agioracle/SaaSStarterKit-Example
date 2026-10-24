import { describe, it, expect } from "vitest";
import { tableView } from "../src/components/data-table/model";
const rows = [
	{ id: "a", name: "Alpha", count: 2 },
	{ id: "b", name: "Beta", count: 10 },
	{ id: "c", name: "Gamma", count: 1 },
];
const columns = [
	{
		id: "name",
		title: "Name",
		value: (row: (typeof rows)[number]) => row.name,
	},
	{
		id: "count",
		title: "Count",
		value: (row: (typeof rows)[number]) => row.count,
	},
];
describe("reusable table model", () => {
	it("filters without mutating source", () => {
		expect(tableView(rows, columns, { query: "alpha" }).rows).toEqual([
			rows[0],
		]);
		expect(rows[0].id).toBe("a");
	});
	it("sorts numbers numerically and clamps pagination", () => {
		expect(
			tableView(rows, columns, {
				sort: "count",
				descending: true,
				pageSize: 1,
				page: 99,
			}),
		).toMatchObject({ rows: [rows[2]], pages: 3, page: 3, total: 3 });
	});
	it("returns stable empty pagination", () => {
		expect(tableView(rows, columns, { query: "absent" })).toMatchObject({
			rows: [],
			pages: 1,
			page: 1,
			total: 0,
		});
	});
});
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "../src/components/dashboard/chart";
it("renders accessible chart and escapes caller labels without inventing metrics", () => {
	const html = renderToStaticMarkup(
		createElement(BarChart, {
			title: "Fixture data only",
			data: [
				{ id: "a", label: "<script>unsafe</script>", value: 10 },
				{ id: "b", label: "Invalid", value: Infinity },
			],
		}),
	);
	expect(html).toContain("Fixture data only");
	expect(html).toContain("View chart data");
	expect(html).toContain("&lt;script&gt;");
	expect(html).not.toContain("<script>");
	expect(html).not.toContain("Invalid");
});
