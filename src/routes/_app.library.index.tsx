import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "../components/lumina/library";
import { m } from "../locale/paraglide/messages";
import { seo } from "../lib/seo";
export const Route = createFileRoute("/_app/library/")({
	head: () => seo("/library", { title: m.lumina_nav_my_library(), noIndex: true }),
	component: LibraryPage,
});
