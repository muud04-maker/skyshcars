'use client';
import {usePathname} from 'next/navigation';
export default function SiteChrome({before,after,banner,children}:{before:React.ReactNode;after:React.ReactNode;banner?:React.ReactNode;children:React.ReactNode}){
  const pathname=usePathname()||'/';
  const privateShell=pathname.startsWith('/admin')||pathname.startsWith('/lab');
  return <>{!privateShell&&before}{!privateShell&&banner}{children}{!privateShell&&after}</>;
}
