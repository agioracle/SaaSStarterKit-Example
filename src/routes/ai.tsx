import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/ai")({
	beforeLoad: () => {
		throw redirect({ to: "/studio" });
	},
});
