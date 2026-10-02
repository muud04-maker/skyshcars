import {NextResponse} from 'next/server';
import {adminDenied} from '../../../../lib/admin-guard';
import {getSocialSettings,saveSocialSettings,recentSocialLogs,publishVehicleToFacebook,publishVehicleToActiveWhatsAppChats} from '../../../../lib/social';
import {checkFacebookPage} from '../../../../lib/readiness';

export async function GET(){const d=await adminDenied();if(d)return d;const facebook=await checkFacebookPage();return NextResponse.json({settings:await getSocialSettings(),logs:await recentSocialLogs(),configured:{facebook:!!facebook.connected,facebookDetails:facebook,whatsapp:!!(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID)}})}
export async function PATCH(req:Request){const d=await adminDenied();if(d)return d;const b=await req.json();const settings=await saveSocialSettings({facebook_auto:!!b.facebook_auto,whatsapp_active_chats_auto:!!b.whatsapp_active_chats_auto,allow_labeled_demo_images:!!b.allow_labeled_demo_images});return NextResponse.json({ok:true,settings})}
export async function POST(req:Request){const d=await adminDenied();if(d)return d;const b=await req.json();const id=Number(b.vehicle_id);if(!id)return NextResponse.json({error:'vehicle_id required'},{status:400});const out:any={};if(b.channel==='facebook'||b.channel==='both')out.facebook=await publishVehicleToFacebook(id,true);if(b.channel==='whatsapp'||b.channel==='both')out.whatsapp=await publishVehicleToActiveWhatsAppChats(id,true);return NextResponse.json({ok:true,result:out})}
