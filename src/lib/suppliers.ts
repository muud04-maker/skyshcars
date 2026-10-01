import {db, rows, one} from './db';

export async function ensureSupplierSchema(){
  await db().execute(`CREATE TABLE IF NOT EXISTS private_suppliers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name_internal VARCHAR(191) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    enabled BOOLEAN DEFAULT TRUE,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX(enabled)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db().execute(`CREATE TABLE IF NOT EXISTS supplier_sources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id BIGINT UNSIGNED NOT NULL,
    base_url TEXT NULL,
    feed_url TEXT NULL,
    feed_format ENUM('json','csv','xml','manual') DEFAULT 'manual',
    default_markup_usd DECIMAL(12,2) NOT NULL DEFAULT 1000.00,
    permission_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    auth_header_name VARCHAR(120) NULL,
    auth_secret_env VARCHAR(120) NULL,
    last_sync_at DATETIME NULL,
    last_sync_status VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(supplier_id) REFERENCES private_suppliers(id) ON DELETE CASCADE,
    INDEX(supplier_id), INDEX(permission_confirmed)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db().execute(`CREATE TABLE IF NOT EXISTS supplier_vehicle_map (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id BIGINT UNSIGNED NOT NULL,
    supplier_vehicle_id VARCHAR(191) NOT NULL,
    vehicle_id BIGINT UNSIGNED NULL,
    source_url TEXT NULL,
    supplier_price_usd DECIMAL(12,2) NULL,
    markup_usd DECIMAL(12,2) NOT NULL DEFAULT 1000.00,
    raw_payload JSON NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_vehicle(supplier_id,supplier_vehicle_id),
    FOREIGN KEY(supplier_id) REFERENCES private_suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
    INDEX(vehicle_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Older master schema created this column as VARCHAR(80), too short to record real error messages.
  try{await db().execute('ALTER TABLE supplier_sources MODIFY last_sync_status VARCHAR(255) NULL')}catch{}
}
export function cleanSlug(v:string){return v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100)}
export async function ensureDefaultHongGuanMa(){
  await ensureSupplierSchema();
  let s:any=await one(`SELECT id FROM private_suppliers WHERE slug='hongguanma' LIMIT 1`);
  if(!s){const [r]:any=await db().execute(`INSERT INTO private_suppliers(name_internal,slug,enabled,notes) VALUES('HongGuanMa','hongguanma',1,'Authorized supplier requested by Sky Cars owner. Keep identity private on public pages.')`);s={id:r.insertId}}
  const ex:any=await one('SELECT id FROM supplier_sources WHERE supplier_id=? ORDER BY id LIMIT 1',[s.id]);
  if(!ex) await db().execute(`INSERT INTO supplier_sources(supplier_id,base_url,feed_format,default_markup_usd,permission_confirmed) VALUES(?,'https://hongguanma.com/','manual',1000,1)`,[s.id]);
  else await db().execute(`UPDATE supplier_sources SET base_url='https://hongguanma.com/',default_markup_usd=1000,permission_confirmed=1 WHERE id=?`,[ex.id]);
}
export async function supplierList(){await ensureDefaultHongGuanMa();return rows<any>(`SELECT s.*,src.base_url,src.feed_url,src.feed_format,src.default_markup_usd,src.permission_confirmed,src.last_sync_at,src.last_sync_status FROM private_suppliers s LEFT JOIN supplier_sources src ON src.supplier_id=s.id ORDER BY s.updated_at DESC`)}
export async function supplierBySlug(slug:string){await ensureSupplierSchema();return one<any>(`SELECT s.*,src.base_url,src.feed_url,src.feed_format,src.default_markup_usd,src.permission_confirmed FROM private_suppliers s LEFT JOIN supplier_sources src ON src.supplier_id=s.id WHERE s.slug=? AND s.enabled=1 LIMIT 1`,[slug])}
