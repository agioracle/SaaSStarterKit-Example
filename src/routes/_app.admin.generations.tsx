import { createFileRoute, redirect } from "@tanstack/react-router";
import { GenerationOperations } from "../components/admin/generations";
export const Route = createFileRoute("/_app/admin/generations")({
	beforeLoad: ({ context }) => {
		if (context.session.user.role !== "admin")
			throw redirect({ to: "/studio" });
	},
	component: GenerationOperations,
});
