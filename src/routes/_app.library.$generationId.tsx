import { createFileRoute } from "@tanstack/react-router";
import { GenerationDetailPage } from "../components/lumina/library";
import { m } from "../locale/paraglide/messages";
import { seo } from "../lib/seo";
export const Route = createFileRoute("/_app/library/$generationId")({
	head: () => seo("/library", { title: m.lumina_nav_creation_details(), noIndex: true }),
	component: () => <GenerationDetailPage id={Route.useParams().generationId} />,
});
