import { MenuIcon } from "./menu-icon";
import { LocaleSwitcher as LocaleSwitch } from "./locale-switcher";
export { LocaleSwitcher as LocaleSwitch } from "./locale-switcher";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	Menu,
	Moon,
	Sun,
	X,
	ArrowUpRight,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { authClient } from "../../auth/client";
import { websiteConfig } from "../../config/website";
import { getLocalizedMetadata } from "../../config/metadata";
import {
	getMenuTitle as menuTitle,
	isMenuItemVisible as visibleTo,
	type MenuItemConfig,
} from "../../config/menu";
import { getFooterLinks } from "../../config/footer-config";
import { getNavbarLinks } from "../../config/navbar-config";
import { getSocialLinks } from "../../config/social-config";
import { m } from "../../locale/paraglide/messages";
import {
	getLocale,
	localePath,
} from "../../locale";
import { menuHref } from './menu-link';

// Keep optional focus/floating/menu implementations out of anonymous flat navigation.
const UserMenu = lazy(() => import('./shell-menus').then((module) => ({ default: module.UserMenu })));
const NavigationMenu = lazy(() => import('./shell-menus').then((module) => ({ default: module.NavigationMenu })));
export function Brand() {
	return (
		<a href={localePath("/")} className="brand">
			<span className="brand-mark">
				<img
					className="logo-light"
					src={websiteConfig.metadata.images.logoLight}
					alt=""
					width={24}
					height={24}
				/>
				<img
					className="logo-dark"
					src={websiteConfig.metadata.images.logoDark}
					alt=""
					width={24}
					height={24}
				/>
			</span>
			<span className="brand-title">{getLocalizedMetadata(getLocale()).name}</span>
			<span className="brand-dot">/</span>
		</a>
	);
}
export function ThemeSwitch() {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const media = matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			let saved: string | null = null;
			try {
				saved = localStorage.getItem("edgekit-theme");
			} catch {}
			const preferred = saved || websiteConfig.theme.default;
			const enabled =
				preferred === "system" ? media.matches : preferred === "dark";
			setDark(enabled);
			document.documentElement.dataset.theme = enabled ? "dark" : "light";
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, []);
	function toggle() {
		const next = !dark;
		setDark(next);
		try {
			localStorage.setItem("edgekit-theme", next ? "dark" : "light");
		} catch {}
		document.documentElement.dataset.theme = next ? "dark" : "light";
	}
	if (!websiteConfig.theme.allowSwitch) return null;
	return (
		<button
			onClick={toggle}
			className="icon-button"
			title={m.layout_shell_toggle_color_theme()}
			aria-label={m.layout_shell_toggle_color_theme()}
		>
			{dark ? <Sun size={17} /> : <Moon size={17} />}
		</button>
	);
}
export function Header() {
	const [open, setOpen] = useState(false);
	const { data: session } = authClient.useSession();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	useEffect(() => {
		if (pathname) setOpen(false);
	}, [pathname]);
	return (
		<header className="site-header">
			<div className="header-inner">
				<Brand />
				<nav
					className={`main-nav ${open ? "open" : ""}`}
					aria-label={m.layout_shell_main_navigation()}
				>
					{getNavbarLinks()
						.filter((item) => visibleTo(item, session?.user.role || undefined))
						.map((item) => (
							<NavigationEntry
								key={item.title}
								item={item}
								role={session?.user.role || undefined}
							/>
						))}
				</nav>
				<div className="header-actions">
					<LocaleSwitch />
					<ThemeSwitch />
					{websiteConfig.auth.enabled &&
						(session ? (
							<Suspense fallback={<a className="user-menu-trigger" href={localePath('/dashboard')}><span className="avatar">{session.user.name.slice(0, 1).toUpperCase()}</span><span>{m.layout_shell_account()}</span></a>}>
                <UserMenu user={session.user} />
              </Suspense>
						) : (
							<>
								<Link
									className="login-link"
									to="/auth/login"
									reloadDocument
									search={{}}
								>
									{" "}
									{m.nav_login()}
								</Link>
								<Link
									className="button small primary"
									to="/auth/register"
									reloadDocument
									search={{}}
								>
									{" "}
									{m.lumina_nav_start_creating()}
									<ArrowUpRight size={15} />
								</Link>
							</>
						))}
					<button
						className="icon-button mobile-menu"
						onClick={() => setOpen(!open)}
						aria-label={m.layout_shell_toggle_menu()}
						aria-expanded={open}
					>
						{open ? <X size={20} /> : <Menu size={20} />}
					</button>
				</div>
			</div>
		</header>
	);
}
export function Footer() {
  const { data: session } = authClient.useSession();
  const role = session?.user.role || undefined;
	return (
		<footer className="site-footer">
			<div className="footer-top">
				<div>
					<Brand />
					<p>{m.footer_note()}</p>
					<div className="footer-social">
						{getSocialLinks().filter((item) => visibleTo(item, role)).map((item) => (
							<a
								href={menuHref(item)}
								target={item.external ? "_blank" : undefined}
								rel={item.external ? "noreferrer" : undefined}
								key={item.href}
							>
								<MenuIcon icon={item.icon} />{item.title}
								{item.external && <ArrowUpRight size={12} />}
							</a>
						))}
					</div>
				</div>
				{getFooterLinks().filter((item) => visibleTo(item, role)).map((group) => (
					<div key={group.title}>
						<h3>{group.title}</h3>
						{(group.items || []).filter((item) => visibleTo(item, role)).map((item) => (
							<a key={item.href || item.title} href={menuHref(item)} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined}>
                <MenuIcon icon={item.icon} />
								{item.title}
							</a>
						))}
					</div>
				))}
			</div>
			<div className="footer-bottom">
				<span>
					© {new Date().getFullYear()} <span className="brand-title">{getLocalizedMetadata(getLocale()).name}</span>
				</span>
				<span className="status-dot">
					{m.layout_shell_independent_by_design()}
				</span>
			</div>
		</footer>
	);
}

function NavigationEntry({
	item,
	role,
}: {
	item: MenuItemConfig;
	role?: string;
}) {
	const children = item.items?.filter((child) => visibleTo(child, role));
	if (!children?.length)
		return (
			<a
				href={menuHref(item)}
				target={item.external ? "_blank" : undefined}
				rel={item.external ? "noreferrer" : undefined}
			>
				<MenuIcon icon={item.icon} />
				{menuTitle(item.title)}
			</a>
		);
  return (
    <Suspense fallback={<NavigationFallback item={item} role={role} />}>
      <NavigationMenu item={item} role={role} />
    </Suspense>
  );
}

/** Real links remain usable while an optional rich menu chunk is loading. */
function NavigationFallback({ item, role }: { item: MenuItemConfig; role?: string }) {
  const children = item.items?.filter((child) => visibleTo(child, role));
  if (!children?.length) return <a href={menuHref(item)} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined}><MenuIcon icon={item.icon} />{menuTitle(item.title)}</a>;
  return <details><summary><MenuIcon icon={item.icon} />{menuTitle(item.title)}</summary><nav>{children.map((child) => <NavigationFallback item={child} role={role} key={child.title} />)}</nav></details>;
}
