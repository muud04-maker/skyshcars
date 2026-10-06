import type { Metadata, Viewport } from 'next';
import AdminTabBar from './_components/AdminTabBar';

// Installable admin app (PWA): /admin can be added to the phone home screen and opens standalone.
export const metadata: Metadata = {
  title: 'Sky Cars Admin',
  manifest: '/manifest-admin.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Sky Cars Admin' },
  icons: { icon: '/icon-admin.svg', apple: '/icon-admin.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#071b2d' };

export default function AdminLayout({children}:{children:React.ReactNode}){
  // Authentication is enforced by each protected admin page/API.
  // /admin/login must stay publicly reachable so unauthenticated admins can sign in.
  return <>{children}<AdminTabBar/></>;
}
