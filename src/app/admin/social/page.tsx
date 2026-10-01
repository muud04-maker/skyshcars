import {redirect} from 'next/navigation';
import {isAdmin} from '../../../lib/admin';
import {rows} from '../../../lib/db';
import {getSocialSettings,recentSocialLogs} from '../../../lib/social';
import AdminShell from '../_components/AdminShell';
import SocialPublisher from './SocialPublisher';
export const dynamic='force-dynamic';
export default async function P(){if(!(await isAdmin()))redirect('/admin/login');const settings=await getSocialSettings();const logs=await recentSocialLogs();const vehicles=await rows<any>("SELECT id,stock_no,brand,model,model_year FROM vehicles WHERE status='available' ORDER BY updated_at DESC LIMIT 300");const configured={facebook:!!(process.env.META_PAGE_ACCESS_TOKEN&&process.env.META_PAGE_ID),whatsapp:!!(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID)};return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Social Auto-Post</h1><p>Publish new available vehicles to Facebook and active WhatsApp customer chats.</p></div></div><SocialPublisher initial={settings} configured={configured} vehicles={vehicles} logs={logs}/></main></AdminShell>}
