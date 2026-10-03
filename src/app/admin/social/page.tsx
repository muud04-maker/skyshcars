import {redirect} from 'next/navigation';
import {isAdmin} from '../../../lib/admin';
import {rows} from '../../../lib/db';
import {getSocialSettings,recentSocialLogs} from '../../../lib/social';
import {facebookStatus} from '../../../lib/facebook';
import {whatsappConfigured} from '../../../lib/meta';
import {exactPhotoSql,sellableVehicleSql} from '../../../lib/exact-photos';
import AdminShell from '../_components/AdminShell';import NeedsSetup from '../_components/NeedsSetup';
import SocialPublisher from './SocialPublisher';
export const dynamic='force-dynamic';
export default async function P(){if(!(await isAdmin()))redirect('/admin/login');const settings=await getSocialSettings();const logs=await recentSocialLogs().catch(()=>null);const vehicles=await rows<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year, EXISTS(SELECT 1 FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}) has_real_photo, EXISTS(SELECT 1 FROM social_publish_log l WHERE l.vehicle_id=v.id AND l.channel='facebook' AND l.status='sent') fb_posted FROM vehicles v WHERE ${sellableVehicleSql('v')} ORDER BY v.updated_at DESC LIMIT 300`).catch(()=>[]);const facebook=await facebookStatus();const configured={facebook:!!facebook.connected,facebookDetails:facebook,whatsapp:whatsappConfigured()};return <AdminShell><main className="adminPage"><div className="adminTitle"><div><h1>Social Auto-Post</h1><p>Publish new available vehicles to Facebook and active WhatsApp customer chats.</p></div></div>{!logs&&<NeedsSetup what="Publishing history"/>}<SocialPublisher initial={settings} configured={configured} vehicles={vehicles} logs={logs||[]}/></main></AdminShell>}
