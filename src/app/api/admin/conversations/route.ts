import {NextResponse} from 'next/server';
import {rows} from '../../../../lib/db';
import {adminDenied} from '../../../../lib/admin-guard';
export async function GET(){
 const d=await adminDenied();if(d)return d;
 const base=`co.id,co.channel,co.external_user_id,co.mode,co.last_message_at,c.full_name,c.phone,
   (SELECT body FROM messages m WHERE m.conversation_id=co.id ORDER BY m.id DESC LIMIT 1) preview,
   CASE WHEN (SELECT COALESCE(MAX(m1.id),0) FROM messages m1 WHERE m1.conversation_id=co.id AND m1.sender='customer' AND m1.direction='inbound')
          > (SELECT COALESCE(MAX(m2.id),0) FROM messages m2 WHERE m2.conversation_id=co.id AND m2.sender IN ('ai','human') AND m2.direction='outbound')
        THEN 1 ELSE 0 END needs_reply,
   (SELECT TIMESTAMPDIFF(MINUTE,(SELECT MAX(m3.created_at) FROM messages m3 WHERE m3.conversation_id=co.id AND m3.sender='customer' AND m3.direction='inbound'),NOW())) waiting_minutes`;
 // Part 6: needs_staff / ai_paused_until / lock_until / current car are admin-only fields.
 let conversations:any[];
 try{
   conversations=await rows<any>(`SELECT ${base},
     s.needs_staff,s.needs_staff_reason,s.ai_paused_until,s.lock_until,s.current_vehicle_id,
     (SELECT v.stock_no FROM vehicles v WHERE v.id=s.current_vehicle_id) current_stock_no
     FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id
     LEFT JOIN conversation_state s ON s.conversation_id=co.id
     ORDER BY (co.mode='human' AND needs_reply=1) DESC, needs_reply DESC, co.last_message_at DESC LIMIT 300`);
 }catch{
   conversations=await rows<any>(`SELECT ${base} FROM conversations co LEFT JOIN customers c ON c.id=co.customer_id
     ORDER BY needs_reply DESC,co.last_message_at DESC LIMIT 300`);
 }
 return NextResponse.json({conversations});
}
