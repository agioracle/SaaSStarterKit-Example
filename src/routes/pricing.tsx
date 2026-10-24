import { createFileRoute } from "@tanstack/react-router";
import { LuminaPricing } from "../components/lumina/pricing";
import { seo } from "../lib/seo";
export const Route = createFileRoute("/pricing")({
	head: () => seo("/pricing", { title: "Pricing" }),
	component: LuminaPricing,
});
