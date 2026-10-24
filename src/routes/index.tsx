import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../components/lumina/landing";
import { seo } from "../lib/seo";
export const Route = createFileRoute("/")({
	head: () => seo("/", {}),
	component: LandingPage,
});
