import {ping} from '../../../../lib/db';
import {isAdmin} from '../../../../lib/admin';
import {whatsappConfigSummary} from '../../../../lib/meta';
export async function GET(){
  if(!(await isAdmin()))return Response.json({error:'unauthorized'},{status:401});
  let database='connected';try{await ping()}catch{database='error'}
  const wa=whatsappConfigSummary();
  return Response.json({
    web:'ready',database,
    whatsapp:wa.configured?'configured':'configuration_required',
    whatsapp_details:wa,
    facebook:process.env.META_PAGE_ACCESS_TOKEN?'configured':'configuration_required',
    deepseek:process.env.DEEPSEEK_API_KEY?'configured':'configuration_required'
  });
}
