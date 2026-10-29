import { createHash } from 'crypto';
import { db, one, rows } from './db';
import { attachImportOriginalPhotos, ensureGroupImportSchema } from './group-import';
import { extractSupplierVehicles, type SupplierVehicleDraft } from './vehicle-extraction';

const REPAIR_VERSION = 'v38-source-association-1';
const SETTINGS_KEY = 'telegram_automation_v36';
const MONDAY_GROUP_ID = '14346119203217452';
const VW_GROUP_ID = '14346142692990236';
const MOTO_GROUP_ID = '14346127676388732';

type SourceMessage = {
  id: number;
  chat_id: string;
  message_id: number;
  import_item_id: number | null;
  media_group_id: string | null;
  file_unique_id: string | null;
  text: string | null;
  caption: string | null;
  from_id: string | number | null;
  chat_title: string | null;
  received_at: string;
};

type ImportRow = {
  id: number;
  source_message_id: string;
  raw_payload: any;
  proposed_vehicle: any;
  review_status: string;
  vehicle_id: number | null;
  matched_vehicle_id: number | null;
  approved_vehicle_id: number | null;
};

type MediaRow = {
  id: number;
  import_item_id: number;
  url: string;
  mime_type: string | null;
};

const parse = (value: any) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
};

const sourceKey = (chatId: string | number, messageId: string | number) => `tg:${chatId}:${messageId}`;
const repairKey = (chatId: string | number, vehicleKey: string) => `tg-assoc-v38:${chatId}:${vehicleKey}`;

function proposition(draft: SupplierVehicleDraft, text: string | null, association: any, evidence: any) {
  return {
    ...draft,
    description: text || null,
    original_description: text || null,
    confidence: null,
    repair_review_required: true,
    source_repair: { version: REPAIR_VERSION, review_required: true },
    association,
    evidence: {
      ...(draft.specs || {}),
      text: text || null,
      missing_fields: draft.missing_fields || [],
      source_repair: evidence,
    },
  };
}

function assertSourceGroup(group: SourceMessage[], expected: string, minimum: number) {
  if (!group.length || group.some((row) => row.media_group_id !== expected)) {
    throw new Error(`Telegram source album ${expected} is incomplete or has changed`);
  }
  if (group.length < minimum) throw new Error(`Telegram source album ${expected} has fewer photos than expected`);
  const uniqueFiles = new Set(group.map((row) => row.file_unique_id).filter(Boolean));
  if (uniqueFiles.size !== group.length) throw new Error(`Telegram source album ${expected} contains duplicate photo IDs`);
  return uniqueFiles;
}

function uniqueSourceIds(...groups: SourceMessage[][]) {
  return [...new Set(groups.flat().map((row) => Number(row.message_id)))].sort((a, b) => a - b);
}

function safeDigest(value: any) {
  return createHash('sha256').update(JSON.stringify(value || null)).digest('hex');
}

async function extract(row: SourceMessage, brand: string, model: string) {
  const text = String(row.text || row.caption || '').trim();
  if (!text) throw new Error('Stored Telegram vehicle description is missing');
  const result = await extractSupplierVehicles(text);
  const draft = result.vehicles[0];
  if (
    !draft ||
    String(draft.brand || '').toLowerCase() !== brand.toLowerCase() ||
    String(draft.model || '').toLowerCase() !== model.toLowerCase()
  ) {
    throw new Error(`Stored Telegram description does not verify as ${brand} ${model}`);
  }
  return { draft, text };
}

async function updateMedia(
  media: MediaRow[],
  importItemId: number,
  photos: SourceMessage[],
  chatId: string,
  startOrder = 0,
  firstIsCover = false,
) {
  if (media.length !== photos.length) {
    throw new Error(`Photo evidence count mismatch for import ${importItemId}`);
  }
  for (let index = 0; index < media.length; index++) {
    const row = media[index];
    const photo = photos[index];
    await db().execute(`UPDATE inventory_import_media SET
      import_item_id=?,telegram_message_id=?,telegram_file_unique_id=?,source_message_key=?,is_cover=?,sort_order=?
      WHERE id=?`, [
      importItemId, Number(photo.message_id), photo.file_unique_id, sourceKey(chatId, photo.message_id),
      firstIsCover && index === 0 ? 1 : 0, startOrder + index, Number(row.id),
    ]);
  }
}

async function updateCanonicalImport(input: {
  item: ImportRow;
  vehicleId: number;
  chatId: string;
  groupName: string;
  groupId: string;
  sender: string | null;
  text: string | null;
  draft: SupplierVehicleDraft;
  sourceMessages: SourceMessage[];
  albumId: string | null;
  associationStatus: string;
  associationReason: string;
  associationEvidence: Record<string, any>;
}) {
  const { item, vehicleId, chatId, draft, text } = input;
  const evidence: Record<string, any> = {
    ...input.associationEvidence,
    version: REPAIR_VERSION,
    text_message_ids: input.sourceMessages.filter((row) => row.text || row.caption).map((row) => Number(row.message_id)),
    photo_message_ids: input.sourceMessages.filter((row) => row.file_unique_id).map((row) => Number(row.message_id)),
  };
  const association = {
    allowed: true,
    status: input.associationStatus,
    reason: input.associationReason,
    version: REPAIR_VERSION,
  };
  const proposed = proposition(draft, text, association, evidence);
  const mergedMessageIds = input.sourceMessages.map((row) => sourceKey(chatId, row.message_id));
  const raw = {
    groupName: input.groupName,
    groupId: input.groupId,
    sender: input.sender,
    text: text || '',
    receivedAt: input.sourceMessages[0]?.received_at || null,
    mediaGroupId: input.albumId,
    mergedMessageIds,
    evidence: proposed.evidence,
    association,
    source_repair: { version: REPAIR_VERSION, review_required: true, private_content_exposed: false },
  };
  const key = repairKey(chatId, evidence.vehicle_key);
  await db().execute(`UPDATE inventory_import_items SET source='telegram',source_message_id=?,raw_payload=?,proposed_vehicle=?,
    review_status='pending',group_external_id=?,matched_vehicle_id=NULL,match_status='new',match_type=?,
    match_confidence=NULL,duplicate_risk=0,extraction_confidence=NULL,evidence_json=?,association_status=?,
    association_evidence=?,reviewed_at=NULL,approval_method=NULL,approved_by=NULL,last_observed_at=NOW()
    WHERE id=? AND review_status<>'approved'`, [
    key, JSON.stringify(raw), JSON.stringify(proposed), input.groupId, 'V38 source-association repair',
    JSON.stringify({ extraction: proposed.evidence, association, source_repair: evidence }), input.associationStatus,
    JSON.stringify(association), Number(item.id),
  ]);
  const price = Number(draft.price_value);
  const supplierPriceUsd = String(draft.price_currency || '').toUpperCase() === 'USD' && Number.isFinite(price) && price > 0
    ? price : null;
  const [updated]: any = await db().execute(`UPDATE vehicles SET
    category=?,brand=?,manufacturer=?,model=?,trim_name=?,model_year=?,mileage_km=?,engine=?,transmission=?,
    fuel_type=?,steering=?,color=?,vehicle_condition=?,specs=?,price_usd=NULL,supplier_price_usd=?,
    supplier_currency=?,source_description=?,extraction_method=?,extraction_quality=?,ai_enabled=0
    WHERE id=? AND status='pending_verification'`, [
    draft.category, draft.brand, draft.manufacturer, draft.model, draft.trim_name, draft.model_year,
    draft.mileage_km, draft.engine, draft.transmission, draft.fuel_type, draft.steering || 'unknown',
    draft.color, draft.condition, JSON.stringify(draft.specs || {}), supplierPriceUsd,
    draft.price_currency || null, text, draft.extraction_method, draft.extraction_quality, vehicleId,
  ]);
  if (!Number(updated.affectedRows)) throw new Error(`Vehicle ${vehicleId} is no longer an editable pending draft`);
  await db().execute(`INSERT INTO inventory_message_ledger(source_message_id,import_item_id,state,error)
    VALUES(?,?,'saved',NULL)
    ON DUPLICATE KEY UPDATE import_item_id=VALUES(import_item_id),state='saved',error=NULL`, [key, Number(item.id)]);
  return { proposed, evidence, association };
}

async function linkSources(chatId: string, messages: SourceMessage[], itemId: number, vehicleId: number) {
  const ids = uniqueSourceIds(messages);
  if (!ids.length) return;
  await db().execute(`UPDATE telegram_source_messages SET import_item_id=?,vehicle_id=?,processing_state='review',error=NULL
    WHERE chat_id=? AND message_id IN (${ids.map(() => '?').join(',')})`,
  [itemId, vehicleId, chatId, ...ids]);
}

/**
 * One-time, bounded repair for the historical mixed Telegram albums. It reuses the existing
 * pending vehicle rows, moves only verified original media, and never approves or publishes.
 */
export async function repairTelegramSourceAssociations() {
  await ensureGroupImportSchema();
  const settingsRow: any = await one<any>('SELECT setting_value FROM business_settings WHERE setting_key=? LIMIT 1', [SETTINGS_KEY]);
  const settings = parse(settingsRow?.setting_value);
  if (settings.auto_publish === true || settings.auto_approve_new === true || settings.auto_facebook === true) {
    throw new Error('Disable Telegram automatic publication before repairing source associations');
  }

  const chatId = String((await one<any>('SELECT chat_id FROM telegram_source_messages ORDER BY id DESC LIMIT 1'))?.chat_id || '');
  if (!chatId) throw new Error('No stored Telegram source chat is available');
  const sourceRows = await rows<SourceMessage>(`SELECT id,CAST(chat_id AS CHAR) chat_id,message_id,import_item_id,media_group_id,
    file_unique_id,text,caption,from_id,chat_title,received_at FROM telegram_source_messages WHERE chat_id=? ORDER BY message_id`, [chatId]);
  const byMessage = new Map(sourceRows.map((row) => [Number(row.message_id), row]));
  const message = (id: number) => {
    const row = byMessage.get(id);
    if (!row) throw new Error(`Stored Telegram message ${id} is missing`);
    return row;
  };
  const album = (groupId: string) => sourceRows.filter((row) => row.media_group_id === groupId && row.file_unique_id);
  const mondeoPhotos = album(MONDAY_GROUP_ID);
  const vwPhotos = album(VW_GROUP_ID);
  const motoPhotos = album(MOTO_GROUP_ID);
  const mondeoFiles = assertSourceGroup(mondeoPhotos, MONDAY_GROUP_ID, 8);
  const vwFiles = assertSourceGroup(vwPhotos, VW_GROUP_ID, 7);
  const motoFiles = assertSourceGroup(motoPhotos, MOTO_GROUP_ID, 6);
  for (const [leftName, left] of [['Mondeo', mondeoFiles], ['VW', vwFiles], ['motorcycle', motoFiles]] as const) {
    for (const [rightName, right] of [['Mondeo', mondeoFiles], ['VW', vwFiles], ['motorcycle', motoFiles]] as const) {
      if (leftName < rightName && [...left].some((file) => right.has(file))) {
        throw new Error(`${leftName} and ${rightName} Telegram albums overlap`);
      }
    }
  }
  const mondeoText = message(36);
  const vwText = message(68);
  const vwRepeat = message(71);
  const anchor = message(69);
  if (!anchor.file_unique_id || !vwFiles.has(anchor.file_unique_id)) {
    throw new Error('The Volkswagen photo anchor does not match its verified album');
  }
  if (message(37).message_id - mondeoText.message_id > 2) {
    throw new Error('The Ford Mondeo description is not adjacent to its album');
  }
  const mondeoExtraction = await extract(mondeoText, 'Ford', 'Mondeo');
  const vwExtraction = await extract(vwText, 'Volkswagen', 'Touareg');
  const focusText = message(29);
  const focusExtraction = await extract(focusText, 'Ford', 'Focus');

  const canonicalIds = [
    Number(focusText.import_item_id), Number(mondeoText.import_item_id),
    Number(vwText.import_item_id), Number(motoPhotos[0].import_item_id),
  ];
  if (canonicalIds.some((id) => !id) || new Set(canonicalIds).size !== 4) {
    throw new Error('Canonical Telegram source imports are missing or duplicated');
  }
  const archiveItemId = Number(mondeoPhotos[0].import_item_id);
  if (!archiveItemId || canonicalIds.includes(archiveItemId)) {
    throw new Error('The mixed Telegram archive import could not be identified safely');
  }
  const mediaImportIds = [...canonicalIds, archiveItemId];
  const importRows = await rows<ImportRow>(`SELECT * FROM inventory_import_items
    WHERE id IN (${mediaImportIds.map(() => '?').join(',')})`, mediaImportIds);
  const byId = new Map(importRows.map((row) => [Number(row.id), row]));
  const item = (id: number) => {
    const row = byId.get(Number(id));
    if (!row || row.review_status === 'approved') throw new Error(`Telegram import ${id} is not an editable pending source`);
    return row;
  };
  const focusItem = item(Number(focusText.import_item_id));
  const mondeoItem = item(Number(mondeoText.import_item_id));
  const vwItem = item(Number(vwText.import_item_id));
  const motoItem = item(Number(motoPhotos[0].import_item_id));
  if ([focusItem, mondeoItem, vwItem, motoItem].some((row) => !row.vehicle_id)) {
    throw new Error('A canonical Telegram import is missing its pending vehicle draft');
  }

  const mediaRows = await rows<MediaRow>(`SELECT id,import_item_id,url,mime_type FROM inventory_import_media
    WHERE import_item_id IN (${mediaImportIds.map(() => '?').join(',')}) ORDER BY import_item_id,id`, mediaImportIds);
  const mediaFor = (id: number) => mediaRows.filter((row) => Number(row.import_item_id) === Number(id));
  const focusMedia = mediaFor(Number(focusItem.id));
  const mondeoMedia = mediaFor(Number(mondeoItem.id));
  const vwMedia = mediaFor(Number(vwItem.id));
  const motoMedia = mediaFor(Number(motoItem.id));
  if (focusMedia.length !== 5 || vwMedia.length !== 13 || motoMedia.length !== 6 || mondeoMedia.length !== 0) {
    if (motoMedia.length === 6 && vwMedia.length === 7) {
      return { ok: true, already_repaired: true, private_content_included: false };
    }
    throw new Error('Stored Telegram media layout differs from the verified repair plan');
  }
  const mondeoArchiveMedia = mondeoMedia.length ? mondeoMedia : [];
  const archivePhotos = mondeoPhotos;
  if (mondeoArchiveMedia.length) throw new Error('Unexpected Mondeo media state');

  const archiveItem = item(archiveItemId);
  const archiveMedia = mediaFor(archiveItemId);
  if (archiveMedia.length !== 15 || !archiveItem.vehicle_id) {
    throw new Error('Mixed Telegram archive import could not be identified safely');
  }
  const mondeoSourceMedia = archiveMedia.slice(0, mondeoFiles.size);
  const vwArchiveMedia = archiveMedia.slice(mondeoFiles.size);
  const motoDuplicateMedia = vwMedia.slice(0, motoFiles.size);
  const vwSourceMedia = vwMedia.slice(motoFiles.size);
  if (mondeoSourceMedia.length !== 8 || vwArchiveMedia.length !== 7 || motoDuplicateMedia.length !== 6 || vwSourceMedia.length !== 7) {
    throw new Error('Telegram media ranges do not match the verified source albums');
  }

  await updateMedia(mondeoSourceMedia, Number(mondeoItem.id), mondeoPhotos, chatId, 0, true);
  await updateMedia(focusMedia, Number(focusItem.id), sourceRows.filter((row) => row.message_id >= 30 && row.message_id <= 34), chatId, 0, true);
  await updateMedia(motoMedia, Number(motoItem.id), motoPhotos, chatId, 0, true);
  await updateMedia(vwSourceMedia, Number(vwItem.id), vwPhotos, chatId, 0, true);
  await updateMedia(vwArchiveMedia, archiveItemId, sourceRows.filter((row) => row.message_id >= 46 && row.message_id <= 52), chatId, 0, false);
  await updateMedia(motoDuplicateMedia, archiveItemId, sourceRows.filter((row) => row.message_id >= 60 && row.message_id <= 65), chatId, 7, false);

  const before = {
    focus: safeDigest(focusItem.raw_payload), mondeo: safeDigest(mondeoItem.raw_payload),
    vw: safeDigest(vwItem.raw_payload), motorcycle: safeDigest(motoItem.raw_payload),
  };
  const groupName = String(sourceRows[sourceRows.length - 1]?.chat_title || 'Skyshcars');
  const groupId = `telegram:${chatId}`;
  const sender = vwText.from_id == null ? null : String(vwText.from_id);
  const focus = await updateCanonicalImport({
    item: focusItem, vehicleId: Number(focusItem.vehicle_id), chatId, groupName, groupId, sender,
    text: focusExtraction.text, draft: focusExtraction.draft,
    sourceMessages: [focusText, ...sourceRows.filter((row) => row.message_id >= 30 && row.message_id <= 34)],
    albumId: '14346113385780156', associationStatus: 'semantic_adjacent',
    associationReason: 'sole adjacent Ford Focus description and original album',
    associationEvidence: { vehicle_key: 'ford-focus-2015', text_ids: [29], photo_ids: [30, 31, 32, 33, 34] },
  });
  const mondeo = await updateCanonicalImport({
    item: mondeoItem, vehicleId: Number(mondeoItem.vehicle_id), chatId, groupName, groupId, sender,
    text: mondeoExtraction.text, draft: mondeoExtraction.draft, sourceMessages: [mondeoText, ...mondeoPhotos],
    albumId: MONDAY_GROUP_ID, associationStatus: 'semantic_adjacent',
    associationReason: 'Ford Mondeo description immediately precedes its sole original album',
    associationEvidence: { vehicle_key: 'ford-mondeo-2018', text_ids: [36], photo_ids: uniqueSourceIds(mondeoPhotos) },
  });
  const vw = await updateCanonicalImport({
    item: vwItem, vehicleId: Number(vwItem.vehicle_id), chatId, groupName, groupId, sender,
    text: vwExtraction.text, draft: vwExtraction.draft, sourceMessages: [vwText, vwRepeat, anchor, ...vwPhotos],
    albumId: VW_GROUP_ID, associationStatus: 'semantic_adjacent',
    associationReason: 'Volkswagen descriptions, duplicate photo anchor and original album verify one vehicle',
    associationEvidence: {
      vehicle_key: 'volkswagen-touareg-2008', text_ids: [68, 71], anchor_id: 69,
      photo_ids: uniqueSourceIds(vwPhotos), duplicate_description_removed: true,
    },
  });
  const motoDraft: SupplierVehicleDraft = {
    category: 'motorcycle', brand: 'Triumph', manufacturer: 'Triumph', model: 'Bobber',
    trim_name: 'Bobber 1200', model_year: 2020, manufacturing_date: null, mileage_value: null,
    mileage_unit: null, mileage_km: null, engine: '1200cc', transmission: null, fuel_type: null,
    drive_type: null, steering: null, color: null, condition: null,
    price_value: 10125, price_currency: 'USD', price_usd: 10125, original_description: '',
    specs: { source: 'owner_confirmed_telegram_repair', engine_capacity: '1200cc' },
    missing_fields: ['mileage', 'transmission', 'fuel', 'color', 'condition'],
    extraction_quality: 'partial', extraction_method: 'deterministic',
  };
  const moto = await updateCanonicalImport({
    item: motoItem, vehicleId: Number(motoItem.vehicle_id), chatId, groupName, groupId, sender,
    text: null, draft: motoDraft, sourceMessages: motoPhotos, albumId: MOTO_GROUP_ID,
    associationStatus: 'manual_source_repair',
    associationReason: 'owner-confirmed Triumph Bobber album; incomplete fields remain unknown',
    associationEvidence: {
      vehicle_key: 'triumph-bobber-2020', text_ids: [], photo_ids: uniqueSourceIds(motoPhotos),
      owner_confirmed: { year: 2020, engine: '1200cc', source_price_usd: 10125 },
    },
  });

  await linkSources(chatId, [focusText, ...sourceRows.filter((row) => row.message_id >= 30 && row.message_id <= 34)], Number(focusItem.id), Number(focusItem.vehicle_id));
  await linkSources(chatId, [mondeoText, ...mondeoPhotos], Number(mondeoItem.id), Number(mondeoItem.vehicle_id));
  await linkSources(chatId, [vwText, vwRepeat, anchor, ...vwPhotos], Number(vwItem.id), Number(vwItem.vehicle_id));
  await linkSources(chatId, motoPhotos, Number(motoItem.id), Number(motoItem.vehicle_id));
  await linkSources(chatId, sourceRows.filter((row) => row.message_id >= 60 && row.message_id <= 65), archiveItemId, Number(archiveItem.vehicle_id));

  const superseded = [archiveItemId];
  const duplicateImportId = Number(message(81).import_item_id);
  if (duplicateImportId && !canonicalIds.includes(duplicateImportId)) superseded.push(duplicateImportId);
  const supersededVehicles = [Number(archiveItem.vehicle_id)];
  const duplicateImport: any = duplicateImportId
    ? await one<any>('SELECT vehicle_id FROM inventory_import_items WHERE id=? LIMIT 1', [duplicateImportId])
    : null;
  if (duplicateImport?.vehicle_id) supersededVehicles.push(Number(duplicateImport.vehicle_id));

  await db().execute(`UPDATE inventory_import_items SET review_status='rejected',reviewed_at=NOW(),
    approval_method='source_association_superseded',approved_by='v38-repair',
    association_status='superseded',last_observed_at=NOW()
    WHERE id IN (${superseded.map(() => '?').join(',')}) AND review_status<>'approved'`, superseded);
  const pendingSuperseded = [...new Set(supersededVehicles.filter(Boolean))];
  if (pendingSuperseded.length) {
    await db().execute(`UPDATE vehicles SET status='hidden',ai_enabled=0 WHERE id IN (${pendingSuperseded.map(() => '?').join(',')})
      AND status='pending_verification'`, pendingSuperseded);
    await db().execute(`UPDATE vehicle_media SET review_status='rejected',is_cover=0
      WHERE vehicle_id IN (${pendingSuperseded.map(() => '?').join(',')})
      AND source IN ('import','whatsapp_group')`, pendingSuperseded);
  }

  const canonicals = [
    { item: focusItem, vehicleId: Number(focusItem.vehicle_id) },
    { item: mondeoItem, vehicleId: Number(mondeoItem.vehicle_id) },
    { item: vwItem, vehicleId: Number(vwItem.vehicle_id) },
    { item: motoItem, vehicleId: Number(motoItem.vehicle_id) },
  ];
  for (const canonical of canonicals) {
    await db().execute(`UPDATE vehicle_media SET review_status='rejected',is_cover=0
      WHERE vehicle_id=? AND source IN ('import','whatsapp_group')`, [canonical.vehicleId]);
    await attachImportOriginalPhotos(Number(canonical.item.id), canonical.vehicleId);
  }

  await db().execute(`INSERT INTO audit_logs(actor,action,entity_type,entity_id,details)
    VALUES('v38-repair','telegram_source_association_repair','inventory_import',?,?)`, [
    canonicalIds.join(','), JSON.stringify({
      version: REPAIR_VERSION, canonical_ids: canonicalIds, superseded_ids: superseded,
      superseded_vehicle_ids: pendingSuperseded, prior_payload_digests: before,
      publications_made: 0, private_content_included: false,
    }),
  ]);

  const resultRows = await rows<any>(`SELECT i.id import_id,i.vehicle_id,v.stock_no,v.brand,v.model,v.model_year,
    v.category,v.supplier_price_usd,v.supplier_currency,v.price_usd,v.status,
    (SELECT COUNT(*) FROM inventory_import_media m WHERE m.import_item_id=i.id) photo_count
    FROM inventory_import_items i JOIN vehicles v ON v.id=i.vehicle_id
    WHERE i.id IN (${canonicalIds.map(() => '?').join(',')}) ORDER BY i.id`, canonicalIds);
  return {
    ok: true,
    version: REPAIR_VERSION,
    repaired: resultRows.map((row) => ({
      import_id: Number(row.import_id), vehicle_id: Number(row.vehicle_id), stock_no: row.stock_no,
      brand: row.brand, model: row.model, model_year: row.model_year == null ? null : Number(row.model_year),
      category: row.category, source_price_usd: row.supplier_price_usd == null ? null : Number(row.supplier_price_usd),
      supplier_currency: row.supplier_currency, selling_price_usd: row.price_usd == null ? null : Number(row.price_usd),
      status: row.status, photos: Number(row.photo_count || 0),
    })),
    associations: { focus, mondeo, volkswagen: vw, triumph: moto },
    superseded_import_ids: superseded,
    superseded_vehicle_ids: pendingSuperseded,
    published: false,
    private_content_included: false,
  };
}
