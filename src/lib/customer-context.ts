/*
  Customer Context layer (Parts 2, 4, 5, 6).

  One person can talk to us on WhatsApp AND Messenger, over many chats and weeks. Everything here is
  keyed on customers.id - the stable identifier - so two people can never be mixed up:
    - customerList()   -> the searchable list behind /admin/customer-history
    - customer360()    -> profile, current interest, preferences, sales history, memory, notes
    - customerTimeline()-> ONE chronological timeline: messages (every channel), AI/staff replies,
                           referrals, memory changes, notes, quotes and system events

  Read-only for the AI path: nothing here fabricates data, and empty fields stay empty.
  Player queries are parameterised; counts come from indexed aggregates (no lifetime loads per reply).
*/
import { db, one, rows } from './db';
import { factsForCustomer, preferencesFromFacts } from './customer-facts';
import { notesForCustomer } from './staff-notes';

export type CustomerFilters = {
  q?: string; channel?: string; category?: string; needsReply?: boolean;
  handled?: 'ai' | 'staff' | ''; from?: string; to?: string; page?: number; limit?: number;
};

let assignedReady: Promise<void> | null = null;
/** Additive column: who on the team owns this customer (Part 2). */
export function ensureCustomerContextSchema() {
  if (!assignedReady) assignedReady = (async () => {
    try { await db().execute(`ALTER TABLE customers ADD COLUMN assigned_staff VARCHAR(191) NULL`); }
    catch (e: any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
  })().catch(e => { assignedReady = null; throw e; });
  return assignedReady;
}

const num = (v: any) => (v == null ? null : Number(v));

/** Searchable customer list with the live aggregates the admin page shows. */
export async function customerList(f: CustomerFilters = {}) {
  await ensureCustomerContextSchema();
  const w: string[] = ['1=1'], a: any[] = [];
  const q = String(f.q || '').trim();
  if (q) {
    const like = `%${q}%`;
    w.push(`(cu.full_name LIKE ? OR cu.phone LIKE ? OR cu.whatsapp_id LIKE ? OR cu.facebook_psid LIKE ?
      OR EXISTS (SELECT 1 FROM conversation_state s2 JOIN vehicles v2 ON v2.id=s2.current_vehicle_id
                 JOIN conversations c4 ON c4.id=s2.conversation_id
                 WHERE c4.customer_id=cu.id AND (v2.stock_no LIKE ? OR v2.brand LIKE ? OR v2.model LIKE ?))
      OR EXISTS (SELECT 1 FROM chat_referrals r JOIN conversations c5 ON c5.id=r.conversation_id
                 LEFT JOIN vehicles v3 ON v3.id=r.matched_vehicle_id
                 WHERE c5.customer_id=cu.id AND (r.headline LIKE ? OR r.body LIKE ? OR v3.stock_no LIKE ?)))`);
    a.push(like, like, like, like, like, like, like, like, like, like);
  }
  const channel = String(f.channel || '').trim();
  if (['whatsapp', 'facebook', 'website'].includes(channel)) {
    w.push('EXISTS (SELECT 1 FROM conversations cch WHERE cch.customer_id=cu.id AND cch.channel=?)');
    a.push(channel);
  }
  const category = String(f.category || '').trim();
  if (category === 'car' || category === 'motorcycle') {
    w.push(`EXISTS (SELECT 1 FROM conversation_state s3 JOIN vehicles v4 ON v4.id=s3.current_vehicle_id
      JOIN conversations c6 ON c6.id=s3.conversation_id WHERE c6.customer_id=cu.id AND v4.category=?)`);
    a.push(category);
  }
  const latest = `(SELECT c3.id FROM conversations c3 WHERE c3.customer_id=cu.id ORDER BY COALESCE(c3.last_message_at,c3.created_at) DESC, c3.id DESC LIMIT 1)`;
  if (f.needsReply) {
    w.push(`EXISTS (SELECT 1 FROM conversations c9 WHERE c9.id=${latest}
      AND (SELECT COALESCE(MAX(m6.id),0) FROM messages m6 WHERE m6.conversation_id=c9.id AND m6.sender='customer' AND m6.direction='inbound')
        > (SELECT COALESCE(MAX(m7.id),0) FROM messages m7 WHERE m7.conversation_id=c9.id AND m7.sender IN ('ai','human') AND m7.direction='outbound'))`);
  }
  if (f.handled === 'ai' || f.handled === 'staff') {
    const want = f.handled === 'ai' ? 'ai' : 'human';
    w.push(`EXISTS (SELECT 1 FROM messages mh WHERE mh.sender=? AND mh.id=(SELECT MAX(m8.id) FROM messages m8 WHERE m8.conversation_id=${latest} AND m8.sender IN ('ai','human') AND m8.direction='outbound'))`);
    a.push(want);
  }
  const from = String(f.from || '').trim(), to = String(f.to || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { w.push('g.last_contact >= ?'); a.push(`${from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { w.push('g.last_contact <= ?'); a.push(`${to} 23:59:59`); }
  const limit = Math.max(5, Math.min(100, Number(f.limit) || 30));
  const page = Math.max(1, Number(f.page) || 1);

  const list = await rows<any>(`SELECT cu.id,cu.full_name,cu.phone,cu.whatsapp_id,cu.facebook_psid,cu.country,
      cu.preferred_language,cu.notes,cu.assigned_staff,cu.created_at,
      g.conversation_count,g.channels,g.message_count,g.ai_count,g.staff_count,g.inbound_count,g.last_contact,g.last_message,
      lc.id last_conversation_id, lc.mode last_mode, lc.channel last_channel,
      s.current_vehicle_id, v.stock_no,v.brand,v.model,v.model_year,v.category,v.price_usd,
      (SELECT COALESCE(MAX(m4.id),0) FROM messages m4 WHERE m4.conversation_id=lc.id AND m4.sender='customer' AND m4.direction='inbound') last_in,
      (SELECT COALESCE(MAX(m5.id),0) FROM messages m5 WHERE m5.conversation_id=lc.id AND m5.sender IN ('ai','human') AND m5.direction='outbound') last_out
    FROM customers cu
    LEFT JOIN (
      SELECT c.customer_id,
        COUNT(DISTINCT c.id) conversation_count,
        GROUP_CONCAT(DISTINCT c.channel) channels,
        COUNT(m.id) message_count,
        SUM(CASE WHEN m.sender='ai' THEN 1 ELSE 0 END) ai_count,
        SUM(CASE WHEN m.sender='human' THEN 1 ELSE 0 END) staff_count,
        SUM(CASE WHEN m.sender='customer' AND m.direction='inbound' THEN 1 ELSE 0 END) inbound_count,
        MAX(m.created_at) last_contact,
        (SELECT m2.body FROM messages m2 JOIN conversations c2 ON c2.id=m2.conversation_id
          WHERE c2.customer_id=c.customer_id ORDER BY m2.id DESC LIMIT 1) last_message
      FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id
      GROUP BY c.customer_id
    ) g ON g.customer_id=cu.id
    LEFT JOIN conversations lc ON lc.id=${latest}
    LEFT JOIN conversation_state s ON s.conversation_id=lc.id
    LEFT JOIN vehicles v ON v.id=s.current_vehicle_id
    WHERE ${w.join(' AND ')}
    ORDER BY g.last_contact DESC, cu.id DESC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}`, a).catch(() => []);

  const total = Number((await one<any>(`SELECT COUNT(*) n FROM customers cu
      LEFT JOIN (
        SELECT c.customer_id, MAX(m.created_at) last_contact
        FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id GROUP BY c.customer_id
      ) g ON g.customer_id=cu.id
      WHERE ${w.join(' AND ')}`, a).catch(() => null))?.n || 0);

  return {
    total, page, limit,
    list: list.map((r: any) => ({
      ...r,
      id: Number(r.id),
      conversation_count: Number(r.conversation_count || 0),
      message_count: Number(r.message_count || 0),
      ai_count: Number(r.ai_count || 0),
      staff_count: Number(r.staff_count || 0),
      inbound_count: Number(r.inbound_count || 0),
      channels: String(r.channels || '').split(',').filter(Boolean),
      needs_reply: Number(r.last_in || 0) > Number(r.last_out || 0) ? 1 : 0,
      current_vehicle: r.current_vehicle_id
        ? { id: Number(r.current_vehicle_id), stock_no: r.stock_no, brand: r.brand, model: r.model, model_year: num(r.model_year), category: r.category, price_usd: num(r.price_usd) }
        : null,
    })),
  };
}

/** Everything the admin and the AI know about one customer (Part 6). */
export async function customer360(customerId: number) {
  const id = Number(customerId);
  if (!id) return null;
  await ensureCustomerContextSchema();
  const customer = await one<any>(`SELECT id,full_name,phone,whatsapp_id,facebook_psid,email,country,preferred_language,notes,assigned_staff,created_at,updated_at
    FROM customers WHERE id=? LIMIT 1`, [id]);
  if (!customer) return null;

  const [convs, stats, facts, history, notes, memory, quotes, referrals] = await Promise.all([
    rows<any>(`SELECT c.id,c.channel,c.external_user_id,c.mode,c.last_message_at,c.created_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) message_count
      FROM conversations c WHERE c.customer_id=? ORDER BY COALESCE(c.last_message_at,c.created_at) DESC`, [id]).catch(() => []),
    one<any>(`SELECT COUNT(m.id) message_count,
        SUM(CASE WHEN m.sender='customer' AND m.direction='inbound' THEN 1 ELSE 0 END) inbound_count,
        SUM(CASE WHEN m.sender='ai' THEN 1 ELSE 0 END) ai_count,
        SUM(CASE WHEN m.sender='human' THEN 1 ELSE 0 END) staff_count,
        MIN(m.created_at) first_contact, MAX(m.created_at) last_contact
      FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.customer_id=?`, [id]).catch(() => null),
    factsForCustomer(id).catch(() => []),
    rows<any>(`SELECT id,fact_key,old_value,new_value,action,source,changed_by,changed_at FROM customer_fact_events
      WHERE customer_id=? ORDER BY id DESC LIMIT 40`, [id]).catch(() => []),
    notesForCustomer(id, 50).catch(() => []),
    one<any>('SELECT summary,preferences_json,last_stock_no,message_count,updated_at FROM customer_memory WHERE customer_id=? LIMIT 1', [id]).catch(() => null),
    rows<any>(`SELECT q.id,q.reference,q.status,q.quoted_total_usd,q.quoted_vehicle_usd,q.quoted_shipping_usd,q.created_at,
        v.stock_no,v.brand,v.model,v.model_year
      FROM quote_requests q LEFT JOIN vehicles v ON v.id=q.vehicle_id
      WHERE q.customer_id=? ORDER BY q.id DESC LIMIT 30`, [id]).catch(() => []),
    rows<any>(`SELECT r.id,r.conversation_id,r.channel,r.headline,r.body,r.match_method,r.created_at,
        v.stock_no resolved_stock_no,v.brand resolved_brand,v.model resolved_model,v.model_year resolved_year,v.category resolved_category
      FROM chat_referrals r JOIN conversations c ON c.id=r.conversation_id
      LEFT JOIN vehicles v ON v.id=r.matched_vehicle_id
      WHERE c.customer_id=? ORDER BY r.id DESC LIMIT 20`, [id]).catch(() => []),
  ]);

  const latestConv = convs[0] || null;
  const state = latestConv
    ? await one<any>(`SELECT s.current_vehicle_id,s.current_vehicle_source,s.needs_staff,s.needs_staff_reason,s.slots,s.updated_at,
        v.stock_no,v.brand,v.model,v.trim_name,v.model_year,v.category,v.price_usd,v.fuel_type,v.transmission,v.steering,v.color,v.status
      FROM conversation_state s LEFT JOIN vehicles v ON v.id=s.current_vehicle_id
      WHERE s.conversation_id=? LIMIT 1`, [Number(latestConv.id)]).catch(() => null)
    : null;

  const currentInterest = state?.current_vehicle_id ? {
    vehicle_id: Number(state.current_vehicle_id),
    source: state.current_vehicle_source || null,
    referral: referrals.find((r: any) => r.resolved_stock_no) || null,
    stock_no: state.stock_no, brand: state.brand, model: state.model, trim_name: state.trim_name,
    model_year: num(state.model_year), category: state.category, price_usd: num(state.price_usd),
    fuel_type: state.fuel_type, transmission: state.transmission, steering: state.steering,
    color: state.color, status: state.status,
  } : null;

  const vehiclesDiscussed = [...new Map(
    [...referrals.filter((r: any) => r.resolved_stock_no).map((r: any) => [String(r.resolved_stock_no), {
      stock_no: r.resolved_stock_no, brand: r.resolved_brand, model: r.resolved_model, model_year: num(r.resolved_year),
      category: r.resolved_category, at: r.created_at,
    }]),
     ...quotes.filter((q: any) => q.stock_no).map((q: any) => [String(q.stock_no), {
       stock_no: q.stock_no, brand: q.brand, model: q.model, model_year: num(q.model_year), category: null, at: q.created_at,
     }])] as [string, any][],
  ).values()];

  return {
    customer: { ...customer, id: Number(customer.id) },
    channels: [...new Set(convs.map((c: any) => String(c.channel)))],
    conversations: convs.map((c: any) => ({ ...c, id: Number(c.id), message_count: Number(c.message_count || 0) })),
    stats: {
      message_count: Number(stats?.message_count || 0),
      inbound_count: Number(stats?.inbound_count || 0),
      ai_count: Number(stats?.ai_count || 0),
      staff_count: Number(stats?.staff_count || 0),
      first_contact: stats?.first_contact || null,
      last_contact: stats?.last_contact || null,
    },
    current_interest: currentInterest,
    preferences: preferencesFromFacts(facts),
    facts,
    memory: memory ? { summary: memory.summary || '', last_stock_no: memory.last_stock_no || null, updated_at: memory.updated_at } : null,
    fact_history: history,
    notes,
    quotes,
    referrals,
    vehicles_discussed: vehiclesDiscussed,
    slots: (() => { try { return state?.slots ? JSON.parse(state.slots) : {}; } catch { return {}; } })(),
    needs_staff: !!(state?.needs_staff),
    needs_staff_reason: state?.needs_staff_reason || null,
  };
}

export type TimelineEvent = {
  kind: 'message' | 'system' | 'referral' | 'memory' | 'note' | 'quote';
  at: string | null; conversation_id?: number | null; channel?: string | null;
  sender?: string | null; title: string; body?: string | null; meta?: any;
};

/** Assign (or clear) the team member who owns this customer. */
export async function setAssignedStaff(customerId: number, staff: string | null) {
  await ensureCustomerContextSchema();
  const value = String(staff == null ? '' : staff).trim().slice(0, 191) || null;
  await db().execute('UPDATE customers SET assigned_staff=? WHERE id=?', [value, Number(customerId)]);
  return { ok: true, assigned_staff: value };
}

/** ONE chronological timeline for a customer across every channel (Part 4). */
export async function customerTimeline(customerId: number, opts: { limit?: number; channels?: string[] } = {}) {
  const id = Number(customerId);
  if (!id) return { events: [] as TimelineEvent[] };
  const limit = Math.max(20, Math.min(400, Number(opts.limit) || 120));
  const per = Math.max(20, Math.min(200, limit));
  const [msgs, systems, refs, factEvents, noteRows, quoteRows] = await Promise.all([
    rows<any>(`SELECT m.id,m.conversation_id,m.sender,m.direction,m.message_type,m.body,m.delivery_status,m.created_at,
        c.channel,c.external_user_id FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.customer_id=? ORDER BY m.id DESC LIMIT ${per}`, [id]).catch(() => []),
    rows<any>(`SELECT e.id,e.conversation_id,e.event_type,e.status,e.details,e.created_at,c.channel
      FROM ai_agent_events e JOIN conversations c ON c.id=e.conversation_id
      WHERE c.customer_id=? AND e.event_type IN ('referral_matched','referral_unmatched','human_reply','reply','staff_echo','staff_flag','mode_changed','ai_queued')
      ORDER BY e.id DESC LIMIT 60`, [id]).catch(() => []),
    rows<any>(`SELECT r.id,r.conversation_id,r.channel,r.headline,r.body,r.match_method,r.created_at,
        v.stock_no,v.brand,v.model FROM chat_referrals r JOIN conversations c ON c.id=r.conversation_id
      LEFT JOIN vehicles v ON v.id=r.matched_vehicle_id WHERE c.customer_id=? ORDER BY r.id DESC LIMIT 20`, [id]).catch(() => []),
    rows<any>(`SELECT id,fact_key,old_value,new_value,action,source,changed_by,changed_at FROM customer_fact_events
      WHERE customer_id=? ORDER BY id DESC LIMIT 30`, [id]).catch(() => []),
    rows<any>(`SELECT id,note,author,created_at FROM staff_notes WHERE customer_id=? AND active=1 ORDER BY id DESC LIMIT 30`, [id]).catch(() => []),
    rows<any>(`SELECT id,reference,status,quoted_total_usd,created_at FROM quote_requests WHERE customer_id=? ORDER BY id DESC LIMIT 20`, [id]).catch(() => []),
  ]);

  const wanted = (opts.channels || []).filter(Boolean);
  const events: TimelineEvent[] = [];
  for (const m of msgs) {
    if (wanted.length && !wanted.includes(String(m.channel))) continue;
    events.push({
      kind: 'message', at: m.created_at || null, conversation_id: Number(m.conversation_id), channel: m.channel,
      sender: m.sender, body: m.body == null ? null : String(m.body),
      title: m.sender === 'customer' ? 'Customer' : m.sender === 'ai' ? 'AI reply' : m.sender === 'human' ? 'Staff reply' : 'System',
      meta: { id: Number(m.id), direction: m.direction, message_type: m.message_type, delivery_status: m.delivery_status || null },
    });
  }
  for (const e of systems) {
    events.push({
      kind: 'system', at: e.created_at || null, conversation_id: Number(e.conversation_id), channel: e.channel,
      title: String(e.event_type || 'event').replace(/_/g, ' '), body: e.status === 'failed' ? 'failed' : null,
      meta: { id: Number(e.id), status: e.status, details: e.details ? String(e.details).slice(0, 300) : null },
    });
  }
  for (const r of refs) {
    events.push({
      kind: 'referral', at: r.created_at || null, conversation_id: Number(r.conversation_id), channel: r.channel,
      title: 'Facebook referral', body: r.headline || r.body || null,
      meta: {
        id: Number(r.id), method: r.match_method || 'unmatched',
        resolved: r.stock_no ? `${r.stock_no} ${r.brand || ''} ${r.model || ''}`.trim() : null,
      },
    });
  }
  for (const f of factEvents) {
    events.push({
      kind: 'memory', at: f.changed_at || null, title: `Memory ${f.action}`,
      body: `${String(f.fact_key).replace(/_/g, ' ')}: ${f.old_value ?? '(none)'} -> ${f.new_value ?? '(removed)'}`,
      meta: { source: f.source, by: f.changed_by },
    });
  }
  for (const n of noteRows) {
    events.push({ kind: 'note', at: n.created_at || null, title: 'Staff note', body: n.note, meta: { author: n.author } });
  }
  for (const q of quoteRows) {
    events.push({ kind: 'quote', at: q.created_at || null, title: `Quote ${q.reference || ''}`.trim(), body: q.status || null, meta: { total: q.quoted_total_usd == null ? null : Number(q.quoted_total_usd) } });
  }

  const time = (v: any) => { const t = v ? Date.parse(String(v).replace(' ', 'T')) : 0; return Number.isFinite(t) ? t : 0; };
  events.sort((a, b) => time(b.at) - time(a.at));
  return { events: events.slice(0, limit) };
}
