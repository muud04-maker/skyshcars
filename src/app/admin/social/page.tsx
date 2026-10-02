import {redirect} from 'next/navigation';
import {isAdmin} from '../../../lib/admin';
import {rows} from '../../../lib/db';
import {getSocialSettings,recentSocialLogs} from '../../../lib/social';
import {checkFacebookPage} from '../../../lib/readiness';
import AdminShell from '../_components/AdminShell';
import SocialPublisher from './SocialPublisher';
export const dynamic='force-dynamic';
export default async function P(){if(!(await isAdmin()))redirect('/admin/login');const settings=await getSocialSettings();const logs=await recentSocialLogs();const vehicles=await rows<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year, EXISTS(SELECT 1 FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.media_type='image' AND m.review_status='approved' AND m.url NOT LIKE '/demo/vehicles/%' AND m.url NOT LIKE '%vehicle-placeholder%' AND m.url NOT LIKE '/api/vehicle-art/%' AND COALESCE(m.caption,'') NOT LIKE 'MODEL PHOTO%' AND COALESCE(m.caption,'') NOT LIKE '%Reference image%' AND COALESCE(m.caption,'') NOT LIKE '%Representative%') has_real_photo FROM vehicles v WHERE v.status='available' ORDER BY v.updated_at DESC LIMIT 300`);const facebook=await checkFacebookPage();const configured={facebook:!!facebook.connected,facebookDetails:facebook,whatsapp:!!(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID)};return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Social Auto-Post</h1><p>Publish new available vehicles to Facebook and active WhatsApp customer chats.</p></div></div><SocialPublisher initial={settings} configured={configured} vehicles={vehicles} logs={logs}/></main></AdminShell>}
