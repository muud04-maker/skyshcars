import { db, one, rows } from './db';
import { fingerprintImage, hashDistance, type ImageFingerprint } from './image-fingerprints';
import {
  decideVehicleIdentity,
  identityShape,
  normalizeMileageKm,
  normalizePrice,
  normalizeReference,
  normalizeVin,
  type IdentityCandidate,
  type IdentitySpec,
} from './inventory-identity-rules';

let ready: Promise<void> | null = null;

async function addColumn(table: string, column: string, definition: string, index = '') {
  try {
    await db().execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}${index}`);
  } catch (error: any) {
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(String(error?.code))) throw error;
  }
}

export function ensureInventoryMemorySchema() {
  if (!ready) ready = (async () => {
    await addColumn('vehicles', 'vin', 'VARCHAR(32) NULL');
    await addColumn('vehicles', 'manufacturer', 'VARCHAR(120) NULL');
    await addColumn('vehicles', 'supplier_price_usd', 'DECIMAL(12,2) NULL');
    await addColumn('vehicles', 'supplier_currency', 'CHAR(3) NULL');
    await addColumn('vehicles', 'source_description', 'TEXT NULL');
    await addColumn('vehicles', 'extraction_method', 'VARCHAR(30) NULL');
    await addColumn('vehicles', 'extraction_quality', 'VARCHAR(20) NULL');
    await addColumn('vehicles', 'supplier_reference', 'VARCHAR(191) NULL', ', ADD INDEX idx_vehicle_supplier_ref(supplier_reference)');
    await addColumn('vehicles', 'vehicle_condition', 'VARCHAR(80) NULL');
    await addColumn('inventory_import_items', 'group_external_id', 'VARCHAR(191) NULL');
    await addColumn('inventory_import_items', 'matched_vehicle_id', 'BIGINT UNSIGNED NULL', ', ADD INDEX idx_import_matched_vehicle(matched_vehicle_id)');
    await addColumn('inventory_import_items', 'match_status', "VARCHAR(30) NOT NULL DEFAULT 'new'", ', ADD INDEX idx_import_match_status(match_status)');
    await addColumn('inventory_import_items', 'match_type', 'VARCHAR(80) NULL');
    await addColumn('inventory_import_items', 'match_confidence', 'DECIMAL(5,4) NULL');
    await addColumn('inventory_import_items', 'duplicate_risk', 'DECIMAL(5,4) NULL');
    await addColumn('inventory_import_items', 'extraction_confidence', 'DECIMAL(5,4) NULL');
    await addColumn('inventory_import_items', 'evidence_json', 'JSON NULL');
    await addColumn('inventory_import_items', 'last_observed_at', 'DATETIME NULL');
    await addColumn('inventory_import_items', 'approval_method', 'VARCHAR(30) NULL');
    await addColumn('inventory_import_items', 'approved_by', 'VARCHAR(191) NULL');

    await db().execute(`CREATE TABLE IF NOT EXISTS vehicle_identity_memory(
      vehicle_id BIGINT UNSIGNED PRIMARY KEY,
      stock_no VARCHAR(60) NULL,
      vin VARCHAR(32) NULL,
      supplier_reference VARCHAR(191) NULL,
      source_group_id VARCHAR(191) NULL,
      identity_key CHAR(64) NULL,
      category VARCHAR(30) NULL,
      brand VARCHAR(120) NULL,
      model VARCHAR(160) NULL,
      model_year SMALLINT NULL,
      mileage_km INT NULL,
      price_usd DECIMAL(12,2) NULL,
      currency CHAR(3) NULL,
      engine VARCHAR(120) NULL,
      transmission VARCHAR(80) NULL,
      fuel_type VARCHAR(80) NULL,
      vehicle_condition VARCHAR(80) NULL,
      color VARCHAR(80) NULL,
      image_sha256 JSON NULL,
      perceptual_hashes JSON NULL,
      publication_history JSON NULL,
      approved_changes JSON NULL,
      import_status VARCHAR(40) NULL,
      last_observed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX(stock_no), INDEX(vin), INDEX(supplier_reference), INDEX(identity_key),
      INDEX(brand,model,model_year), INDEX(last_observed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS vehicle_image_fingerprints(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      import_item_id BIGINT UNSIGNED NULL,
      source_url TEXT NULL,
      sha256 CHAR(64) NOT NULL,
      perceptual_hash CHAR(16) NULL,
      width INT NULL,
      height INT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vehicle_image(vehicle_id,sha256),
      INDEX(import_item_id), INDEX(sha256), INDEX(perceptual_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS inventory_identity_refs(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      import_item_id BIGINT UNSIGNED NULL,
      source_group_id VARCHAR(191) NULL,
      source_message_id VARCHAR(191) NOT NULL,
      supplier_reference VARCHAR(191) NULL,
      observed_at DATETIME NOT NULL,
      active_source BOOLEAN NOT NULL DEFAULT TRUE,
      evidence JSON NULL,
      UNIQUE KEY uq_identity_source(source_group_id,source_message_id),
      INDEX(vehicle_id), INDEX(import_item_id), INDEX(supplier_reference)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS inventory_match_candidates(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      import_item_id BIGINT UNSIGNED NOT NULL,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      confidence DECIMAL(5,4) NULL,
      reasons JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_import_candidate(import_item_id,vehicle_id),
      INDEX(vehicle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS inventory_change_proposals(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      import_item_id BIGINT UNSIGNED NOT NULL,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      change_type VARCHAR(40) NOT NULL,
      field_name VARCHAR(80) NULL,
      old_value TEXT NULL,
      new_value TEXT NULL,
      status ENUM('pending','applied','rejected') NOT NULL DEFAULT 'pending',
      evidence JSON NULL,
      reviewed_at DATETIME NULL,
      reviewed_by VARCHAR(191) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX(import_item_id), INDEX(vehicle_id), INDEX(status,change_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db().execute(`CREATE TABLE IF NOT EXISTS inventory_message_ledger(
      source_message_id VARCHAR(191) PRIMARY KEY,
      import_item_id BIGINT UNSIGNED NULL,
      state ENUM('processing','saved','failed') NOT NULL DEFAULT 'processing',
      error VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX(import_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Additive backfill. This only writes identity/reference memory; it never edits a vehicle or
    // triggers a publication.
    await db().execute(`INSERT IGNORE INTO vehicle_identity_memory(
      vehicle_id,stock_no,vin,supplier_reference,identity_key,category,brand,model,model_year,mileage_km,
      price_usd,engine,transmission,fuel_type,vehicle_condition,color,import_status,last_observed_at
    ) SELECT id,stock_no,NULLIF(UPPER(vin),''),supplier_reference,
      SHA2(CONCAT_WS('|',LOWER(COALESCE(brand,'')),LOWER(COALESCE(model,'')),COALESCE(model_year,''),COALESCE(stock_no,''),COALESCE(vin,'')),256),
      category,brand,model,model_year,mileage_km,price_usd,engine,transmission,fuel_type,vehicle_condition,color,status,NOW()
    FROM vehicles WHERE stock_no IS NOT NULL AND stock_no<>''`);
    await db().execute(`INSERT IGNORE INTO inventory_identity_refs(
      vehicle_id,import_item_id,source_group_id,source_message_id,supplier_reference,observed_at,evidence
    ) SELECT COALESCE(i.approved_vehicle_id,i.matched_vehicle_id,i.vehicle_id),i.id,
      COALESCE(i.group_external_id,JSON_UNQUOTE(JSON_EXTRACT(i.raw_payload,'$.groupId'))),
      i.source_message_id,NULL,COALESCE(i.reviewed_at,i.created_at),
      JSON_OBJECT('method','backfill_existing_import')
    FROM inventory_import_items i
    WHERE COALESCE(i.approved_vehicle_id,i.matched_vehicle_id,i.vehicle_id) IS NOT NULL
      AND i.source_message_id IS NOT NULL`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

export async function fingerprintBase64(data: string) {
  return fingerprintImage(Buffer.from(String(data || ''), 'base64'));
}

export async function fingerprintStoredMedia(url: string) {
  const name = String(url || '').startsWith('/media/') ? String(url).slice(7) : '';
  if (!name) return null;
  const row: any = await one<any>('SELECT data FROM media_blobs WHERE name=? LIMIT 1', [name]);
  return row?.data ? fingerprintImage(Buffer.from(row.data)) : null;
}

export async function storedMediaBuffer(url: string) {
  const name = String(url || '').startsWith('/media/') ? String(url).slice(7) : '';
  if (!name) return null;
  const row: any = await one<any>('SELECT data FROM media_blobs WHERE name=? LIMIT 1', [name]);
  return row?.data ? Buffer.from(row.data) : null;
}

export async function fingerprintMany(media: any[]) {
  const out: Array<ImageFingerprint & { url?: string | null }> = [];
  for (const item of Array.isArray(media) ? media.slice(0, 20) : []) {
    try {
      const fp = item?.data ? await fingerprintBase64(String(item.data)) : item?.url ? await fingerprintStoredMedia(String(item.url)) : null;
      if (fp) out.push({ ...fp, url: item?.url || null });
    } catch {}
  }
  return out;
}

export async function candidateVehicles(spec: IdentitySpec, fingerprints: ImageFingerprint[]) {
  await ensureInventoryMemorySchema();
  const shape = identityShape(spec);
  const hashes = fingerprints.map((fp) => fp.sha256).filter(Boolean);
  const found = new Map<number, any>();
  const add = (list: any[]) => list.forEach((row) => found.set(Number(row.id), row));

  if (spec.existing_vehicle_id) {
    add(await rows<any>(`SELECT id,category,brand,model,trim_name,model_year,mileage_km,price_usd,engine,transmission,
      fuel_type,color,vin,supplier_reference,stock_no,status FROM vehicles WHERE id=? LIMIT 1`, [Number(spec.existing_vehicle_id)]));
  }
  const stock = normalizeReference(spec.stock_no);
  const vin = normalizeVin(spec.vin);
  const supplier = normalizeReference(spec.supplier_reference);
  if (stock) add(await rows<any>(`SELECT id,category,brand,model,trim_name,model_year,mileage_km,price_usd,engine,transmission,
    fuel_type,color,vin,supplier_reference,stock_no,status FROM vehicles WHERE UPPER(REPLACE(stock_no,' ',''))=? LIMIT 25`, [stock]));
  if (vin) add(await rows<any>(`SELECT id,category,brand,model,trim_name,model_year,mileage_km,price_usd,engine,transmission,
    fuel_type,color,vin,supplier_reference,stock_no,status FROM vehicles WHERE UPPER(vin)=? LIMIT 25`, [vin]));
  if (supplier) add(await rows<any>(`SELECT id,category,brand,model,trim_name,model_year,mileage_km,price_usd,engine,transmission,
    fuel_type,color,vin,supplier_reference,stock_no,status FROM vehicles WHERE UPPER(supplier_reference)=? LIMIT 25`, [supplier]));
  if (stock || vin || supplier) {
    add(await rows<any>(`SELECT v.id,v.category,v.brand,v.model,v.trim_name,v.model_year,v.mileage_km,v.price_usd,v.engine,
      v.transmission,v.fuel_type,v.color,v.vin,v.supplier_reference,v.stock_no,v.status
      FROM vehicle_identity_memory m JOIN vehicles v ON v.id=m.vehicle_id
      WHERE (?<>'' AND UPPER(m.stock_no)=?) OR (?<>'' AND UPPER(m.vin)=?) OR (?<>'' AND UPPER(m.supplier_reference)=?)
      LIMIT 50`,[stock,stock,vin,vin,supplier,supplier]));
  }

  if (hashes.length) {
    add(await rows<any>(`SELECT v.id,v.category,v.brand,v.model,v.trim_name,v.model_year,v.mileage_km,v.price_usd,v.engine,
      v.transmission,v.fuel_type,v.color,v.vin,v.supplier_reference,v.stock_no,v.status
      FROM vehicle_image_fingerprints f JOIN vehicles v ON v.id=f.vehicle_id
      WHERE f.sha256 IN (${hashes.map(() => '?').join(',')}) LIMIT 50`, hashes));
  }

  if (shape.brand && shape.model) {
    add(await rows<any>(`SELECT id,category,brand,model,trim_name,model_year,mileage_km,price_usd,engine,transmission,
      fuel_type,color,vin,supplier_reference,stock_no,status FROM vehicles
      WHERE LOWER(TRIM(brand))=?
        AND (LOWER(TRIM(model))=? OR LOWER(TRIM(model)) LIKE CONCAT(?, ' %') OR ? LIKE CONCAT(LOWER(TRIM(model)), ' %'))
        AND (? IS NULL OR model_year=?)
      ORDER BY ABS(COALESCE(model_year,0)-?) LIMIT 30`,
      [shape.brand, shape.model, shape.model, shape.model, shape.model_year, shape.model_year, shape.model_year || 0]));
  }

  if (found.size) {
    const ids = [...found.keys()];
    const imageRows = await rows<any>(`SELECT vehicle_id,sha256,perceptual_hash FROM vehicle_image_fingerprints WHERE vehicle_id IN (${ids.map(() => '?').join(',')})`, ids);
    const grouped = new Map<number, any[]>();
    imageRows.forEach((row) => {
      const list = grouped.get(Number(row.vehicle_id)) || [];
      list.push(row);
      grouped.set(Number(row.vehicle_id), list);
    });
    for (const [id, row] of found) {
      const images = grouped.get(id) || [];
      row.image_hashes = images.map((x) => x.sha256);
      row.perceptual_hashes = images.map((x) => x.perceptual_hash).filter(Boolean);
    }
  }

  // Exact SHA first. A close dHash is only additional review evidence.
  for (const row of found.values()) {
    const exact = row.image_hashes?.some((hash: string) => hashes.includes(hash));
    const close = fingerprints.some((fp) => (row.perceptual_hashes || []).some((hash: string) => hashDistance(fp.perceptual_hash, hash) <= 6));
    if (close && !exact) row.review_only_image_similarity = true;
  }
  return [...found.values()] as IdentityCandidate[];
}

export async function matchVehicle(spec: IdentitySpec, fingerprints: ImageFingerprint[] = []) {
  const candidates = await candidateVehicles(spec, fingerprints);
  const decision = decideVehicleIdentity({
    ...spec,
    image_hashes: fingerprints.map((fp) => fp.sha256),
    perceptual_hashes: fingerprints.map((fp) => fp.perceptual_hash).filter(Boolean) as string[],
  }, candidates);
  return { ...decision, rawCandidates: candidates };
}

export async function recordMatchCandidates(importItemId: number, decision: ReturnType<typeof decideVehicleIdentity>) {
  for (const candidate of decision.candidates) {
    await db().execute(`INSERT INTO inventory_match_candidates(import_item_id,vehicle_id,confidence,reasons)
      VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE confidence=VALUES(confidence),reasons=VALUES(reasons)`,
      [importItemId, candidate.vehicle_id, candidate.confidence, JSON.stringify(candidate.reasons)]);
  }
}

export async function addImageFingerprint(vehicleId: number, importItemId: number | null, url: string | null, fp: ImageFingerprint, verified = false) {
  await ensureInventoryMemorySchema();
  await db().execute(`INSERT INTO vehicle_image_fingerprints(vehicle_id,import_item_id,source_url,sha256,perceptual_hash,width,height,verified)
    VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_url=COALESCE(source_url,VALUES(source_url)),verified=GREATEST(verified,VALUES(verified))`,
    [vehicleId, importItemId, url, fp.sha256, fp.perceptual_hash, fp.width, fp.height, verified ? 1 : 0]);
  const mem: any = await one<any>('SELECT image_sha256,perceptual_hashes FROM vehicle_identity_memory WHERE vehicle_id=? LIMIT 1', [vehicleId]);
  const sha = new Set<string>();
  const ph = new Set<string>();
  try { (Array.isArray(mem?.image_sha256) ? mem.image_sha256 : JSON.parse(mem?.image_sha256 || '[]')).forEach((x: any) => sha.add(String(x))); } catch {}
  try { (Array.isArray(mem?.perceptual_hashes) ? mem.perceptual_hashes : JSON.parse(mem?.perceptual_hashes || '[]')).forEach((x: any) => ph.add(String(x))); } catch {}
  sha.add(fp.sha256);
  if (fp.perceptual_hash) ph.add(fp.perceptual_hash);
  await db().execute('UPDATE vehicle_identity_memory SET image_sha256=?,perceptual_hashes=? WHERE vehicle_id=?',
    [JSON.stringify([...sha]), JSON.stringify([...ph]), vehicleId]);
}

export async function upsertIdentityMemory(vehicleId: number, sourceGroupId: string | null, spec: IdentitySpec & Record<string, any>, sourceMessageId?: string | null) {
  await ensureInventoryMemorySchema();
  const shape = identityShape(spec);
  const key = identityShape({ ...spec, stock_no: spec.stock_no || null });
  await db().execute(`INSERT INTO vehicle_identity_memory(
    vehicle_id,stock_no,vin,supplier_reference,source_group_id,identity_key,category,brand,model,model_year,mileage_km,
    price_usd,currency,engine,transmission,fuel_type,vehicle_condition,color,import_status,last_observed_at
  ) VALUES(?,?,?,?,?,SHA2(?,256),?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
  ON DUPLICATE KEY UPDATE stock_no=COALESCE(VALUES(stock_no),stock_no),vin=COALESCE(VALUES(vin),vin),
    supplier_reference=COALESCE(VALUES(supplier_reference),supplier_reference),
    source_group_id=COALESCE(VALUES(source_group_id),source_group_id),identity_key=VALUES(identity_key),
    category=COALESCE(VALUES(category),category),brand=COALESCE(VALUES(brand),brand),model=COALESCE(VALUES(model),model),
    model_year=COALESCE(VALUES(model_year),model_year),mileage_km=COALESCE(VALUES(mileage_km),mileage_km),
    price_usd=COALESCE(VALUES(price_usd),price_usd),currency=COALESCE(VALUES(currency),currency),
    engine=COALESCE(VALUES(engine),engine),transmission=COALESCE(VALUES(transmission),transmission),
    fuel_type=COALESCE(VALUES(fuel_type),fuel_type),vehicle_condition=COALESCE(VALUES(vehicle_condition),vehicle_condition),
    color=COALESCE(VALUES(color),color),import_status=VALUES(import_status),last_observed_at=NOW()`,
    [vehicleId, spec.stock_no || null, shape.vin || null, spec.supplier_reference || null, sourceGroupId,
      JSON.stringify(key), spec.category || null, spec.brand || null, spec.model || null, shape.model_year,
      shape.mileage_km, shape.price_usd, spec.price_currency || null, spec.engine || null, spec.transmission || null,
      spec.fuel_type || null, spec.condition || null, spec.color || null, spec.status || 'pending_verification']);
  if (sourceMessageId) {
    await db().execute(`INSERT IGNORE INTO inventory_identity_refs(
      vehicle_id,import_item_id,source_group_id,source_message_id,supplier_reference,observed_at,evidence
    ) VALUES(?,NULL,?,?,?,NOW(),JSON_OBJECT('method','group_import'))`,
    [vehicleId, sourceGroupId, sourceMessageId, spec.supplier_reference || null]);
  }
}

const CHANGE_FIELDS: Record<string, string> = {
  price: 'price_usd', price_usd: 'price_usd', mileage: 'mileage_km', mileage_km: 'mileage_km',
  brand: 'brand', model: 'model', model_year: 'model_year', engine: 'engine',
  transmission: 'transmission', fuel_type: 'fuel_type', color: 'color',
  vehicle_condition: 'vehicle_condition', condition: 'vehicle_condition', description: 'description',
};

export async function proposeVehicleChanges(importItemId: number, vehicleId: number, proposed: Record<string, any>) {
  await ensureInventoryMemorySchema();
  const vehicle: any = await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
  if (!vehicle) return [];
  const fields = ['price_usd', 'mileage_km', 'brand', 'model', 'trim_name', 'model_year', 'engine', 'transmission', 'fuel_type', 'color', 'vehicle_condition', 'description'];
  const changes: any[] = [];
  for (const field of fields) {
    const incoming = field === 'price_usd' ? normalizePrice(proposed.price_usd, proposed.price_currency).value
      : field === 'mileage_km' ? normalizeMileageKm(proposed.mileage_km, proposed.mileage_unit)
      : proposed[field] ?? (field === 'vehicle_condition' ? proposed.condition : undefined);
    if (incoming === null || incoming === undefined || incoming === '') continue;
    const old = vehicle[field];
    if (old === null || old === undefined) continue;
    if (String(old).trim().toLowerCase() !== String(incoming).trim().toLowerCase()) {
      const type = field === 'price_usd' ? 'price_change' : field === 'mileage_km' ? 'mileage_change' : 'spec_change';
      const [r]: any = await db().execute(`INSERT INTO inventory_change_proposals(
        import_item_id,vehicle_id,change_type,field_name,old_value,new_value,evidence
      ) VALUES(?,?,?,?,?,?,JSON_OBJECT('source_message_id',(SELECT source_message_id FROM inventory_import_items WHERE id=?)))`,
      [importItemId, vehicleId, type, CHANGE_FIELDS[field] || field, String(old), String(incoming), importItemId]);
      changes.push({ id: Number(r.insertId), type, field, old_value: old, new_value: incoming });
    }
  }
  if (vehicle.status === 'sold' || vehicle.status === 'hidden') {
    const [r]: any = await db().execute(`INSERT INTO inventory_change_proposals(
      import_item_id,vehicle_id,change_type,field_name,old_value,new_value,evidence
    ) VALUES(?,?,'availability_change','status',?,'available',JSON_OBJECT('reason','sold_or_hidden_reappeared'))`,
    [importItemId, vehicleId, String(vehicle.status)]);
    changes.push({ id: Number(r.insertId), type: 'availability_change', field: 'status', old_value: vehicle.status, new_value: 'available' });
  }
  return changes;
}

export async function proposeAdditionalPhotos(importItemId: number, vehicleId: number, mediaUrls: string[]) {
  await ensureInventoryMemorySchema();
  let added = 0;
  for (const url of [...new Set(mediaUrls.filter(Boolean))]) {
    const existing: any = await one<any>('SELECT id FROM vehicle_media WHERE vehicle_id=? AND url=? LIMIT 1', [vehicleId, url]);
    if (existing) continue;
    const fingerprint = await fingerprintStoredMedia(url).catch(() => null);
    if (fingerprint) {
      const sameImage: any = await one<any>('SELECT id FROM vehicle_image_fingerprints WHERE vehicle_id=? AND sha256=? LIMIT 1', [vehicleId, fingerprint.sha256]);
      if (sameImage) continue;
    }
    const dupe: any = await one<any>("SELECT id FROM inventory_change_proposals WHERE import_item_id=? AND vehicle_id=? AND change_type='additional_photo' AND new_value=? AND status='pending' LIMIT 1", [importItemId, vehicleId, url]);
    if (dupe) continue;
    await db().execute(`INSERT INTO inventory_change_proposals(import_item_id,vehicle_id,change_type,field_name,new_value,evidence)
      VALUES(?,?,'additional_photo','vehicle_media.url',?,JSON_OBJECT('requires_approval',true))`, [importItemId, vehicleId, url]);
    added++;
  }
  return added;
}

export async function applyGroupImportChanges(importItemId: number, reviewer = 'admin') {
  await ensureInventoryMemorySchema();
  const item: any = await one<any>('SELECT * FROM inventory_import_items WHERE id=? LIMIT 1', [importItemId]);
  if (!item) throw new Error('Import item not found');
  const vehicleId = Number(item.matched_vehicle_id || item.approved_vehicle_id || item.vehicle_id);
  if (!vehicleId) throw new Error('No vehicle is linked to this import');
  const proposals = await rows<any>("SELECT * FROM inventory_change_proposals WHERE import_item_id=? AND status='pending' ORDER BY id", [importItemId]);
  const applied: string[] = [];
  for (const proposal of proposals) {
    if (proposal.change_type === 'additional_photo') {
      const max: any = await one<any>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM vehicle_media WHERE vehicle_id=?', [vehicleId]);
      const mediaSource = item.source === 'telegram' ? 'import' : 'whatsapp_group';
      await db().execute(`INSERT IGNORE INTO vehicle_media(vehicle_id,media_type,url,source,is_cover,sort_order,review_status)
        VALUES(?,'image',?,?,0,?,'approved')`,
        [vehicleId, proposal.new_value, mediaSource, Number(max?.n || 0)]);
      const fingerprint = await fingerprintStoredMedia(String(proposal.new_value)).catch(() => null);
      if (fingerprint) await addImageFingerprint(vehicleId, importItemId, String(proposal.new_value), fingerprint, true);
      applied.push('additional_photo');
    } else {
      const field = CHANGE_FIELDS[proposal.field_name] || CHANGE_FIELDS[proposal.change_type];
      if (!field) continue;
      await db().execute(`UPDATE vehicles SET ${field}=? WHERE id=?`, [proposal.new_value, vehicleId]);
      applied.push(field);
    }
    await db().execute("UPDATE inventory_change_proposals SET status='applied',reviewed_at=NOW(),reviewed_by=? WHERE id=? AND status='pending'", [reviewer, proposal.id]);
  }
  const vehicle: any = await one<any>('SELECT * FROM vehicles WHERE id=? LIMIT 1', [vehicleId]);
  if (vehicle) await upsertIdentityMemory(vehicleId, String(item.group_external_id || ''), { ...vehicle, supplier_reference: vehicle.supplier_reference }, null);
  if (applied.length) {
    const mem: any = await one<any>('SELECT approved_changes FROM vehicle_identity_memory WHERE vehicle_id=? LIMIT 1', [vehicleId]);
    let history: any[] = [];
    try { history = Array.isArray(mem?.approved_changes) ? mem.approved_changes : JSON.parse(mem?.approved_changes || '[]'); } catch {}
    history.push({ at: new Date().toISOString(), import_item_id: importItemId, fields: applied, reviewer });
    await db().execute('UPDATE vehicle_identity_memory SET approved_changes=? WHERE vehicle_id=?', [JSON.stringify(history.slice(-100)), vehicleId]);
  }
  await db().execute(`UPDATE inventory_import_items SET review_status='approved',matched_vehicle_id=?,approved_vehicle_id=COALESCE(approved_vehicle_id,?),
    match_status='confirmed',approval_method='manual_apply_changes',approved_by=?,reviewed_at=NOW(),last_observed_at=NOW() WHERE id=?`,
  [vehicleId, vehicleId, reviewer, importItemId]);
  return { ok: true, status: 'approved', mergedInto: vehicleId, applied };
}

export async function rejectGroupImportChanges(importItemId: number, reviewer = 'admin') {
  await db().execute("UPDATE inventory_change_proposals SET status='rejected',reviewed_at=NOW(),reviewed_by=? WHERE import_item_id=? AND status='pending'", [reviewer, importItemId]);
}

export async function backfillInventoryIdentity(limit = 50) {
  await ensureInventoryMemorySchema();
  let fingerprints = 0;
  const pending = await rows<any>(`SELECT m.vehicle_id,m.url FROM vehicle_media m
    LEFT JOIN vehicle_image_fingerprints f ON f.vehicle_id=m.vehicle_id AND f.source_url=m.url
    WHERE m.media_type='image' AND f.id IS NULL AND m.url LIKE '/media/%' ORDER BY m.id LIMIT ${Math.max(1, Math.min(200, Number(limit) || 50))}`);
  for (const media of pending) {
    try {
      const fp = await fingerprintStoredMedia(String(media.url));
      if (!fp) continue;
      await addImageFingerprint(Number(media.vehicle_id), null, String(media.url), fp, true);
      fingerprints++;
    } catch {}
  }
  const counts = await one<any>(`SELECT (SELECT COUNT(*) FROM vehicles) vehicles,
    (SELECT COUNT(*) FROM vehicle_identity_memory) remembered,
    (SELECT COUNT(*) FROM inventory_identity_refs) refs,
    (SELECT COUNT(*) FROM vehicle_image_fingerprints) fingerprints`);
  return { ok: true, processed: pending.length, fingerprints_added: fingerprints, counts };
}

export async function refreshPublicationMemory() {
  await ensureInventoryMemorySchema();
  const logs = await rows<any>(`SELECT vehicle_id,channel,status,external_id,created_at FROM social_publish_log ORDER BY id DESC LIMIT 500`).catch(() => []);
  const grouped = new Map<number, any[]>();
  for (const row of logs) {
    const list = grouped.get(Number(row.vehicle_id)) || [];
    list.push(row);
    grouped.set(Number(row.vehicle_id), list);
  }
  for (const [vehicleId, history] of grouped) {
    await db().execute('UPDATE vehicle_identity_memory SET publication_history=? WHERE vehicle_id=?', [JSON.stringify(history.slice(0, 30)), vehicleId]);
  }
}
