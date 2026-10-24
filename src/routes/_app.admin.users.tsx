import { adminRouteMiddleware } from "../middlewares/auth-middleware";
import { m } from "../locale/paraglide/messages";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { UsersPage } from "../components/admin/users";
import { Notice, SectionTitle } from "../components/ui/primitives";

export const Route = createFileRoute("/_app/admin/users")({
	server: { middleware: [adminRouteMiddleware] },
	beforeLoad: ({ context }) => {
		if (context.session.user.role !== "admin")
			throw redirect({ to: "/dashboard" });
	},
	component: Page,
});
function Page() {
	const { session } = Route.useRouteContext();
	return session.user.role === "admin" ? (
		<UsersPage />
	) : (
		<>
			<SectionTitle
				title={m.routes_app_admin_users_administrator_access_required()}
			/>
			<Notice kind="error">
				{m.routes_app_admin_users_your_account_does_not_have_permission_to()}
			</Notice>
		</>
	);
}
