import axios from 'axios';
import { db, one, rows } from './db';
import { createGroupImport, publicDescription, reviewGroupImport } from './group-import';
import { deliverVehicleToWhatsAppGroup, recentWhatsAppGroupAttempts, whatsappGroupDeliveryStatus } from './whatsapp-group-publish';
import {
  decideTelegramAutoPublish,
  largestTelegramPhoto,
  telegramAvailability,
  telegramChatApiId,
  telegramBotToken,
  telegramChatAllowed,
  telegramConfigSummary,
  telegramMessageKind,
  telegramSecret,
  telegramSourceChatId,
  telegramText,
} from './telegram-rules';
import { exactPhotoSql, sellableVehicleSql } from './exact-photos';
import { facebookStatus } from './facebook';

const SETTINGS_KEY = 'telegram_automation_v36';
const TELEGRAM_API = 'https://api.telegram.org';
const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024;
const ALBUM_QUIET_SECONDS = 4;

export type TelegramAutomationSettings = {
  enabled: boolean;
  auto_publish: boolean;
  auto_approve_new: boolean;
  auto_facebook: boolean;
  auto_whatsapp_group: boolean;
  min_extraction_confidence: number;
};

const DEFAULT_SETTINGS: TelegramAutomationSettings = {
  enabled: true,
  auto_publish: true,
  auto_approve_new: true,
  auto_facebook: true,
  auto_whatsapp_group: false,
  min_extraction_confidence: 0.65,
};

let schemaReady: Promise<void> | null = null;

export function ensureTelegramSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_updates(
      update_id BIGINT PRIMARY KEY,
      update_type VARCHAR(40) NULL,
      chat_id BIGINT NULL,
      message_id BIGINT NULL,
      state ENUM('stored','processing','processed','failed','ignored') NOT NULL DEFAULT 'stored',
      received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME NULL,
      error VARCHAR(1000) NULL,
      payload JSON NULL,
      INDEX(chat_id,message_id), INDEX(state,received_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_source_messages(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      message_id BIGINT NOT NULL,
      media_group_id VARCHAR(191) NULL,
      last_update_id BIGINT NULL,
      edit_date BIGINT NULL,
      message_thread_id BIGINT NULL,
      from_id BIGINT NULL,
      sender_name VARCHAR(191) NULL,
      chat_title VARCHAR(191) NULL,
      text TEXT NULL,
      caption TEXT NULL,
      message_kind VARCHAR(30) NOT NULL DEFAULT 'other',
      file_id VARCHAR(255) NULL,
      file_unique_id VARCHAR(255) NULL,
      media_width INT NULL,
      media_height INT NULL,
      file_size BIGINT NULL,
      processing_state ENUM('queued','processing','completed','review','failed','ignored') NOT NULL DEFAULT 'queued',
      retry_count INT UNSIGNED NOT NULL DEFAULT 0,
      next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      import_item_id BIGINT UNSIGNED NULL,
      vehicle_id BIGINT UNSIGNED NULL,
      prior_import_item_id BIGINT UNSIGNED NULL,
      prior_vehicle_id BIGINT UNSIGNED NULL,
      error VARCHAR(1000) NULL,
      payload JSON NULL,
      received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_telegram_message(chat_id,message_id),
      INDEX(media_group_id,processing_state), INDEX(processing_state,next_attempt_at),
      INDEX(import_item_id), INDEX(vehicle_id), INDEX(received_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_automation_events(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(80) NOT NULL,
      status VARCHAR(40) NOT NULL,
      update_id BIGINT NULL,
      source_message_id BIGINT UNSIGNED NULL,
      import_item_id BIGINT UNSIGNED NULL,
      vehicle_id BIGINT UNSIGNED NULL,
      details JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX(event_type,status,created_at), INDEX(update_id), INDEX(import_item_id), INDEX(vehicle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_connection_state(
      id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
      state VARCHAR(40) NOT NULL,
      webhook_url TEXT NULL,
      group_id VARCHAR(191) NULL,
      group_title VARCHAR(191) NULL,
      bot_id BIGINT NULL,
      bot_username VARCHAR(191) NULL,
      bot_is_admin BOOLEAN NULL,
      pending_updates INT NULL,
      last_error TEXT NULL,
      details JSON NULL,
      checked_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_source_pin(
      id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
      bot_id BIGINT NOT NULL,chat_id BIGINT NOT NULL,chat_title VARCHAR(191) NULL,chat_username VARCHAR(191) NULL,
      bot_member_status VARCHAR(40) NULL,pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      evidence JSON NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_discovery_lock(
      id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,last_attempt_at DATETIME NULL,
      result VARCHAR(80) NULL,details JSON NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS telegram_diagnostic_lock(
      id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,last_attempt_at DATETIME NULL,
      result VARCHAR(80) NULL,details JSON NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

export async function getTelegramSettings(): Promise<TelegramAutomationSettings> {
  await ensureTelegramSchema();
  try {
    const row: any = await one('SELECT setting_value FROM business_settings WHERE setting_key=?', [SETTINGS_KEY]);
    const value = typeof row?.setting_value === 'string' ? JSON.parse(row.setting_value) : row?.setting_value;
    return { ...DEFAULT_SETTINGS, ...(value || {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveTelegramSettings(input: Partial<TelegramAutomationSettings>) {
  await ensureTelegramSchema();
  const current = await getTelegramSettings();
  const next: TelegramAutomationSettings = {
    ...current,
    ...input,
    enabled: input.enabled === undefined ? current.enabled : !!input.enabled,
    auto_publish: input.auto_publish === undefined ? current.auto_publish : !!input.auto_publish,
    auto_approve_new: input.auto_approve_new === undefined ? current.auto_approve_new : !!input.auto_approve_new,
    auto_facebook: input.auto_facebook === undefined ? current.auto_facebook : !!input.auto_facebook,
    auto_whatsapp_group: false,
    min_extraction_confidence: Math.max(0.5, Math.min(1, Number(input.min_extraction_confidence ?? current.min_extraction_confidence) || 0.65)),
  };
  await db().execute(`INSERT INTO business_settings(setting_key,setting_value) VALUES(?,?)
    ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=CURRENT_TIMESTAMP`, [SETTINGS_KEY, JSON.stringify(next)]);
  return next;
}

async function telegramEvent(eventType: string, status: string, details: any = {}, extra: any = {}) {
  await ensureTelegramSchema();
  await db().execute(`INSERT INTO telegram_automation_events(
    event_type,status,update_id,source_message_id,import_item_id,vehicle_id,details
  ) VALUES(?,?,?,?,?,?,?)`, [
    eventType, status, extra.updateId ?? null, extra.sourceMessageId ?? null,
    extra.importItemId ?? null, extra.vehicleId ?? null, JSON.stringify(details || {}),
  ]).catch(() => {});
}

function safeTelegramError(error: any) {
  const description = error?.response?.data?.description;
  return String(description || error?.message || 'Telegram request failed').slice(0, 1000);
}

async function telegramApi(method: string, payload: Record<string, any> = {}, timeout = 20000) {
  const token = telegramBotToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await axios.post(`${TELEGRAM_API}/bot${token}/${method}`, payload, {
    timeout,
    maxBodyLength: 2 * 1024 * 1024,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.data?.ok) throw new Error(String(response.data?.description || 'Telegram API rejected the request'));
  return response.data.result;
}

function sourceMessageKey(chatId: string, messageId: number | string) {
  return `tg:${chatId}:${messageId}`;
}

function updateType(body: any) {
  for (const key of ['message', 'edited_message', 'channel_post', 'edited_channel_post']) {
    if (body?.[key]) return { key, message: body[key], edited: key.startsWith('edited_') };
  }
  return null;
}

/**
 * Store the update synchronously before returning 200. Telegram update IDs are the exact webhook
 * idempotency key, while chat/message IDs identify later edits of the same source message.
 */
export async function receiveTelegramUpdate(body: any) {
  await ensureTelegramSchema();
  const updateId = Number(body?.update_id);
  if (!Number.isSafeInteger(updateId)) throw new Error('Telegram update_id is missing');
  const parsed = updateType(body);
  if (!parsed) {
    return { accepted: true, stored: false, duplicate: false, state: 'ignored' };
  }
  const message = parsed.message;
  const chat = message?.chat;
  const pinned: any = await one<any>('SELECT chat_id,chat_username FROM telegram_source_pin WHERE id=1').catch(() => null);
  const allowed = pinned
    ? String(chat.id) === String(pinned.chat_id) || (!!chat.username && [String(pinned.chat_username || ''), `@${pinned.chat_username || ''}`].includes(String(chat.username)))
    : telegramChatAllowed(chat);
  if (!allowed) throw Object.assign(new Error('Telegram source chat is not authorized'), { statusCode: 403 });

  const chatId = Number(chat.id);
  const messageId = Number(message.message_id);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) throw new Error('Telegram chat/message ID is missing');
  const photo = largestTelegramPhoto(message);
  const kind = telegramMessageKind(message);
  const text = String(message.text || '').trim();
  const caption = String(message.caption || '').trim();
  const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ').trim() || message.from?.username || null;
  let sourceId = 0;
  let duplicate = false;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [receipt]: any = await connection.execute(`INSERT IGNORE INTO telegram_updates(
      update_id,update_type,chat_id,message_id,state,payload
    ) VALUES(?,?,?,?,'stored',?)`, [updateId, parsed.key, chatId, messageId, JSON.stringify(body)]);
    if (!Number(receipt.affectedRows)) {
      await connection.rollback();
      duplicate = true;
    } else {
      const [existingRows]: any = await connection.execute('SELECT * FROM telegram_source_messages WHERE chat_id=? AND message_id=? LIMIT 1', [chatId, messageId]);
      const existing = existingRows?.[0] || null;
      if (existing?.id && parsed.edited) {
        await connection.execute(`UPDATE telegram_source_messages SET
          media_group_id=COALESCE(?,media_group_id),last_update_id=?,edit_date=?,message_thread_id=?,from_id=?,sender_name=?,chat_title=?,
          text=?,caption=?,message_kind=?,file_id=?,file_unique_id=?,media_width=?,media_height=?,file_size=?,
          processing_state=IF(?='other','ignored','queued'),retry_count=0,next_attempt_at=NOW(),error=NULL,payload=?,processed_at=NULL,
          prior_import_item_id=COALESCE(prior_import_item_id,import_item_id),prior_vehicle_id=COALESCE(prior_vehicle_id,vehicle_id),
          import_item_id=NULL,vehicle_id=NULL
          WHERE id=?`, [
          message.media_group_id || null, updateId, Number(message.edit_date || 0) || null, message.message_thread_id || null,
          message.from?.id || null, senderName, chat.title || chat.username || null, text || null, caption || null, kind,
          photo?.file_id || null, photo?.file_unique_id || null, photo?.width || null, photo?.height || null, photo?.file_size || null,
          kind, JSON.stringify(body), existing.id,
        ]);
        sourceId = Number(existing.id);
      } else if (!existing?.id) {
        const [insert]: any = await connection.execute(`INSERT INTO telegram_source_messages(
          chat_id,message_id,media_group_id,last_update_id,edit_date,message_thread_id,from_id,sender_name,chat_title,
          text,caption,message_kind,file_id,file_unique_id,media_width,media_height,file_size,processing_state,payload
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          chatId, messageId, message.media_group_id || null, updateId, Number(message.edit_date || 0) || null,
          message.message_thread_id || null, message.from?.id || null, senderName, chat.title || chat.username || null,
          text || null, caption || null, kind, photo?.file_id || null, photo?.file_unique_id || null,
          photo?.width || null, photo?.height || null, photo?.file_size || null, kind === 'other' ? 'ignored' : 'queued',
          JSON.stringify(body),
        ]);
        sourceId = Number(insert.insertId);
      } else {
        await connection.execute('UPDATE telegram_updates SET state=? WHERE update_id=?', ['ignored', updateId]);
        duplicate = true;
      }
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  if (duplicate) {
    await telegramEvent('update_duplicate', 'ignored', { update_id: updateId, message_id: messageId }, { updateId });
    return { accepted: true, stored: false, duplicate: true, state: 'duplicate' };
  }

  await telegramEvent('message_received', kind === 'other' ? 'ignored' : 'ok', {
    update_type: parsed.key, message_id: messageId, media_group_id: message.media_group_id || null,
    has_photo: !!photo, text_length: (text || caption).length, edited: parsed.edited,
  }, { updateId, sourceMessageId: sourceId || null });
  return { accepted: true, stored: true, duplicate: false, sourceId, state: kind === 'other' ? 'ignored' : 'queued', edited: parsed.edited };
}

async function downloadTelegramPhoto(row: any) {
  if (!row.file_id) throw new Error('Telegram photo file_id is missing');
  const info = await telegramApi('getFile', { file_id: row.file_id }, 30000);
  const path = String(info?.file_path || '');
  const size = Number(info?.file_size || row.file_size || 0);
  if (!path) throw new Error('Telegram file path is missing');
  if (size > MAX_TELEGRAM_FILE_BYTES) throw new Error('Telegram photo exceeds the 20 MB limit');
  const token = telegramBotToken();
  const response = await axios.get(`${TELEGRAM_API}/file/bot${token}/${path}`, {
    responseType: 'arraybuffer', timeout: 45000, maxContentLength: MAX_TELEGRAM_FILE_BYTES,
  });
  const data = Buffer.from(response.data);
  if (!data.length || data.length > MAX_TELEGRAM_FILE_BYTES) throw new Error('Telegram photo download was empty or too large');
  let mimeType = String(response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!/^image\//.test(mimeType)) {
    const ext = path.split('.').pop()?.toLowerCase();
    mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  }
  return { data: data.toString('base64'), mimeType, fileId: row.file_id, fileUniqueId: row.file_unique_id };
}

async function claimTelegramJob() {
  const candidate: any = await one<any>(`SELECT * FROM telegram_source_messages
    WHERE processing_state IN ('queued','failed') AND retry_count<6 AND next_attempt_at<=NOW()
      AND (media_group_id IS NULL OR received_at<=(NOW()-INTERVAL ${ALBUM_QUIET_SECONDS} SECOND))
    ORDER BY id LIMIT 1`);
  if (!candidate) return [] as any[];
  if (candidate.media_group_id) {
    const latest: any = await one<any>(`SELECT TIMESTAMPDIFF(SECOND,MAX(received_at),NOW()) age FROM telegram_source_messages
      WHERE chat_id=? AND media_group_id=?`, [candidate.chat_id, candidate.media_group_id]);
    if (latest?.age == null || Number(latest.age) < ALBUM_QUIET_SECONDS) return [];
    const groupRows = await rows<any>(`SELECT * FROM telegram_source_messages WHERE chat_id=? AND media_group_id=?
      AND processing_state IN ('queued','failed') ORDER BY message_id`, [candidate.chat_id, candidate.media_group_id]);
    if (!groupRows.length) return [];
    const ids = groupRows.map((row) => Number(row.id));
    const [claimed]: any = await db().execute(`UPDATE telegram_source_messages SET processing_state='processing',retry_count=retry_count+1,error=NULL
      WHERE id IN (${ids.map(() => '?').join(',')}) AND processing_state IN ('queued','failed')`, ids);
    return Number(claimed.affectedRows) ? groupRows : [];
  }
  const [claimed]: any = await db().execute(`UPDATE telegram_source_messages SET processing_state='processing',retry_count=retry_count+1,error=NULL
    WHERE id=? AND processing_state IN ('queued','failed')`, [candidate.id]);
  return Number(claimed.affectedRows) ? [candidate] : [];
}

function parseProposed(raw: any) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function isoDate(value: any, fallback = new Date()) {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  return (Number.isNaN(parsed.getTime()) ? fallback : parsed).toISOString();
}

async function maybeAutoPublishTelegram(itemId: number) {
  const settings = await getTelegramSettings();
  const item: any = await one<any>('SELECT * FROM inventory_import_items WHERE id=? AND source=? LIMIT 1', [itemId, 'telegram']);
  if (!item) return { status: 'not-found', reasons: ['Telegram import not found'] };
  if (!settings.enabled || !settings.auto_publish || !settings.auto_approve_new) {
    return { status: 'review', reasons: ['Telegram automatic publishing is disabled'] };
  }
  if (item.review_status !== 'pending') return { status: item.review_status, reasons: [] };
  const proposed: any = parseProposed(item.proposed_vehicle);
  const raw: any = parseProposed(item.raw_payload);
  const media: any = await one<any>('SELECT COUNT(*) n FROM inventory_import_media WHERE import_item_id=?', [itemId]);
  const decision = decideTelegramAutoPublish({
    match_status: item.match_status,
    review_status: item.review_status,
    extraction_confidence: item.extraction_confidence,
    price_value: proposed.price_value,
    price_usd: proposed.price_usd,
    price_currency: proposed.price_currency,
    brand: proposed.brand,
    model: proposed.model,
    model_year: proposed.model_year,
    mileage_km: proposed.mileage_km,
    mileage_unit: proposed.mileage_unit,
    category: proposed.category,
    availability: proposed.availability,
    text: raw.text || '',
    photo_count: Number(media?.n || 0),
  }, settings.min_extraction_confidence);
  if (!decision.eligible) {
    await telegramEvent('automatic_review_required', 'review', { reasons: decision.reasons }, {
      importItemId: itemId, vehicleId: item.vehicle_id,
    });
    return { status: 'review', reasons: decision.reasons };
  }
  try {
    const result: any = await reviewGroupImport(Number(itemId), 'approve', {
      category: proposed.category,
      brand: proposed.brand,
      model: proposed.model,
      trim_name: proposed.trim_name,
      model_year: proposed.model_year,
      mileage_km: decision.mileage_km ?? proposed.mileage_km,
      mileage_unit: 'km',
      engine: proposed.engine,
      fuel_type: proposed.fuel_type,
      transmission: proposed.transmission,
      steering: proposed.steering,
      color: proposed.color,
      condition: proposed.condition,
      price_usd: decision.price_usd,
      description: publicDescription(proposed.description || raw.text || ''),
      ai_enabled: true,
      reviewer: 'telegram-auto',
    }, { publishFacebook: settings.auto_facebook });
    const whatsapp = await deliverVehicleToWhatsAppGroup(Number(result.vehicleId));
    await telegramEvent('automatic_published', 'ok', {
      facebook: result.automation?.facebook || null,
      whatsapp,
      price_usd: decision.price_usd,
    }, { importItemId: itemId, vehicleId: result.vehicleId });
    return {
      status: 'published',
      vehicleId: Number(result.vehicleId),
      facebook: result.automation?.facebook || null,
      whatsapp,
    };
  } catch (error: any) {
    await telegramEvent('automatic_publish_failed', 'failed', { error: safeTelegramError(error) }, {
      importItemId: itemId, vehicleId: item.vehicle_id,
    });
    return { status: 'pending', reasons: [safeTelegramError(error)] };
  }
}

async function processClaimedRows(sourceRows: any[]) {
  const first = sourceRows[0];
  const photos = [];
  const seenFiles = new Set<string>();
  for (const row of sourceRows) {
    if (!row.file_id || seenFiles.has(row.file_unique_id || row.file_id)) continue;
    const media = await downloadTelegramPhoto(row);
    photos.push(media);
    seenFiles.add(row.file_unique_id || row.file_id);
  }
  const texts = [...new Set(sourceRows.map((row) => String(row.caption || row.text || '').trim()).filter(Boolean))];
  const combinedText = texts.join('\n').slice(0, 20000);
  if (!combinedText && !photos.length) {
    await db().execute(`UPDATE telegram_source_messages SET processing_state='ignored',processed_at=NOW(),error=NULL
      WHERE id IN (${sourceRows.map(() => '?').join(',')})`, sourceRows.map((row) => row.id));
    return { state: 'ignored' };
  }
  const priorVehicleId = sourceRows.map((row) => Number(row.prior_vehicle_id || 0)).find(Boolean) || null;
  const priorImportItemId = sourceRows.map((row) => Number(row.prior_import_item_id || 0)).find(Boolean) || null;
  const edited = sourceRows.some((row) => Number(row.edit_date || 0) > 0);
  const album = String(first.media_group_id || '');
  const importMessageId = edited
    ? `tg-edit:${first.chat_id}:${first.message_id}:${first.last_update_id}`
    : album ? `tg-album:${first.chat_id}:${album}` : sourceMessageKey(String(first.chat_id), first.message_id);
  const payload = {
    source: 'telegram',
    messageId: importMessageId,
    messageIds: sourceRows.map((row) => sourceMessageKey(String(row.chat_id), row.message_id)),
    groupName: first.chat_title || telegramSourceChatId(),
    groupId: `telegram:${first.chat_id}`,
    sender: String(first.from_id || ''),
    senderName: first.sender_name || null,
    text: combinedText,
    receivedAt: isoDate(first.received_at),
    photoCount: photos.length,
    media: photos.map((photo) => ({ data: photo.data, mimeType: photo.mimeType, telegramFileId: photo.fileId, telegramFileUniqueId: photo.fileUniqueId })),
    existingVehicleId: priorVehicleId,
    telegram: {
      chatId: String(first.chat_id),
      messageIds: sourceRows.map((row) => Number(row.message_id)),
      updateIds: sourceRows.map((row) => Number(row.last_update_id)),
      mediaGroupId: album || null,
      edited,
      priorImportItemId,
    },
  };
  const imported: any = await createGroupImport(payload);
  const itemId = Number(imported.id);
  if (!itemId && imported.listing === false) {
    const ignoredIds = sourceRows.map((row) => Number(row.id));
    await db().execute(`UPDATE telegram_source_messages SET processing_state='ignored',processed_at=NOW(),error=NULL,
      prior_import_item_id=NULL,prior_vehicle_id=NULL WHERE id IN (${ignoredIds.map(() => '?').join(',')})`, ignoredIds);
    await db().execute(`UPDATE telegram_updates SET state='processed',processed_at=NOW(),error=NULL
      WHERE update_id IN (${sourceRows.map(() => '?').join(',')})`, sourceRows.map((row) => row.last_update_id));
    await telegramEvent('message_ignored', 'ok', { reason: 'not_a_vehicle_listing', photos: photos.length }, {
      sourceMessageId: Number(first.id),
    });
    return { state: 'ignored', photos: photos.length };
  }
  if (!itemId) throw new Error('Telegram import did not return an inventory review item');
  const item: any = await one<any>('SELECT * FROM inventory_import_items WHERE id=? LIMIT 1', [itemId]);
  const vehicleId = Number(item?.approved_vehicle_id || item?.matched_vehicle_id || item?.vehicle_id || imported.vehicleId || 0) || null;
  const auto = edited ? { status: 'review', reasons: ['Telegram edits require approval'] } : await maybeAutoPublishTelegram(itemId);
  const sourceState = ['review','pending','not-found'].includes(String(auto.status)) && item?.review_status === 'pending' ? 'review' : 'completed';
  const ids = sourceRows.map((row) => Number(row.id));
  await db().execute(`UPDATE telegram_source_messages SET processing_state=?,import_item_id=?,vehicle_id=?,processed_at=NOW(),error=NULL,
    prior_import_item_id=NULL,prior_vehicle_id=NULL WHERE id IN (${ids.map(() => '?').join(',')})`,
  [sourceState, itemId, vehicleId, ...ids]);
  await db().execute(`UPDATE telegram_source_messages SET processing_state=?,vehicle_id=? WHERE import_item_id=?`,
    [sourceState, vehicleId, itemId]).catch(() => {});
  await db().execute(`UPDATE telegram_updates SET state='processed',processed_at=NOW(),error=NULL
    WHERE update_id IN (${sourceRows.map(() => '?').join(',')})`, sourceRows.map((row) => row.last_update_id));
  await telegramEvent('message_processed', sourceState, {
    match_status: item?.match_status || null, auto, photos: photos.length, edited, media_group_id: album || null,
  }, { sourceMessageId: Number(first.id), importItemId: itemId, vehicleId });
  return { state: sourceState, itemId, vehicleId, auto, photos: photos.length };
}

/**
 * No cron: this is triggered by `after()` in the webhook (and by the admin Retry button).
 * A crash leaves queued/failed rows in MySQL, so the next Telegram delivery drains them again.
 */
export async function processTelegramQueue(maxGroups = 8) {
  await ensureTelegramSchema();
  const results = [];
  for (let index = 0; index < Math.max(1, Math.min(20, Number(maxGroups) || 8)); index++) {
    const claimed = await claimTelegramJob();
    if (!claimed.length) break;
    try {
      results.push(await processClaimedRows(claimed));
    } catch (error: any) {
      const message = safeTelegramError(error);
      const ids = claimed.map((row) => row.id);
      await db().execute(`UPDATE telegram_source_messages SET processing_state='failed',error=?,
        next_attempt_at=(NOW()+INTERVAL LEAST(60,POW(2,retry_count)*10) SECOND)
        WHERE id IN (${ids.map(() => '?').join(',')})`, [message, ...ids]).catch(() => {});
      await db().execute(`UPDATE telegram_updates SET state='failed',error=?
        WHERE update_id IN (${claimed.map(() => '?').join(',')})`, [message, ...claimed.map((row) => row.last_update_id)]).catch(() => {});
      await telegramEvent('message_failed', 'failed', { error: message }, { sourceMessageId: Number(claimed[0].id) });
      results.push({ state: 'failed', error: message });
    }
  }
  return results;
}

export async function retryTelegramFailures() {
  await ensureTelegramSchema();
  const [result]: any = await db().execute(`UPDATE telegram_source_messages SET next_attempt_at=NOW(),error=NULL
    WHERE processing_state='failed' AND retry_count<6`);
  await telegramEvent('manual_retry', 'ok', { queued: Number(result.affectedRows || 0) });
  const processed = await processTelegramQueue(12);
  return { ok: true, queuedForRetry: Number(result.affectedRows || 0), processed };
}

export async function telegramConnectionProbe() {
  await ensureTelegramSchema();
  const config = telegramConfigSummary();
  const pinned: any = await one<any>('SELECT * FROM telegram_source_pin WHERE id=1').catch(() => null);
  if (!config.configured) {
    const missing = [
      !config.bot_token_present && 'TELEGRAM_BOT_TOKEN',
      !config.webhook_secret_present && 'TELEGRAM_WEBHOOK_SECRET',
      !config.source_chat_id_present && 'TELEGRAM_SOURCE_CHAT_ID',
    ].filter(Boolean);
    const result = { ok: false, configured: false, missing, config };
    await db().execute(`INSERT INTO telegram_connection_state(id,state,last_error,checked_at)
      VALUES(1,'configuration_required',?,NOW()) ON DUPLICATE KEY UPDATE state='configuration_required',last_error=VALUES(last_error),checked_at=NOW()`,
    [`Missing ${missing.join(', ')}`]).catch(() => {});
    return result;
  }
  try {
    let me: any = null, webhook: any = null, chat: any = null;
    let meError: string | null = null, webhookError: string | null = null, chatError: string | null = null;
    try { me = await telegramApi('getMe'); } catch (error: any) { meError = safeTelegramError(error); }
    try { webhook = await telegramApi('getWebhookInfo'); } catch (error: any) { webhookError = safeTelegramError(error); }
    const apiChatId = pinned?.chat_id != null ? String(pinned.chat_id) : telegramChatApiId();
    try { chat = await telegramApi('getChat', { chat_id: apiChatId }); } catch (error: any) { chatError = safeTelegramError(error); }
    let member: any = null;
    let memberError: string | null = null;
    if (me?.id && chat?.id != null) {
      try { member = await telegramApi('getChatMember', { chat_id: apiChatId, user_id: me.id }); }
      catch (error: any) { memberError = safeTelegramError(error); }
    }
    const botIsAdmin = ['administrator', 'creator'].includes(String(member?.status || ''));
    const expectedUrl = String(process.env.TELEGRAM_WEBHOOK_URL || `${String(process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '')}/api/integrations/telegram/webhook`);
    const configuredSource = telegramSourceChatId();
    const result = {
      ok: !!me?.id && chat?.id != null && String(webhook?.url || '') === expectedUrl,
      configured: true,
      config,
      bot: { id: me?.id || null, username: me?.username || null, name: me?.first_name || null },
      group: { id: String(chat?.id || ''), title: chat?.title || chat?.username || null, username: chat?.username || null, type: chat?.type || null },
      bot_is_admin: botIsAdmin,
      bot_member_status: member?.status || null,
      source_chat_format: pinned?.chat_id != null ? 'pinned_numeric_group_id'
        : /^-\d+$/.test(configuredSource) ? 'negative_numeric_group_id'
        : /^@\w+$/.test(configuredSource) ? 'at_username'
        : /^\w+$/.test(configuredSource) ? 'username_without_at'
        : configuredSource ? 'unrecognized_format' : 'missing',
      errors: { bot: meError, webhook: webhookError, group: chatError, group_member: memberError },
      source_pinned: pinned?.chat_id != null,
      webhook: {
        url: webhook?.url || null,
        expected_url: expectedUrl,
        matches: String(webhook?.url || '') === expectedUrl,
        pending_update_count: Number(webhook?.pending_update_count || 0),
        last_error_date: webhook?.last_error_date || null,
        last_error_message: webhook?.last_error_message || null,
      },
    };
    await db().execute(`INSERT INTO telegram_connection_state(
      id,state,webhook_url,group_id,group_title,bot_id,bot_username,bot_is_admin,pending_updates,last_error,details,checked_at
    ) VALUES(1,?,?,?,?,?,?,?,?,?,?,NOW())
    ON DUPLICATE KEY UPDATE state=VALUES(state),webhook_url=VALUES(webhook_url),group_id=VALUES(group_id),
      group_title=VALUES(group_title),bot_id=VALUES(bot_id),bot_username=VALUES(bot_username),bot_is_admin=VALUES(bot_is_admin),
      pending_updates=VALUES(pending_updates),last_error=VALUES(last_error),details=VALUES(details),checked_at=NOW()`, [
      result.ok && botIsAdmin ? 'connected' : 'attention_required', expectedUrl, result.group.id, result.group.title,
      result.bot.id, result.bot.username, botIsAdmin ? 1 : 0, result.webhook.pending_update_count,
      result.ok ? null : (meError || webhookError || chatError || memberError || result.webhook.last_error_message || null), JSON.stringify(result),
    ]).catch(() => {});
    return result;
  } catch (error: any) {
    const message = safeTelegramError(error);
    await db().execute(`INSERT INTO telegram_connection_state(id,state,last_error,checked_at) VALUES(1,'failed',?,NOW())
      ON DUPLICATE KEY UPDATE state='failed',last_error=VALUES(last_error),checked_at=NOW()`, [message]).catch(() => {});
    return { ok: false, configured: true, config, error: message };
  }
}

export async function registerTelegramWebhook() {
  const config = telegramConfigSummary();
  if (!config.configured) throw new Error('Telegram configuration is incomplete');
  const url = String(process.env.TELEGRAM_WEBHOOK_URL || `${String(process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '')}/api/integrations/telegram/webhook`);
  if (!/^https:\/\//i.test(url)) throw new Error('Telegram webhook URL must use HTTPS');
  const result = await telegramApi('setWebhook', {
    url,
    secret_token: telegramSecret(),
    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    drop_pending_updates: false,
    max_connections: 20,
  });
  await telegramEvent('webhook_registered', 'ok', { url });
  return { ok: !!result, url, probe: await telegramConnectionProbe() };
}

/**
 * Safe production bootstrap: no caller-supplied URL or token, one attempt per minute.
 * The server-side environment registers only the fixed Sky Cars webhook and returns no secrets.
 */
export async function bootstrapTelegramWebhook() {
  await ensureTelegramSchema();
  const config = telegramConfigSummary();
  if (!config.configured) {
    return {
      ok: false,
      state: 'configuration_required',
      missing: [
        !config.bot_token_present && 'TELEGRAM_BOT_TOKEN',
        !config.webhook_secret_present && 'TELEGRAM_WEBHOOK_SECRET',
        !config.source_chat_id_present && 'TELEGRAM_SOURCE_CHAT_ID',
      ].filter(Boolean),
    };
  }
  const connection = await db().getConnection();
  let claimed = false;
  try {
    await connection.beginTransaction();
    await connection.execute(`INSERT IGNORE INTO telegram_connection_state(id,state,checked_at) VALUES(1,'bootstrap_pending',NULL)`);
    const [rowsFound]: any = await connection.execute('SELECT checked_at FROM telegram_connection_state WHERE id=1 FOR UPDATE');
    const checkedAt = rowsFound?.[0]?.checked_at ? new Date(rowsFound[0].checked_at).getTime() : 0;
    if (!checkedAt || Date.now() - checkedAt >= 60000) {
      await connection.execute("UPDATE telegram_connection_state SET state='bootstrap_pending',checked_at=NOW() WHERE id=1");
      claimed = true;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  if (!claimed) return { ok: true, state: 'recently_checked', webhook_registered: null };
  try {
    const registration = await registerTelegramWebhook();
    const probe: any = registration.probe;
    const processed = await processTelegramQueue(4).catch(() => []);
    const [sourceCount, importCount, lastSource, stateRows, lastJobError, photoStats, mediaCount, matchStats, publicationStats] = await Promise.all([
      one<any>('SELECT COUNT(*) n FROM telegram_source_messages').catch(() => null),
      one<any>(`SELECT COUNT(*) n, SUM(review_status='approved') approved FROM inventory_import_items WHERE source='telegram'`).catch(() => null),
      one<any>('SELECT MAX(received_at) at FROM telegram_source_messages').catch(() => null),
      rows<any>(`SELECT processing_state state,COUNT(*) n FROM telegram_source_messages GROUP BY processing_state`).catch(() => []),
      one<any>(`SELECT error FROM telegram_source_messages WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1`).catch(() => null),
      one<any>(`SELECT COUNT(*) total,SUM(processing_state IN ('completed','review')) processed,
        SUM(processing_state='failed') failed FROM telegram_source_messages WHERE message_kind='photo'`).catch(() => null),
      one<any>(`SELECT COUNT(*) n FROM inventory_import_media m JOIN inventory_import_items i ON i.id=m.import_item_id
        WHERE i.source='telegram'`).catch(() => null),
      one<any>(`SELECT SUM(match_status='new') new_count,SUM(match_status='confirmed') confirmed_count,
        SUM(match_status='possible') possible_count FROM inventory_import_items WHERE source='telegram'`).catch(() => null),
      one<any>(`SELECT SUM(l.channel='facebook' AND l.status='sent') facebook_sent,
        SUM(l.channel='facebook' AND l.status='failed') facebook_failed
        FROM social_publish_log l JOIN vehicles v ON v.id=l.vehicle_id WHERE v.source='telegram'`).catch(() => null),
    ]);
    return {
      ok: probe?.ok === true,
      state: probe?.ok ? 'registered' : 'attention_required',
      webhook_registered: probe?.webhook?.matches === true,
      bot_is_admin: probe?.bot_is_admin === true,
      group_identified: probe?.source_pinned || telegramChatAllowed(probe?.group),
      bot_username: probe?.bot?.username || null,
      group_title: probe?.group?.title || null,
      group_type: probe?.group?.type || null,
      source_chat_format: probe?.source_chat_format || null,
      webhook_url_matches: probe?.webhook?.matches === true,
      pending_update_count: Number(probe?.webhook?.pending_update_count || 0),
      webhook_last_error: probe?.webhook?.last_error_message || null,
      diagnostic: probe?.ok ? null : (probe?.errors?.group || probe?.errors?.member || probe?.error || probe?.webhook?.last_error_message || null),
      historical_webhook_error: probe?.webhook?.last_error_message || null,
      ingestion: {
        source_messages: Number(sourceCount?.n || 0),
        imports: Number(importCount?.n || 0),
        approved: Number(importCount?.approved || 0),
        last_received: lastSource?.at || null,
        states: Object.fromEntries(stateRows.map((row: any) => [String(row.state), Number(row.n || 0)])),
        last_job_error: lastJobError?.error ? String(lastJobError.error).slice(0, 500) : null,
        photos: {
          total: Number(photoStats?.total || 0),
          processed: Number(photoStats?.processed || 0),
          failed: Number(photoStats?.failed || 0),
          media_records: Number(mediaCount?.n || 0),
        },
        matches: {
          new: Number(matchStats?.new_count || 0),
          confirmed: Number(matchStats?.confirmed_count || 0),
          possible: Number(matchStats?.possible_count || 0),
        },
        facebook: {
          sent: Number(publicationStats?.facebook_sent || 0),
          failed: Number(publicationStats?.facebook_failed || 0),
        },
      },
      processed_jobs: processed.map((job: any) => ({ state: job.state, itemId: job.itemId || null, vehicleId: job.vehicleId || null })),
    };
  } catch (error: any) {
    return { ok: false, state: 'registration_failed', error: safeTelegramError(error) };
  }
}

/**
 * Discover the Telegram group from trusted Bot API updates when the configured source is a private
 * group title rather than a numeric ID/username. The webhook is restored before returning.
 */
export async function discoverTelegramSourceGroup() {
  await ensureTelegramSchema();
  const config = telegramConfigSummary();
  if (!config.configured) return { ok: false, state: 'configuration_required' };
  const lock = await db().getConnection();
  let claimed = false;
  try {
    await lock.beginTransaction();
    await lock.execute(`INSERT IGNORE INTO telegram_discovery_lock(id,last_attempt_at) VALUES(1,NULL)`);
    const [locked]: any = await lock.execute('SELECT last_attempt_at FROM telegram_discovery_lock WHERE id=1 FOR UPDATE');
    const last = locked?.[0]?.last_attempt_at ? new Date(locked[0].last_attempt_at).getTime() : 0;
    if (!last || Date.now() - last >= 60000) {
      await lock.execute('UPDATE telegram_discovery_lock SET last_attempt_at=NOW(),result=NULL,details=NULL WHERE id=1');
      claimed = true;
    }
    await lock.commit();
  } catch (error) {
    await lock.rollback().catch(() => {});
    throw error;
  } finally {
    lock.release();
  }
  if (!claimed) return { ok: true, state: 'recently_checked' };

  const url = String(process.env.TELEGRAM_WEBHOOK_URL || `${String(process.env.NEXT_PUBLIC_SITE_URL || 'https://skyshcars.com').replace(/\/$/, '')}/api/integrations/telegram/webhook`);
  let updates: any[] = [];
  let restoreError: string | null = null;
  try {
    await telegramApi('deleteWebhook', { drop_pending_updates: false });
    const pending = await telegramApi('getUpdates', {
      limit: 100, timeout: 0,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'my_chat_member', 'chat_member'],
    });
    updates = Array.isArray(pending) ? pending.slice(-100) : [];
  } finally {
    try {
      await telegramApi('setWebhook', {
        url, secret_token: telegramSecret(),
        allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
        drop_pending_updates: false, max_connections: 20,
      });
    } catch (error: any) {
      restoreError = safeTelegramError(error);
    }
  }

  const candidates = new Map<string, any>();
  for (const update of updates) {
    for (const key of ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'my_chat_member', 'chat_member']) {
      const chat = update?.[key]?.chat;
      if (!chat || !['group', 'supergroup', 'channel'].includes(String(chat.type || ''))) continue;
      const id = String(chat.id);
      if (!candidates.has(id)) candidates.set(id, {
        id, title: chat.title || null, username: chat.username || null, type: chat.type || null,
        bot_member_status: null,
      });
    }
  }
  const me = await telegramApi('getMe');
  for (const candidate of candidates.values()) {
    try {
      const member = await telegramApi('getChatMember', { chat_id: candidate.id, user_id: me.id });
      candidate.bot_member_status = member?.status || null;
    } catch {}
  }
  const adminGroups = [...candidates.values()].filter((group) => ['administrator', 'creator'].includes(String(group.bot_member_status)));
  const configured = telegramSourceChatId().replace(/^@/, '').toLowerCase();
  const namedMatches = adminGroups.filter((group) =>
    String(group.title || '').toLowerCase() === configured ||
    String(group.username || '').toLowerCase() === configured,
  );
  const selected = namedMatches.length === 1 ? namedMatches[0] : adminGroups.length === 1 ? adminGroups[0] : null;
  if (selected) {
    await db().execute(`INSERT INTO telegram_source_pin(
      id,bot_id,chat_id,chat_title,chat_username,bot_member_status,pinned_at,evidence
    ) VALUES(1,?,?,?,?,?,NOW(),?)
    ON DUPLICATE KEY UPDATE bot_id=VALUES(bot_id),chat_id=VALUES(chat_id),chat_title=VALUES(chat_title),
      chat_username=VALUES(chat_username),bot_member_status=VALUES(bot_member_status),pinned_at=NOW(),evidence=VALUES(evidence)`, [
      me.id, selected.id, selected.title, selected.username, selected.bot_member_status,
      JSON.stringify({ discovered_from: 'getUpdates', candidate_count: candidates.size, admin_group_count: adminGroups.length }),
    ]);
  }
  const details = {
    candidates: [...candidates.values()],
    admin_groups: adminGroups.length,
    named_matches: namedMatches.length,
    pinned: !!selected,
    restore_error: restoreError,
  };
  await db().execute(`UPDATE telegram_discovery_lock SET result=?,details=? WHERE id=1`,
    [selected ? 'pinned' : candidates.size ? 'selection_required' : 'no_updates', JSON.stringify(details)]).catch(() => {});
  if (selected) await telegramEvent('source_group_pinned', 'ok', details);
  const probe: any = selected ? await telegramConnectionProbe() : null;
  return {
    ok: !!selected && probe?.ok === true,
    state: selected ? 'pinned' : candidates.size ? 'selection_required' : 'no_group_updates',
    candidates: [...candidates.values()].map((group) => ({
      id: group.id, title: group.title, username: group.username, type: group.type, bot_member_status: group.bot_member_status,
    })),
    pinned_group: selected ? { id: selected.id, title: selected.title, username: selected.username } : null,
    bot_username: me?.username || null,
    webhook_restored: !restoreError,
    restore_error: restoreError,
    probe_ok: probe?.ok === true,
  };
}

/** Fixed harmless end-to-end webhook check. It accepts no target, text or credentials from callers. */
export async function runTelegramDiagnosticPing() {
  await ensureTelegramSchema();
  const pinned: any = await one<any>('SELECT * FROM telegram_source_pin WHERE id=1');
  if (!pinned?.chat_id) throw new Error('No verified Telegram source group is pinned');
  const lock = await db().getConnection();
  let claimed = false;
  try {
    await lock.beginTransaction();
    await lock.execute('INSERT IGNORE INTO telegram_diagnostic_lock(id,last_attempt_at) VALUES(1,NULL)');
    const [locked]: any = await lock.execute('SELECT last_attempt_at FROM telegram_diagnostic_lock WHERE id=1 FOR UPDATE');
    const last = locked?.[0]?.last_attempt_at ? new Date(locked[0].last_attempt_at).getTime() : 0;
    if (!last || Date.now() - last >= 10 * 60 * 1000) {
      await lock.execute("UPDATE telegram_diagnostic_lock SET last_attempt_at=NOW(),result='running',details=NULL WHERE id=1");
      claimed = true;
    }
    await lock.commit();
  } catch (error) {
    await lock.rollback().catch(() => {});
    throw error;
  } finally {
    lock.release();
  }
  if (!claimed) {
    const prior: any = await one<any>('SELECT details FROM telegram_diagnostic_lock WHERE id=1').catch(() => null);
    let messageId: number | null = null;
    try { messageId = Number(JSON.parse(String(prior?.details || '{}')).message_id) || null; } catch {}
    let deleted = false;
    if (messageId) {
      try {
        await telegramApi('deleteMessage', { chat_id: String(pinned.chat_id), message_id: messageId });
        deleted = true;
      } catch {}
    }
    if (deleted) {
      await db().execute("UPDATE telegram_diagnostic_lock SET result='cleaned' WHERE id=1").catch(() => {});
    }
    return { ok: true, state: deleted ? 'diagnostic_message_cleaned' : 'rate_limited', retry_after_seconds: 600 };
  }

  const settings = await saveTelegramSettings({
    auto_publish: false,
    auto_approve_new: false,
    auto_facebook: false,
    auto_whatsapp_group: false,
  });
  const marker = Date.now().toString(36).toUpperCase();
  const sent = await telegramApi('sendMessage', {
    chat_id: String(pinned.chat_id),
    text: `Sky Cars connection diagnostic ${marker}. No vehicle information. Ignore this message.`,
    disable_notification: true,
  });
  let delivered: any = null;
  for (let attempt = 0; attempt < 15 && !delivered; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    delivered = await one<any>('SELECT update_id,processing_state,message_kind,received_at FROM telegram_source_messages WHERE chat_id=? AND message_id=? LIMIT 1',
      [String(pinned.chat_id), sent.message_id]).catch(() => null);
  }
  if (delivered) {
    await processTelegramQueue(2).catch(() => []);
    delivered = await one<any>('SELECT update_id,processing_state,message_kind,received_at FROM telegram_source_messages WHERE chat_id=? AND message_id=? LIMIT 1',
      [String(pinned.chat_id), sent.message_id]).catch(() => delivered);
  }
  let deleted = false;
  if (!delivered) {
    try {
      await telegramApi('deleteMessage', { chat_id: String(pinned.chat_id), message_id: sent.message_id });
      deleted = true;
    } catch {}
  }
  const finalState = delivered ? 'delivered' : 'sent_bot_not_echoed';
  await db().execute(`UPDATE telegram_diagnostic_lock SET result=?,details=? WHERE id=1`, [
    finalState,
    JSON.stringify({ message_id: sent.message_id, update_id: delivered?.update_id || null }),
  ]).catch(() => {});
  await telegramEvent('diagnostic_ping', 'ok', {
    message_id: sent.message_id, delivered: !!delivered, deleted, bot_own_messages_not_echoed: !delivered, auto_publish: settings.auto_publish,
  });
  return {
    ok: true,
    state: finalState,
    group_id: String(pinned.chat_id),
    message_id: sent.message_id,
    update_id: delivered?.update_id || null,
    processing_state: delivered?.processing_state || null,
    webhook_checked: !!delivered,
    deleted,
    explanation: delivered ? null : 'Telegram does not deliver a bot’s own outgoing message back to the same bot webhook.',
    auto_publish: settings.auto_publish,
    no_vehicle_publication: true,
  };
}

export async function testTelegramSampleVehicle(vehicleId: number) {
  if (!vehicleId) throw new Error('Choose an authorized sample vehicle');
  const vehicle: any = await one<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.status,v.price_usd,
    (SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}) exact_photo_count
    FROM vehicles v WHERE v.id=? AND ${sellableVehicleSql('v')} LIMIT 1`, [vehicleId]);
  if (!vehicle) throw new Error('Sample vehicle is not Available');
  const [connectionResult, facebookResult] = await Promise.all([telegramConnectionProbe(), facebookStatus().catch((error: any) => ({
    configured: false, connected: false, error: safeTelegramError(error), warnings: [],
  }))]);
  const connection: any = connectionResult;
  const facebook: any = facebookResult;
  const checks = {
    telegram_configured: connection.configured,
    source_group_identified: connection.source_pinned || telegramChatAllowed(connection.group),
    bot_is_admin: connection.bot_is_admin === true,
    webhook_matches: connection.webhook?.matches === true,
    vehicle_available: vehicle.status === 'available',
    approved_usd_price: Number(vehicle.price_usd) > 0,
    original_photo: Number(vehicle.exact_photo_count) > 0,
    facebook_connected: facebook.connected === true,
    facebook_posting_permission: facebook.missingScopes ? facebook.missingScopes.length === 0 : facebook.connected === true,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    check_only: true,
    published: false,
    vehicle: { id: Number(vehicle.id), stock_no: vehicle.stock_no, brand: vehicle.brand, model: vehicle.model, price_usd: Number(vehicle.price_usd || 0) },
    checks,
    connection,
    facebook: { configured: facebook.configured, connected: facebook.connected, missing_scopes: facebook.missingScopes || null, error: facebook.error || null, warnings: facebook.warnings || [] },
    whatsapp_group: whatsappGroupDeliveryStatus(),
  };
}

export async function telegramDashboard() {
  await ensureTelegramSchema();
  const [settings, connectionRow, lastReceived, counts, sourceMessages, imports, events, publicationLogs, deliveries] = await Promise.all([
    getTelegramSettings(),
    one<any>('SELECT * FROM telegram_connection_state WHERE id=1').catch(() => null),
    one<any>("SELECT MAX(received_at) at FROM telegram_source_messages").catch(() => null),
    one<any>(`SELECT COUNT(*) updates, SUM(edit_date IS NOT NULL) edits FROM telegram_updates`).catch(() => null),
    rows<any>(`SELECT id,chat_id,message_id,media_group_id,last_update_id,edit_date,sender_name,chat_title,message_kind,
      processing_state,retry_count,next_attempt_at,import_item_id,vehicle_id,error,received_at,processed_at
      FROM telegram_source_messages ORDER BY id DESC LIMIT 80`).catch(() => []),
    rows<any>(`SELECT i.id,i.source_message_id,i.review_status,i.match_status,i.match_confidence,i.extraction_confidence,
      i.vehicle_id,i.matched_vehicle_id,i.approved_vehicle_id,i.created_at,v.stock_no,v.brand,v.model,v.model_year,v.status vehicle_status,
      (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) media_count
      FROM inventory_import_items i LEFT JOIN vehicles v ON v.id=i.vehicle_id
      WHERE i.source='telegram' ORDER BY i.id DESC LIMIT 50`).catch(() => []),
    rows<any>('SELECT * FROM telegram_automation_events ORDER BY id DESC LIMIT 60').catch(() => []),
    rows<any>(`SELECT l.*,v.stock_no,v.brand,v.model FROM social_publish_log l JOIN vehicles v ON v.id=l.vehicle_id
      WHERE v.source='telegram' AND l.channel='facebook' ORDER BY l.id DESC LIMIT 30`).catch(() => []),
    recentWhatsAppGroupAttempts(20),
  ]);
  const imported = await one<any>(`SELECT
    COUNT(*) total,
    SUM(review_status='approved') approved,
    SUM(review_status='pending') pending,
    SUM(match_status='confirmed') confirmed,
    SUM(match_status='possible') possible
    FROM inventory_import_items WHERE source='telegram'`).catch(() => null);
  const photos = await one<any>(`SELECT COUNT(*) total,
    SUM(processing_state IN ('completed','review')) processed,
    SUM(processing_state='failed') failed
    FROM telegram_source_messages WHERE message_kind='photo'`).catch(() => null);
  const failedJobs = sourceMessages.filter((row) => row.processing_state === 'failed');
  let connection: any = null;
  if (connectionRow) {
    try { connection = typeof connectionRow.details === 'string' ? JSON.parse(connectionRow.details) : connectionRow.details; } catch {}
  }
  return {
    settings,
    config: telegramConfigSummary(),
    connection: {
      state: connectionRow?.state || 'not_checked',
      checked_at: connectionRow?.checked_at || null,
      last_error: connectionRow?.last_error || null,
      details: connection || null,
    },
    last_received: lastReceived?.at || null,
    counts: {
      updates: Number(counts?.updates || 0),
      edits: Number(counts?.edits || 0),
      imported: Number(imported?.total || 0),
      approved: Number(imported?.approved || 0),
      pending: Number(imported?.pending || 0),
      confirmed_duplicates: Number(imported?.confirmed || 0),
      possible_duplicates: Number(imported?.possible || 0),
      failed_jobs: failedJobs.length,
    },
    photos: {
      total: Number(photos?.total || 0),
      processed: Number(photos?.processed || 0),
      failed: Number(photos?.failed || 0),
    },
    source_messages: sourceMessages,
    imports,
    events,
    facebook: publicationLogs,
    whatsapp_group: { status: whatsappGroupDeliveryStatus(), attempts: deliveries },
    failed_jobs: failedJobs,
  };
}

export async function telegramSampleVehicles() {
  return rows<any>(`SELECT v.id,v.stock_no,v.brand,v.model,v.model_year,v.price_usd,
    (SELECT COUNT(*) FROM vehicle_media m WHERE m.vehicle_id=v.id AND ${exactPhotoSql('m')}) exact_photo_count
    FROM vehicles v WHERE ${sellableVehicleSql('v')} AND v.price_usd>0 ORDER BY v.created_at DESC,v.id DESC LIMIT 100`).catch(() => []);
}

export async function recordTelegramAvailabilityProposal(itemId: number, text: string) {
  const availability = telegramAvailability(text);
  if (availability === 'unavailable') {
    await telegramEvent('availability_flagged', 'review', { availability }, { importItemId: itemId });
  }
  return availability;
}

export { largestTelegramPhoto, telegramText };
