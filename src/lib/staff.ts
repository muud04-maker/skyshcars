/*
  Staff and AI working together. business_settings 'staff_ai_pause' = {minutes} (default 15):
  after any staff message the AI stays quiet in that chat for N minutes.
*/
import { db, one } from './db';

const parse = (v: any) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } };

export async function staffPauseMinutes() {
  try {
    const r = await one<any>(`SELECT setting_value FROM business_settings WHERE setting_key='staff_ai_pause'`);
    const m = Number(parse(r?.setting_value).minutes);
    return Number.isFinite(m) && m >= 1 && m <= 1440 ? Math.round(m) : 15;
  } catch { return 15; }
}

export async function saveStaffPauseMinutes(minutes: number) {
  const m = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 15)));
  await db().execute(`INSERT INTO business_settings(setting_key,setting_value) VALUES('staff_ai_pause',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [JSON.stringify({ minutes: m })]);
  return m;
}
