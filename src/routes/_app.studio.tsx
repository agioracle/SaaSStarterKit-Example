import { createFileRoute } from "@tanstack/react-router";
import { Route as AppRoute } from "./_app";
import { StudioPage } from "../components/lumina/studio";
import { m } from "../locale/paraglide/messages";
import { seo } from "../lib/seo";
export const Route = createFileRoute("/_app/studio")({
	validateSearch: (
		search: Record<string, unknown>,
	): { reuse?: string; idea?: number } => ({
		...(typeof search.reuse === "string" && /^[\w-]{1,80}$/.test(search.reuse)
			? { reuse: search.reuse }
			: {}),
		...([0, 1, 2].includes(Number(search.idea)) && search.idea !== undefined
			? { idea: Number(search.idea) }
			: {}),
	}),
	head: () => seo("/studio", { title: m.lumina_nav_studio(), noIndex: true }),
	component: StudioRoute,
});

function StudioRoute() {
	const { session } = AppRoute.useRouteContext();
	return (
		<StudioPage
			key={session.user.id}
			{...Route.useSearch()}
			userId={session.user.id}
		/>
	);
}
