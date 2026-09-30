const VERIFY=process.env.META_VERIFY_TOKEN;
export async function GET(req:Request){
 const u=new URL(req.url),mode=u.searchParams.get("hub.mode"),token=u.searchParams.get("hub.verify_token"),challenge=u.searchParams.get("hub.challenge");
 if(mode==="subscribe"&&token&&token===VERIFY)return new Response(challenge||"",{status:200});
 return new Response("Forbidden",{status:403});
}
export async function POST(req:Request){
 const body=await req.json();
 // Production step: verify Meta signature, normalize events, persist conversation/message,
 // then route through the same AI/human conversation controller as WhatsApp.
 console.log("FACEBOOK_WEBHOOK",JSON.stringify(body));
 return new Response("EVENT_RECEIVED",{status:200});
}