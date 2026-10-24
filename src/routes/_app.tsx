import { authRouteMiddleware } from '../middlewares/auth-middleware';
import {
	createFileRoute,
	Outlet,
	redirect,
	useRouterState,
} from "@tanstack/react-router";
import { LogOut, ArrowUpRight } from "lucide-react";
import { getSession } from "../auth/functions";
import { authClient } from "../auth/client";
import { getSidebarLinks } from "../config/sidebar-config";
import { SidebarNavigation } from "../components/layout/sidebar-navigation";
import { m } from "../locale/paraglide/messages";
import { localePath } from "../locale";
import { seo } from "../lib/seo";
export const Route = createFileRoute("/_app")({
	server: { middleware: [authRouteMiddleware] },
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session)
			throw redirect({
				to: "/auth/login",
				reloadDocument: true,
				search: { redirect: location.href },
			});
		return { session };
	},
	head: () => seo("/dashboard", { title: "Workspace", noIndex: true }),
	component: Workspace,
});
function Workspace() {
	const { session } = Route.useRouteContext();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	return (
		<div className="workspace">
			<aside className="sidebar">
				<div className="workspace-label">
					{m.routes_app_your_workspace()}
					<span className="badge">
						{session.user.role === "admin"
							? m.routes_app_admin()
							: m.routes_app_personal()}
					</span>
				</div>
				<SidebarNavigation
					items={getSidebarLinks()}
					role={session.user.role ?? "user"}
					pathname={pathname}
					label={m.routes_app_workspace_navigation()}
				/>
				<div className="sidebar-bottom">
					<a className="sidebar-studio" href={localePath("/studio")}>
						<span>✧ {m.nav_ai()}</span>
						<ArrowUpRight size={16} />
					</a>
					<div className="sidebar-user">
						<span className="avatar">
							{session.user.name?.slice(0, 1).toUpperCase() || "U"}
						</span>
						<div>
							<strong>{session.user.name}</strong>
							<small>{session.user.email}</small>
						</div>
						<button
							className="icon-button"
							title={m.common_signout()}
							onClick={async () => {
								await authClient.signOut();
								window.location.assign(localePath("/"));
							}}
						>
							<LogOut size={17} />
						</button>
					</div>
				</div>
			</aside>
			<div className="workspace-content">
				<Outlet />
			</div>
		</div>
	);
}
