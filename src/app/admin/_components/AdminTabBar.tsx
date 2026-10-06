'use client';
import { usePathname } from 'next/navigation';

/* Phone navigation for the admin PWA: the six screens the owner actually uses. */
const TABS: [string, string][] = [
  ['/admin', 'Dashboard'],
  ['/admin/whatsapp', 'Inbox'],
  ['/admin/vehicles', 'Inventory'],
  ['/admin/vehicles/new', 'Add car'],
  ['/admin/quotes', 'Quotes'],
  ['/admin/launch', 'More'],
];

export default function AdminTabBar() {
  const path = usePathname() || '';
  if (path.startsWith('/admin/login')) return null;
  return <nav className="adminTabBar" aria-label="Admin navigation">
    {TABS.map(([href, label]) => {
      const base = href.split('?')[0];
      const active = base === '/admin' ? path === '/admin' : path.startsWith(base);
      return <a key={label} href={href} className={active ? 'active' : ''}>{label}</a>;
    })}
  </nav>;
}
