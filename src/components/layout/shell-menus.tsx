import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Layers3, ChevronDown, ChevronRight, ArrowUpRight } from 'lucide-react';
import { authClient } from '../../auth/client';
import { getAvatarLinks } from '../../config/avatar-config';
import { getMenuTitle as menuTitle, isMenuItemVisible as visibleTo, type MenuItemConfig } from '../../config/menu';
import { m } from '../../locale/paraglide/messages';
import { localePath } from '../../locale';
import { MenuIcon } from './menu-icon';
import { menuHref } from './menu-link';

export function UserMenu({ user }: { user: { name: string; email: string; role?: string | null } }) {
	return (
		<MenuPrimitive.Root>
			<MenuPrimitive.Trigger className="user-menu-trigger">
				<span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
				<span>{m.layout_shell_account()}</span>
			</MenuPrimitive.Trigger>
			<MenuPrimitive.Portal>
				<MenuPrimitive.Positioner sideOffset={10} align="end">
					<MenuPrimitive.Popup className="user-menu-popup">
						<div className="user-menu-label">
							<strong>{user.name}</strong>
							<small>{user.email}</small>
						</div>
						{getAvatarLinks().filter((item) => visibleTo(item, user.role || undefined)).map((item) => (
							<MenuPrimitive.Item
								key={item.href}
								render={<a href={menuHref(item)} />}
								className="user-menu-item"
							>
								<MenuIcon icon={item.icon} />{item.title}
							</MenuPrimitive.Item>
						))}
						<MenuPrimitive.Separator className="user-menu-separator" />
						<MenuPrimitive.Item
							className="user-menu-item"
							onClick={async () => {
								await authClient.signOut();
								window.location.assign(localePath("/"));
							}}
						>
							{m.common_signout()}
						</MenuPrimitive.Item>
					</MenuPrimitive.Popup>
				</MenuPrimitive.Positioner>
			</MenuPrimitive.Portal>
		</MenuPrimitive.Root>
	);
}

export function NavigationMenu({ item, role }: { item: MenuItemConfig; role?: string }) {
  const children = item.items?.filter((child) => visibleTo(child, role)) || [];
	return (
		<MenuPrimitive.Root>
			<MenuPrimitive.Trigger className="nav-dropdown-trigger">
				<MenuIcon icon={item.icon} />
				{menuTitle(item.title)}
				<ChevronDown size={13} />
			</MenuPrimitive.Trigger>
			<MenuPrimitive.Portal>
				<MenuPrimitive.Positioner sideOffset={22}>
					<MenuPrimitive.Popup className="nav-dropdown-popup">
						{children.map((child) => (
							<NestedMenuItem item={child} role={role} key={child.title} />
						))}
					</MenuPrimitive.Popup>
				</MenuPrimitive.Positioner>
			</MenuPrimitive.Portal>
		</MenuPrimitive.Root>
	);
}
function NestedMenuItem({
	item,
	role,
}: {
	item: MenuItemConfig;
	role?: string;
}) {
	const children = item.items?.filter((child) => visibleTo(child, role));
	if (children?.length)
		return (
			<MenuPrimitive.SubmenuRoot>
				<MenuPrimitive.SubmenuTrigger className="nav-dropdown-item">
					<div>
						<MenuIcon icon={item.icon} />
						<strong>{menuTitle(item.title)}</strong>
						{item.description && <small>{item.description}</small>}
					</div>
					<ChevronRight size={14} />
				</MenuPrimitive.SubmenuTrigger>
				<MenuPrimitive.Portal>
					<MenuPrimitive.Positioner sideOffset={7}>
						<MenuPrimitive.Popup className="nav-dropdown-popup">
							{children.map((child) => (
								<NestedMenuItem key={child.title} item={child} role={role} />
							))}
						</MenuPrimitive.Popup>
					</MenuPrimitive.Positioner>
				</MenuPrimitive.Portal>
			</MenuPrimitive.SubmenuRoot>
		);
	return (
		<MenuPrimitive.Item
			className="nav-dropdown-item"
			render={
				<a
					href={menuHref(item)}
					target={item.external ? "_blank" : undefined}
					rel={item.external ? "noreferrer" : undefined}
				/>
			}
		>
			<MenuIcon icon={item.icon || Layers3} />
			<div>
				<strong>{menuTitle(item.title)}</strong>
				{item.description && <small>{item.description}</small>}
			</div>
			{item.external && <ArrowUpRight size={14} />}
		</MenuPrimitive.Item>
	);
}
