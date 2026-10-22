'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { BuildingIcon, ChartIcon, ListIcon, PlusIcon } from '@/components/icons';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  match: string[];
}

const NAV: NavItem[] = [
  { href: '/', label: 'Auditorías', icon: ListIcon, match: ['/auditorias'] },
  { href: '/nueva', label: 'Nueva auditoría', icon: PlusIcon, match: [] },
  { href: '/historico', label: 'Histórico', icon: ChartIcon, match: [] },
  // Una firma se llega a ver siempre desde su sitio.
  { href: '/sitios', label: 'Sitios', icon: BuildingIcon, match: ['/firmas'] },
];

const isActive = (pathname: string, { href, match }: NavItem) =>
  href === '/'
    ? pathname === '/' || match.some((prefix) => pathname.startsWith(prefix))
    : [href, ...match].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * El enlace activo se marca con color y con la barra inferior, nunca cambiando
 * el peso de la fuente: en negrita el texto ensancha y empuja a los vecinos.
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <ul className="flex flex-wrap">
      {NAV.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex items-center gap-2 px-3 py-4 text-sm transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-linear-to-r after:from-accent after:to-accent-alt after:transition-[scale,opacity] after:duration-200 ${
                active
                  ? 'text-ink after:scale-x-100 after:opacity-100'
                  : 'text-ink-muted after:scale-x-0 after:opacity-0 hover:text-ink hover:after:scale-x-50 hover:after:opacity-40'
              }`}
            >
              <Icon
                className={`size-4 transition-colors ${active ? 'text-accent' : 'text-ink-muted group-hover:text-ink'}`}
              />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
