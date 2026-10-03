import {NextResponse} from 'next/server';
import {adminDenied} from '../../../../lib/admin-guard';
import {getSocialSettings,saveSocialSettings,recentSocialLogs,publishVehicleToFacebook,publishVehicleToActiveWhatsAppChats} from '../../../../lib/social';
import {facebookStatus} from '../../../../lib/facebook';
import {whatsappConfigured} from '../../../../lib/meta';

export const dynamic='force-dynamic';
export async function GET(){const d=await adminDenied();if(d)return d;const facebook=await facebookStatus();return NextResponse.json({settings:await getSocialSettings(),logs:await recentSocialLogs(),configured:{facebook:!!facebook.connected,facebookDetails:facebook,whatsapp:whatsappConfigured()}})}
export async function PATCH(req:Request){const d=await adminDenied();if(d)return d;const b=await req.json();const settings=await saveSocialSettings({facebook_auto:!!b.facebook_auto,whatsapp_active_chats_auto:!!b.whatsapp_active_chats_auto,allow_labeled_demo_images:!!b.allow_labeled_demo_images});return NextResponse.json({ok:true,settings})}
// Manual publishing. Facebook: posts once; `repost:true` (explicit admin confirmation) allows posting the same vehicle again.
export async function POST(req:Request){const d=await adminDenied();if(d)return d;const b=await req.json();const id=Number(b.vehicle_id);if(!id)return NextResponse.json({error:'vehicle_id required'},{status:400});const out:any={};if(b.channel==='facebook'||b.channel==='both')out.facebook=await publishVehicleToFacebook(id,{manual:true,repost:!!b.repost});if(b.channel==='whatsapp'||b.channel==='both')out.whatsapp=await publishVehicleToActiveWhatsAppChats(id,true);return NextResponse.json({ok:true,result:out})}
