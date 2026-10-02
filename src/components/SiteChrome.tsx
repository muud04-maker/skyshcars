'use client';
import {usePathname} from 'next/navigation';
export default function SiteChrome({before,after,children}:{before:React.ReactNode;after:React.ReactNode;children:React.ReactNode}){
  const pathname=usePathname()||'/';
  const privateShell=pathname.startsWith('/admin')||pathname.startsWith('/lab');
  return <>{!privateShell&&before}{children}{!privateShell&&after}</>;
}
