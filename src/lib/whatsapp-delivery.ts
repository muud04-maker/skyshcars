import axios from 'axios';
import { db, one, rows } from './db';
import { whatsappPhotosForVehicle } from './exact-photos';
import { sendWhatsApp, sendWhatsAppImage, whatsappConfigured } from './meta';

export const INVENTORY_WHATSAPP_RECIPIENT = '+8618587586441';
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v26.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function token() {
  return String(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '').trim();
}

function phoneNumberId() {
  return String(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || '').trim();
}

function templateName() {
  return String(process.env.WHATSAPP_VEHICLE_TEMPLATE_NAME || '').trim();
}

function templateLanguage() {
  return String(process.env.WHATSAPP_VEHICLE_TEMPLATE_LANGUAGE || 'en_US').trim();
}

function explicitOptIn() {
  return process.env.WHATSAPP_INVENTORY_OPT_IN_CONFIRMED === 'true';
}

function listedPrice(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD` : null;
}

function vehicleTitle(vehicle: any) {
  const title = [vehicle.model_year, vehicle.brand, vehicle.model, vehicle.trim_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return title || `Vehicle ${vehicle.stock_no || vehicle.id}`;
}

export function inventoryWhatsAppMessage(vehicle: any) {
  const title = vehicleTitle(vehicle);
  const price = listedPrice(vehicle.price_usd);
  if (!price) throw new Error('A final USD selling price is required');
  const link = `https://skyshcars.com/vehicles/${Number(vehicle.id)}`;
  return {
    title,
    price,
    link,
    body: `New arrival at Sky Cars\n${title}\n${price}${vehicle.stock_no ? `\nStock ${vehicle.stock_no}` : ''}\nOriginal unit photo included.\n${link}`,
  };
}

async function ensureDeliveryTable() {
  await db().execute(`CREATE TABLE IF NOT EXISTS inventory_whatsapp_deliveries(
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vehicle_id BIGINT UNSIGNED NOT NULL,
    recipient VARCHAR(32) NOT NULL,
    state ENUM('pending','processing','sent','failed','blocked') NOT NULL DEFAULT 'pending',
    title VARCHAR(191) NULL,price_text VARCHAR(40) NULL,listing_url TEXT NULL,image_url TEXT NULL,
    external_id VARCHAR(191) NULL,attempt_count INT UNSIGNED NOT NULL DEFAULT 0,last_error TEXT NULL,
    last_attempt_at DATETIME NULL,sent_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vehicle_recipient(vehicle_id,recipient),INDEX(state,updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function recipientConsent(recipient: string) {
  const digits = recipient.replace(/\D/g, '');
  const customer: any = await one<any>(`SELECT cu.marketing_opt_in,
      MAX(CASE WHEN m.direction='inbound' THEN m.created_at END) last_inbound
    FROM conversations c LEFT JOIN customers cu ON cu.id=c.customer_id LEFT JOIN messages m ON m.conversation_id=c.id
    WHERE c.channel='whatsapp' AND REPLACE(REPLACE(c.external_user_id,'+',''),' ','')=?
    GROUP BY cu.id,cu.marketing_opt_in LIMIT 1`, [digits]).catch(() => null);
  const activeWindow = !!customer?.last_inbound &&
    Date.now() - new Date(String(customer.last_inbound).replace(' ', 'T')).getTime() < 24 * 60 * 60 * 1000;
  return { optedIn: explicitOptIn() || customer?.marketing_opt_in === 1 || customer?.marketing_opt_in === true, activeWindow };
}

async function sendTemplate(recipient: string, message: ReturnType<typeof inventoryWhatsAppMessage>, imageUrl: string | null) {
  const name = templateName();
  if (!name || !token() || !phoneNumberId()) throw new Error('An approved WhatsApp vehicle template is not configured');
  const components: any[] = [];
  if (imageUrl && process.env.WHATSAPP_VEHICLE_TEMPLATE_IMAGE_HEADER === 'true') {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { link: imageUrl } }] });
  }
  components.push({
    type: 'body',
    parameters: [message.title, message.price, message.link].map((text) => ({ type: 'text', text })),
  });
  const response = await axios.post(`${GRAPH}/${phoneNumberId()}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient.replace(/\D/g, ''),
    type: 'template',
    template: {
      name,
      language: { code: templateLanguage() },
      components,
    },
  }, {
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return response.data?.messages?.[0]?.id || null;
}

async function attemptDelivery(id: number) {
  const row: any = await one<any>('SELECT * FROM inventory_whatsapp_deliveries WHERE id=? LIMIT 1', [id]);
  if (!row) throw new Error('WhatsApp delivery record not found');
  if (row.state === 'sent') return { ok: true, skipped: 'Already delivered', id, external_id: row.external_id };
  const vehicle: any = await one<any>(`SELECT id,stock_no,brand,trim_name,model,model_year,price_usd,status FROM vehicles
    WHERE id=? AND status='available' AND price_usd>0 AND COALESCE(source,'') NOT LIKE 'demo%' LIMIT 1`, [Number(row.vehicle_id)]);
  if (!vehicle) {
    const error = 'Vehicle is not an available, priced, production vehicle';
    await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='blocked',last_error=?,last_attempt_at=NOW() WHERE id=?`, [error, id]);
    return { ok: false, blocked: error, id };
  }
  const message = inventoryWhatsAppMessage(vehicle);
  const photo = (await whatsappPhotosForVehicle(Number(vehicle.id), 1))[0] || null;
  if (!photo) {
    const error = 'An approved original vehicle photo is required';
    await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='blocked',last_error=?,last_attempt_at=NOW() WHERE id=?`, [error, id]);
    return { ok: false, blocked: error, id };
  }
  const consent = await recipientConsent(row.recipient);
  if (!consent.optedIn) {
    const error = 'Recipient marketing opt-in is not recorded';
    await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='blocked',last_error=?,last_attempt_at=NOW() WHERE id=?`, [error, id]);
    return { ok: false, blocked: error, id };
  }
  if (!consent.activeWindow && !templateName()) {
    const error = 'Approved WhatsApp vehicle template is required outside the 24-hour service window';
    await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='blocked',last_error=?,last_attempt_at=NOW() WHERE id=?`, [error, id]);
    return { ok: false, blocked: error, id };
  }
  await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='processing',attempt_count=attempt_count+1,
    title=?,price_text=?,listing_url=?,image_url=?,last_error=NULL,last_attempt_at=NOW() WHERE id=?`,
  [message.title, message.price, message.link, photo.url, id]);
  try {
    const externalId = consent.activeWindow
      ? await sendWhatsAppImage(row.recipient, photo.url, message.body.slice(0, 1000))
      : await sendTemplate(row.recipient, message, photo.url);
    await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='sent',external_id=?,sent_at=NOW(),last_error=NULL WHERE id=?`,
      [externalId, id]);
    return { ok: true, id, external_id: externalId, recipient: row.recipient };
  } catch (error: any) {
    const messageText = String(error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error).slice(0, 1000);
    await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='failed',last_error=? WHERE id=?`, [messageText, id]);
    return { ok: false, id, error: messageText };
  }
}

export async function deliverNewVehicleToWhatsApp(vehicleId: number, recipient = INVENTORY_WHATSAPP_RECIPIENT) {
  await ensureDeliveryTable();
  const [inserted]: any = await db().execute(`INSERT IGNORE INTO inventory_whatsapp_deliveries(vehicle_id,recipient,state)
    VALUES(?,?,'pending')`, [vehicleId, recipient]);
  const row: any = await one<any>('SELECT * FROM inventory_whatsapp_deliveries WHERE vehicle_id=? AND recipient=? LIMIT 1',
    [vehicleId, recipient]);
  if (!row) throw new Error('WhatsApp delivery record could not be created');
  if (!inserted.affectedRows) {
    return {
      ok: row.state === 'sent', skipped: row.state === 'sent' ? 'Already delivered' : 'Delivery already recorded; use Admin Retry',
      state: row.state, id: row.id,
    };
  }
  return attemptDelivery(Number(row.id));
}

export async function retryInventoryWhatsAppDelivery(id: number) {
  await ensureDeliveryTable();
  const row: any = await one<any>('SELECT id,state FROM inventory_whatsapp_deliveries WHERE id=? LIMIT 1', [id]);
  if (!row) throw new Error('WhatsApp delivery record not found');
  if (row.state === 'sent') return { ok: true, skipped: 'Already delivered', id };
  await db().execute(`UPDATE inventory_whatsapp_deliveries SET state='pending',last_error=NULL WHERE id=?`, [id]);
  return attemptDelivery(id);
}

export async function inventoryWhatsAppDeliveryStatus() {
  await ensureDeliveryTable();
  const consent = await recipientConsent(INVENTORY_WHATSAPP_RECIPIENT);
  const deliveries = await rows<any>(`SELECT d.*,v.stock_no,v.brand,v.model,v.model_year
    FROM inventory_whatsapp_deliveries d LEFT JOIN vehicles v ON v.id=d.vehicle_id
    ORDER BY d.id DESC LIMIT 25`);
  return {
    recipient: INVENTORY_WHATSAPP_RECIPIENT,
    credentials_configured: whatsappConfigured(),
    opt_in_confirmed: consent.optedIn,
    active_window: consent.activeWindow,
    approved_template_name_configured: !!templateName(),
    template_language: templateLanguage(),
    blocker: !whatsappConfigured() ? 'WhatsApp Cloud API credentials are missing'
      : !consent.optedIn ? 'Recipient marketing opt-in is not recorded'
      : !consent.activeWindow && !templateName() ? 'Approved WhatsApp vehicle template is required outside the 24-hour service window'
      : null,
    deliveries,
  };
}
