export default function AdminLayout({children}:{children:React.ReactNode}){
  // Authentication is enforced by each protected admin page/API.
  // /admin/login must stay publicly reachable so unauthenticated admins can sign in.
  return <>{children}</>;
}
