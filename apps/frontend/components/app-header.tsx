'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import { GlobalSearch } from '@/components/global-search';

const primaryNavigation = [
  { href: '/rule-sets', label: 'Rules', prefix: '/rule-sets' },
  { href: '/worlds', label: 'Worlds', prefixes: ['/worlds', '/world'] },
  { href: '/campaigns', label: 'Campaigns', prefixes: ['/campaigns', '/campaign'] },
  { href: '/sessions', label: 'Sessions', prefixes: ['/sessions', '/session'] },
] as const;

function matchesPath(pathname: string, item: typeof primaryNavigation[number]): boolean {
  const prefixes = 'prefixes' in item ? item.prefixes : [item.prefix];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function AppHeader() {
  const pathname = usePathname();
  const { isLoading, user } = useUser();

  if (isLoading || !user) return null;

  return (
    <header className="navbar app-header">
      <div className="navbar app-header-inner">
        <div className="navbar-start app-header-brand-slot">
          <Link className="app-brand" href="/dashboard" aria-label="Wanderlust VTT dashboard">
            <span className="app-brand-mark" aria-hidden="true">W</span>
            <span><strong>Wanderlust</strong><small>Virtual tabletop</small></span>
          </Link>
        </div>
        <nav className="navbar-center app-primary-navigation" aria-label="Primary">
          <ul className="menu menu-horizontal">
            {primaryNavigation.map((item) => {
              const active = matchesPath(pathname, item);
              return <li key={item.href}><Link aria-current={active ? 'page' : undefined} href={item.href}>{item.label}</Link></li>;
            })}
          </ul>
        </nav>
        <div className="navbar-end app-header-search-slot">
          <GlobalSearch />
        </div>
      </div>
    </header>
  );
}
