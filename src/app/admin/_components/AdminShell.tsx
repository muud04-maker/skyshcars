'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, BadgeDollarSign, BookOpenCheck, BrainCircuit, CarFront, Code2, ContactRound,
  DatabaseBackup, ExternalLink, FileText, FlaskConical, FolderOpen, Globe2, History,
  ImageIcon, LayoutDashboard, ListChecks, LogOut, Megaphone, Menu, MessagesSquare,
  PackageSearch, Radio, Rocket, Route, ScrollText, Send, Share2, Ship, ShieldCheck, Store,
  Tags, UserCog, Users, X, ChevronDown,
} from 'lucide-react';

type NavLink = { href: string; label: string; icon: LucideIcon };
type NavGroup = { id: string; label: string; icon: LucideIcon; links: NavLink[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, links: [
      { href: '/admin', label: 'Control Center', icon: LayoutDashboard },
      { href: '/admin/analytics', label: 'Business Analytics', icon: Activity },
      { href: '/admin/launch', label: 'Launch Readiness', icon: Rocket },
    ],
  },
  {
    id: 'sales', label: 'Sales & Inventory', icon: Store, links: [
      { href: '/admin/vehicles', label: 'Vehicle Management', icon: CarFront },
      { href: '/admin/vehicles/new', label: 'Add Vehicle', icon: CarFront },
      { href: '/admin/media', label: 'Vehicle Photos', icon: ImageIcon },
      { href: '/admin/ai-catalog', label: 'AI Catalog', icon: Tags },
      { href: '/admin/imports', label: 'Inventory Review', icon: PackageSearch },
      { href: '/admin/suppliers', label: 'Private Suppliers', icon: Store },
      { href: '/admin/customers', label: 'Customers', icon: Users },
      { href: '/admin/leads', label: 'Leads', icon: ContactRound },
      { href: '/admin/quotes', label: 'Quotes', icon: FileText },
    ],
  },
  {
    id: 'shipping', label: 'Shipping & Logistics', icon: Ship, links: [
      { href: '/admin/shipments', label: 'Shipments & Tracking', icon: Ship },
      { href: '/admin/documents', label: 'Documents', icon: FolderOpen },
      { href: '/admin/countries', label: 'Countries', icon: Globe2 },
      { href: '/admin/ports', label: 'Ports', icon: Route },
      { href: '/admin/routes', label: 'Routes', icon: Route },
      { href: '/admin/rates', label: 'Rates', icon: BadgeDollarSign },
    ],
  },
  {
    id: 'communications', label: 'Communications', icon: MessagesSquare, links: [
      { href: '/admin/whatsapp', label: 'Inbox / Sales Assistant', icon: MessagesSquare },
      { href: '/admin/staff-tasks', label: 'Staff Tasks', icon: ListChecks },
      { href: '/admin/all-history', label: 'All History', icon: History },
      { href: '/admin/customer-history', label: 'Customer History', icon: ContactRound },
      { href: '/admin/whatsapp-health', label: 'WhatsApp Diagnostics', icon: Activity },
    ],
  },
  {
    id: 'publishing', label: 'Automation & Publishing', icon: Megaphone, links: [
      { href: '/admin/automation', label: 'Automation Center', icon: Radio },
      { href: '/admin/campaigns', label: 'Campaigns', icon: Megaphone },
      { href: '/admin/social', label: 'Social Publishing', icon: Share2 },
      { href: '/admin/telegram', label: 'Telegram Automation', icon: Send },
      { href: '/admin/group-reader', label: 'Group Reader', icon: Radio },
      { href: '/admin/group', label: 'Group Chat & Members', icon: MessagesSquare },
    ],
  },
  {
    id: 'ai', label: 'AI Training & Commands', icon: BrainCircuit, links: [
      { href: '/admin/ai-training', label: 'Training & Commands', icon: BrainCircuit },
      { href: '/admin/ai-learning', label: 'AI Learning', icon: BookOpenCheck },
      { href: '/admin/knowledge', label: 'Sales Knowledge', icon: BookOpenCheck },
      { href: '/admin/ai-test', label: 'Test the AI', icon: FlaskConical },
      { href: '/admin/agent-health', label: 'AI Agent Health', icon: Activity },
      { href: '/admin/photo-check', label: 'Photo Check', icon: ImageIcon },
    ],
  },
  {
    id: 'system', label: 'System & Settings', icon: ShieldCheck, links: [
      { href: '/admin/settings', label: 'Settings', icon: ShieldCheck },
      { href: '/admin/admins', label: 'Admin Users', icon: UserCog },
      { href: '/admin/audit', label: 'Audit Logs', icon: ScrollText },
      { href: '/admin/export', label: 'Backup / Export', icon: DatabaseBackup },
      { href: '/admin/dev', label: 'Dev Center', icon: Code2 },
    ],
  },
];

function matchesPath(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/admin';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState('dashboard');
  const [role, setRole] = useState('');

  const activeHref = useMemo(() => {
    const candidates = NAV_GROUPS.flatMap((group) => group.links).filter((link) => matchesPath(pathname, link.href));
    return candidates.sort((a, b) => b.href.length - a.href.length)[0]?.href || '';
  }, [pathname]);
  const activeGroup = useMemo(() =>
    NAV_GROUPS.find((group) => group.links.some((link) => link.href === activeHref))?.id || 'dashboard', [activeHref]);

  useEffect(() => {
    fetch('/api/admin/me', { cache: 'no-store' }).then((response) => response.json())
      .then((json) => setRole(json.role || '')).catch(() => {});
  }, []);
  useEffect(() => {
    setOpenGroup(activeGroup);
    setMobileOpen(false);
  }, [activeGroup, pathname]);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  function toggleGroup(id: string) {
    setOpenGroup((current) => current === id ? '' : id);
  }
  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }

  return <div className="adminLayout">
    <aside className={`adminSidebar ${mobileOpen ? 'open' : ''}`} aria-label="Admin sidebar">
      <div className="adminSidebarHead">
        <a className="adminBrand" href="/admin"><b>SKY CARS</b><span>CONTROL CENTER</span></a>
        <button type="button" className="adminSidebarClose" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20}/></button>
      </div>
      <nav className="adminAccordion" aria-label="Admin sections">
        {NAV_GROUPS.map((group) => {
          const GroupIcon = group.icon;
          const expanded = openGroup === group.id;
          const containsActive = activeGroup === group.id;
          const panelId = `admin-nav-${group.id}`;
          return <div className={`adminAccordionGroup ${containsActive ? 'active' : ''}`} key={group.id}>
            <button type="button" className="adminNavTrigger" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleGroup(group.id)}>
              <GroupIcon size={18} aria-hidden="true"/><span>{group.label}</span><ChevronDown size={16} className="adminNavChevron" aria-hidden="true"/>
            </button>
            {expanded ? <ul className="adminSubnav" id={panelId}>
              {group.links.map((link) => {
                const LinkIcon = link.icon;
                const active = link.href === activeHref;
                return <li key={link.href}><a href={link.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                  <LinkIcon size={15} aria-hidden="true"/><span>{link.label}</span>
                </a></li>;
              })}
              {group.id === 'system' && role === 'owner' ? <li><a href="/lab" target="_blank" rel="noreferrer"><Code2 size={15} aria-hidden="true"/><span>Private Development Lab</span><ExternalLink size={13} aria-hidden="true"/></a></li> : null}
            </ul> : null}
          </div>;
        })}
      </nav>
      <div className="adminSidebarFooter">
        <a className="adminSiteLink" href="/" target="_blank"><span>Open website</span><ExternalLink size={15}/></a>
        <button type="button" className="adminLogout" onClick={() => void logout()}><LogOut size={16}/><span>Log out</span></button>
      </div>
    </aside>
    <div className="adminMain">
      <div className="adminMobileBar">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open admin navigation" aria-expanded={mobileOpen}><Menu size={23}/></button>
        <b>SKY CARS ADMIN</b>
        <a href="/">Website <ExternalLink size={13}/></a>
      </div>
      {children}
    </div>
    {mobileOpen ? <button type="button" className="adminBackdrop" onClick={() => setMobileOpen(false)} aria-label="Close admin navigation"/> : null}
  </div>;
}
