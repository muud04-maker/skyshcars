-- Sky Cars Master MySQL Schema
-- Hostinger / MySQL 8 compatible
SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS admins (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(255) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NULL,
 role ENUM('owner','admin','staff') NOT NULL DEFAULT 'staff',
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 full_name VARCHAR(255), phone VARCHAR(50), whatsapp_id VARCHAR(191),
 facebook_psid VARCHAR(191), email VARCHAR(255), country VARCHAR(120),
 preferred_language VARCHAR(30), notes TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX(phone), INDEX(whatsapp_id), INDEX(facebook_psid), INDEX(email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicles (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 legacy_id INT NULL, stock_no VARCHAR(60) NOT NULL UNIQUE,
 category ENUM('car','motorcycle','truck','van','bus','machinery','other') NOT NULL DEFAULT 'car',
 brand VARCHAR(120), model VARCHAR(160), trim_name VARCHAR(160),
 model_year SMALLINT, manufacturing_date VARCHAR(80), mileage_km INT,
 engine VARCHAR(120), transmission VARCHAR(80), fuel_type VARCHAR(80),
 drivetrain VARCHAR(80), steering ENUM('LHD','RHD','unknown') DEFAULT 'LHD',
 color VARCHAR(80), price_usd DECIMAL(12,2), location VARCHAR(160) DEFAULT 'China',
 status ENUM('available','reserved','sold','pending_verification','hidden') DEFAULT 'pending_verification',
 description TEXT, specs JSON NULL, source VARCHAR(80) DEFAULT 'import',
 published_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX(category), INDEX(brand), INDEX(model_year), INDEX(status), INDEX(price_usd)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicle_media (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 vehicle_id BIGINT UNSIGNED NOT NULL, media_type ENUM('image','video','document') DEFAULT 'image',
 url TEXT NOT NULL, storage_key VARCHAR(500), caption VARCHAR(255),
 source ENUM('admin','whatsapp_group','import','other') DEFAULT 'admin',
 is_cover BOOLEAN DEFAULT FALSE, sort_order INT DEFAULT 0,
 review_status ENUM('pending','approved','rejected') DEFAULT 'pending',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
 INDEX(vehicle_id), INDEX(review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS countries (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(120) NOT NULL UNIQUE, iso2 CHAR(2), traffic_side ENUM('right','left') NOT NULL,
 preferred_steering ENUM('LHD','RHD') NOT NULL, priority_market BOOLEAN DEFAULT FALSE,
 landlocked BOOLEAN DEFAULT FALSE, active BOOLEAN DEFAULT TRUE, notes TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ports (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 country_id BIGINT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL,
 city VARCHAR(160), is_gateway BOOLEAN DEFAULT TRUE, active BOOLEAN DEFAULT TRUE, notes TEXT,
 FOREIGN KEY(country_id) REFERENCES countries(id) ON DELETE CASCADE,
 UNIQUE KEY uq_port(country_id,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipping_routes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 origin_port VARCHAR(160), destination_port_id BIGINT UNSIGNED,
 method ENUM('RORO','20FT','40FT','40HC','DG','OTHER') NOT NULL,
 status ENUM('confirmed','quote_required','inactive') DEFAULT 'quote_required',
 transit_days_min INT NULL, transit_days_max INT NULL, notes TEXT,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(destination_port_id) REFERENCES ports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipping_rates (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 route_id BIGINT UNSIGNED NOT NULL, vehicle_category VARCHAR(80),
 amount_usd DECIMAL(12,2), currency CHAR(3) DEFAULT 'USD',
 valid_from DATE NULL, valid_until DATE NULL, confirmed BOOLEAN DEFAULT FALSE, notes TEXT,
 FOREIGN KEY(route_id) REFERENCES shipping_routes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leads (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id BIGINT UNSIGNED NULL, source ENUM('website','whatsapp','facebook','admin','other') DEFAULT 'website',
 name VARCHAR(255), phone VARCHAR(50), email VARCHAR(255), message TEXT,
 status ENUM('new','contacted','qualified','converted','closed') DEFAULT 'new',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 reference VARCHAR(80) NOT NULL UNIQUE, customer_id BIGINT UNSIGNED NULL,
 vehicle_id BIGINT UNSIGNED NULL, country_id BIGINT UNSIGNED NULL, port_id BIGINT UNSIGNED NULL,
 shipping_method VARCHAR(40), quantity INT DEFAULT 1, customer_message TEXT,
 status ENUM('new','reviewing','quoted','accepted','declined','expired') DEFAULT 'new',
 quoted_vehicle_usd DECIMAL(12,2), quoted_shipping_usd DECIMAL(12,2),
 quoted_total_usd DECIMAL(12,2), internal_notes TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL,
 FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
 FOREIGN KEY(country_id) REFERENCES countries(id) ON DELETE SET NULL,
 FOREIGN KEY(port_id) REFERENCES ports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 tracking_reference VARCHAR(100) NOT NULL UNIQUE, customer_id BIGINT UNSIGNED NULL,
 vehicle_id BIGINT UNSIGNED NULL, quote_id BIGINT UNSIGNED NULL,
 destination_port_id BIGINT UNSIGNED NULL, vessel_name VARCHAR(160), container_no VARCHAR(100),
 current_status ENUM('order_confirmed','vehicle_collected','inspection_completed','export_processing','loaded','vessel_departed','in_transit','arrived_destination_port','completed') DEFAULT 'order_confirmed',
 eta DATE NULL, public_note TEXT, internal_note TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL,
 FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
 FOREIGN KEY(quote_id) REFERENCES quote_requests(id) ON DELETE SET NULL,
 FOREIGN KEY(destination_port_id) REFERENCES ports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tracking_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 shipment_id BIGINT UNSIGNED NOT NULL, status VARCHAR(100) NOT NULL,
 title VARCHAR(255), public_description TEXT, internal_description TEXT,
 event_time DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(shipment_id) REFERENCES shipments(id) ON DELETE CASCADE, INDEX(shipment_id,event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipment_documents (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 shipment_id BIGINT UNSIGNED NOT NULL, name VARCHAR(255), url TEXT NOT NULL,
 is_public BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id BIGINT UNSIGNED NULL,
 channel ENUM('website','whatsapp','facebook') NOT NULL,
 external_user_id VARCHAR(191), mode ENUM('ai','human','paused') DEFAULT 'ai',
 takeover_by VARCHAR(191), takeover_at DATETIME NULL, last_message_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL,
 UNIQUE KEY uq_channel_user(channel,external_user_id), INDEX(mode), INDEX(last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_id BIGINT UNSIGNED NOT NULL, external_message_id VARCHAR(191),
 sender ENUM('customer','ai','human','system') NOT NULL, direction ENUM('inbound','outbound') NOT NULL,
 message_type ENUM('text','image','video','audio','document','other') DEFAULT 'text',
 body TEXT, media_url TEXT, ai_model VARCHAR(100), delivery_status VARCHAR(60),
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 INDEX(conversation_id,created_at), INDEX(external_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_import_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source ENUM('json','csv','whatsapp_group','manual','telegram') NOT NULL,
 source_message_id VARCHAR(191), raw_payload JSON,
 proposed_vehicle JSON, review_status ENUM('pending','approved','rejected') DEFAULT 'pending',
 approved_vehicle_id BIGINT UNSIGNED NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 reviewed_at DATETIME NULL,
 FOREIGN KEY(approved_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS social_connections (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 channel ENUM('whatsapp','facebook') NOT NULL UNIQUE, external_account_id VARCHAR(191),
 display_name VARCHAR(255), enabled BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS social_publish_log (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 vehicle_id BIGINT UNSIGNED NOT NULL,
 channel VARCHAR(40) NOT NULL, external_id VARCHAR(191) NULL,
 status ENUM('sent','skipped','failed') NOT NULL, details TEXT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX(vehicle_id), INDEX(channel), INDEX(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS social_publications (
  vehicle_id BIGINT UNSIGNED NOT NULL,channel VARCHAR(40) NOT NULL,
  state ENUM('processing','sent','failed','uncertain') NOT NULL DEFAULT 'processing',
  external_id VARCHAR(191),approved_price_usd DECIMAL(12,2),exact_photo_url TEXT,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 1,last_attempt_at DATETIME,last_error TEXT,
  publication_history JSON,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(vehicle_id,channel),INDEX(state),INDEX(external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS business_settings (
 setting_key VARCHAR(191) PRIMARY KEY, setting_value JSON NOT NULL,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor VARCHAR(191), action VARCHAR(191) NOT NULL, entity_type VARCHAR(100), entity_id VARCHAR(191),
 details JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(created_at), INDEX(entity_type,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO business_settings(setting_key,setting_value) VALUES
('conversation_defaults', JSON_OBJECT('mode','ai','human_takeover_on_admin_reply',true)),
('publishing_rules', JSON_OBJECT('require_photo_review',true,'require_vehicle_review',true)),
('social_auto_publish', JSON_OBJECT('facebook_auto',false,'whatsapp_active_chats_auto',false,'allow_labeled_demo_images',false)),
('market_focus', JSON_OBJECT('primary','Africa right-driving / LHD-compatible markets'));


CREATE TABLE IF NOT EXISTS ai_knowledge (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 title VARCHAR(191) NOT NULL, content TEXT NOT NULL, active BOOLEAN DEFAULT TRUE,
 source VARCHAR(80) DEFAULT 'admin', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  scope VARCHAR(40) NOT NULL DEFAULT 'general', version INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('draft','approved','inactive') NOT NULL DEFAULT 'approved',
  priority TINYINT UNSIGNED NOT NULL DEFAULT 5,
  created_by VARCHAR(191) NULL, updated_by VARCHAR(191) NULL,
  approved_by VARCHAR(191) NULL, approved_at DATETIME NULL,
  INDEX(active), INDEX(updated_at), INDEX idx_knowledge_status(status,active,priority,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_instruction_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instruction_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  snapshot JSON NOT NULL,
  actor VARCHAR(191) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(instruction_id,created_at), INDEX(action,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS private_suppliers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name_internal VARCHAR(191) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE,
 enabled BOOLEAN DEFAULT TRUE, notes TEXT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX(enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS=1;

-- V16 persistent customer memory and supplier integration
CREATE TABLE IF NOT EXISTS customer_memory (
 customer_id BIGINT UNSIGNED PRIMARY KEY,
 summary TEXT NULL,
 preferences_json JSON NULL,
 last_vehicle_id BIGINT UNSIGNED NULL,
 last_stock_no VARCHAR(60) NULL,
 message_count INT NOT NULL DEFAULT 0,
 summarized_through_message_id BIGINT UNSIGNED NULL,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
 INDEX(last_vehicle_id), INDEX(updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_sources (
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
 last_sync_status VARCHAR(80) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(supplier_id) REFERENCES private_suppliers(id) ON DELETE CASCADE,
 INDEX(supplier_id), INDEX(permission_confirmed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_vehicle_map (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- V21 AI agent diagnostics and WhatsApp-group import media
CREATE TABLE IF NOT EXISTS ai_agent_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_id BIGINT UNSIGNED NULL,
 external_message_id VARCHAR(191) NULL,
 event_type VARCHAR(80) NOT NULL,
 status VARCHAR(40) NOT NULL,
 details TEXT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX(conversation_id,created_at), INDEX(external_message_id), INDEX(status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_import_media (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 import_item_id BIGINT UNSIGNED NOT NULL,
 url TEXT NULL,
 mime_type VARCHAR(100) NULL,
 blob_name VARCHAR(160) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(import_item_id) REFERENCES inventory_import_items(id) ON DELETE CASCADE,
 INDEX(import_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- V27 Automation Center / Group Reader / Owner Private Lab
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_in_at DATETIME NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_out_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS whatsapp_group_sources (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 group_name VARCHAR(191) NOT NULL,
 group_external_id VARCHAR(191) NULL,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 notes TEXT NULL,
 last_seen_at DATETIME NULL,
 last_message_id VARCHAR(191) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_group_name(group_name), INDEX(enabled), INDEX(last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO whatsapp_group_sources(group_name,enabled,notes) VALUES('SKy Cars motorcycles',1,'Primary Sky Cars inventory group');

CREATE TABLE IF NOT EXISTS whatsapp_group_bridge_status (
 bridge_id VARCHAR(80) PRIMARY KEY,status VARCHAR(40) NOT NULL,whatsapp_account VARCHAR(191) NULL,
 visible_groups INT NULL,app_version VARCHAR(40) NULL,details TEXT NULL,last_heartbeat_at DATETIME NOT NULL,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- V35 permanent inventory identity, exact source-message dedup and synchronization checkpoints.
-- These are additive. The app also creates them at runtime, so production data is never replaced.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin VARCHAR(32) NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(191) NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_condition VARCHAR(80) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS group_external_id VARCHAR(191) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS matched_vehicle_id BIGINT UNSIGNED NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS match_status VARCHAR(30) NOT NULL DEFAULT 'new';
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS match_type VARCHAR(80) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS match_confidence DECIMAL(5,4) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS duplicate_risk DECIMAL(5,4) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS extraction_confidence DECIMAL(5,4) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS evidence_json JSON NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS last_observed_at DATETIME NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS approval_method VARCHAR(30) NULL;
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS approved_by VARCHAR(191) NULL;

CREATE TABLE IF NOT EXISTS vehicle_identity_memory (
  vehicle_id BIGINT UNSIGNED PRIMARY KEY,stock_no VARCHAR(60),vin VARCHAR(32),supplier_reference VARCHAR(191),
  source_group_id VARCHAR(191),identity_key CHAR(64),category VARCHAR(30),brand VARCHAR(120),model VARCHAR(160),
  model_year SMALLINT,mileage_km INT,price_usd DECIMAL(12,2),currency CHAR(3),engine VARCHAR(120),
  transmission VARCHAR(80),fuel_type VARCHAR(80),vehicle_condition VARCHAR(80),color VARCHAR(80),
  image_sha256 JSON,perceptual_hashes JSON,publication_history JSON,approved_changes JSON,
  import_status VARCHAR(40),last_observed_at DATETIME,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX(stock_no),INDEX(vin),INDEX(supplier_reference),INDEX(identity_key),
  INDEX(brand,model,model_year),INDEX(last_observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicle_image_fingerprints (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,vehicle_id BIGINT UNSIGNED NOT NULL,
  import_item_id BIGINT UNSIGNED NULL,source_url TEXT,sha256 CHAR(64) NOT NULL,perceptual_hash CHAR(16),
  width INT,height INT,verified BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vehicle_image(vehicle_id,sha256),INDEX(import_item_id),INDEX(sha256),INDEX(perceptual_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_identity_refs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,vehicle_id BIGINT UNSIGNED NOT NULL,
  import_item_id BIGINT UNSIGNED NULL,source_group_id VARCHAR(191),source_message_id VARCHAR(191) NOT NULL,
  supplier_reference VARCHAR(191),observed_at DATETIME NOT NULL,active_source BOOLEAN NOT NULL DEFAULT TRUE,
  evidence JSON,UNIQUE KEY uq_identity_source(source_group_id,source_message_id),
  INDEX(vehicle_id),INDEX(import_item_id),INDEX(supplier_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_match_candidates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,import_item_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,confidence DECIMAL(5,4),reasons JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_import_candidate(import_item_id,vehicle_id),
  INDEX(vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_change_proposals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,import_item_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,change_type VARCHAR(40) NOT NULL,field_name VARCHAR(80),
  old_value TEXT,new_value TEXT,status ENUM('pending','applied','rejected') NOT NULL DEFAULT 'pending',
  evidence JSON,reviewed_at DATETIME,reviewed_by VARCHAR(191),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(import_item_id),INDEX(vehicle_id),INDEX(status,change_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_message_ledger (
  source_message_id VARCHAR(191) PRIMARY KEY,import_item_id BIGINT UNSIGNED NULL,
  state ENUM('processing','saved','failed') NOT NULL DEFAULT 'processing',error VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX(import_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_group_checkpoints (
  bridge_id VARCHAR(80) NOT NULL,group_id VARCHAR(191) NOT NULL,group_name VARCHAR(191),
  last_message_id VARCHAR(191),last_message_timestamp BIGINT,last_successful_sync_at DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(bridge_id,group_id),INDEX(last_successful_sync_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_sync_runs (
  run_id VARCHAR(80) PRIMARY KEY,bridge_id VARCHAR(80) NOT NULL,group_id VARCHAR(191),group_name VARCHAR(191),
  state ENUM('running','succeeded','failed','interrupted') NOT NULL DEFAULT 'running',
  messages_received INT UNSIGNED NOT NULL DEFAULT 0,media_received INT UNSIGNED NOT NULL DEFAULT 0,
  website_saved BOOLEAN NOT NULL DEFAULT FALSE,started_at DATETIME NOT NULL,finished_at DATETIME,
  error VARCHAR(1000),details JSON,INDEX(bridge_id,started_at),INDEX(state,started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_group_sync_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,request_id VARCHAR(80) NOT NULL UNIQUE,
  bridge_id VARCHAR(80) NOT NULL,requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at DATETIME,completed_at DATETIME,
  state ENUM('pending','claimed','completed','failed') NOT NULL DEFAULT 'pending',error VARCHAR(1000),
  INDEX(bridge_id,state,requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_campaigns (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,vehicle_id BIGINT UNSIGNED NULL,reason VARCHAR(80) NOT NULL DEFAULT 'new_vehicle',
 title VARCHAR(191) NOT NULL,message TEXT NULL,channels JSON NOT NULL,audience JSON NULL,
 status ENUM('draft','approved','sending','sent','failed','cancelled') NOT NULL DEFAULT 'draft',
 scheduled_at DATETIME NULL,sent_at DATETIME NULL,last_error TEXT NULL,created_by VARCHAR(191) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX(status,scheduled_at),INDEX(vehicle_id),FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS automation_campaign_deliveries (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,campaign_id BIGINT UNSIGNED NOT NULL,channel VARCHAR(40) NOT NULL,
 recipient VARCHAR(191) NULL,status ENUM('sent','skipped','failed') NOT NULL,details TEXT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX(campaign_id),INDEX(channel,status),FOREIGN KEY(campaign_id) REFERENCES automation_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS automation_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,event_type VARCHAR(80) NOT NULL,entity_type VARCHAR(80) NULL,
 entity_id VARCHAR(191) NULL,status VARCHAR(40) NOT NULL,details TEXT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX(created_at),INDEX(event_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO business_settings(setting_key,setting_value) VALUES('automation_v27',JSON_OBJECT('enabled',true,'require_approval',true,'facebook_auto',true,'whatsapp_auto',false,'group_reader_enabled',true,'auto_on_manual_publish',true,'auto_on_group_approval',true,'auto_on_supplier_publish',false,'whatsapp_active_window_only',true,'max_whatsapp_recipients_per_vehicle',50)) ON DUPLICATE KEY UPDATE setting_key=setting_key;

CREATE TABLE IF NOT EXISTS lab_apps (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(191) NOT NULL,slug VARCHAR(120) NOT NULL UNIQUE,
 category VARCHAR(80) NULL,status ENUM('development','testing','live','paused') NOT NULL DEFAULT 'development',
 launch_url TEXT NULL,notes TEXT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,INDEX(status),INDEX(category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Phase 1 customer accounts (email + password, Google). Also auto-created by the app on first use.
CREATE TABLE IF NOT EXISTS customer_accounts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id BIGINT UNSIGNED NOT NULL,
 email VARCHAR(191) NOT NULL,
 password_hash VARCHAR(255) NULL,
 google_sub VARCHAR(191) NULL,
 signup_method ENUM('password','google') NOT NULL,
 last_login_at DATETIME NULL,
 last_login_method VARCHAR(20) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_customer_account_email(email),
 UNIQUE KEY uq_customer_account_google(google_sub),
 UNIQUE KEY uq_customer_account_customer(customer_id),
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Phase 3: each Group Reader post owns one pending vehicle (also added automatically by the app).
ALTER TABLE inventory_import_items ADD COLUMN IF NOT EXISTS vehicle_id BIGINT UNSIGNED NULL;

-- ============================================================================
-- AI learning / customer context / staff workflow (all additive, all idempotent)
-- The app creates these at runtime too (CREATE TABLE IF NOT EXISTS), so running this file on an
-- existing production database is safe and changes nothing that already exists.
-- ============================================================================

-- One customer, one fact per key. A new value supersedes the old one; every change is logged below.
CREATE TABLE IF NOT EXISTS customer_facts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id BIGINT UNSIGNED NOT NULL,
 fact_key VARCHAR(60) NOT NULL,
 fact_value VARCHAR(255) NOT NULL,
 source VARCHAR(40) NOT NULL DEFAULT 'customer_message',
 source_message_id BIGINT UNSIGNED NULL,
 confidence DECIMAL(4,2) NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_customer_fact(customer_id,fact_key),
 INDEX idx_fact_customer(customer_id,active),
 INDEX idx_fact_key(fact_key,active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_fact_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id BIGINT UNSIGNED NOT NULL,
 fact_key VARCHAR(60) NOT NULL,
 old_value VARCHAR(255) NULL,
 new_value VARCHAR(255) NULL,
 action VARCHAR(20) NOT NULL,
 source VARCHAR(40) NULL,
 changed_by VARCHAR(191) NULL,
 changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_fact_event_customer(customer_id,changed_at),
 INDEX idx_fact_event_key(fact_key,changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Private staff notes per customer (soft-deleted, never shown publicly).
CREATE TABLE IF NOT EXISTS staff_notes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id BIGINT UNSIGNED NOT NULL,
 note TEXT NOT NULL,
 author VARCHAR(191) NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_note_customer(customer_id,active,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every change of the vehicle a chat is about, with its source (ai / referral / staff / correction).
CREATE TABLE IF NOT EXISTS conversation_vehicle_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_id BIGINT UNSIGNED NOT NULL,
 customer_id BIGINT UNSIGNED NULL,
 vehicle_id BIGINT UNSIGNED NULL,
 previous_vehicle_id BIGINT UNSIGNED NULL,
 source VARCHAR(40) NOT NULL DEFAULT 'ai',
 reason VARCHAR(191) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_vehicle_event_conv(conversation_id,created_at),
 INDEX idx_vehicle_event_customer(customer_id,created_at),
 INDEX idx_vehicle_event_vehicle(vehicle_id,created_at),
 INDEX idx_vehicle_event_source(source,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Supervised learning: nothing becomes a global rule without an admin approving (and applying) it.
CREATE TABLE IF NOT EXISTS ai_learning_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_id BIGINT UNSIGNED NULL,
 customer_id BIGINT UNSIGNED NULL,
 message_id BIGINT UNSIGNED NULL,
 question TEXT NULL,
 ai_reply TEXT NULL,
 correction TEXT NULL,
 event_type VARCHAR(60) NOT NULL DEFAULT 'other',
 reason VARCHAR(191) NULL,
 lesson TEXT NULL,
 applies_to ENUM('global','customer') NOT NULL DEFAULT 'global',
 payload JSON NULL,
 status ENUM('pending','approved','rejected','applied') NOT NULL DEFAULT 'pending',
 created_by VARCHAR(191) NULL,
 reviewed_by VARCHAR(191) NULL,
 reviewed_at DATETIME NULL,
 applied_at DATETIME NULL,
 applied_ref VARCHAR(191) NULL,
 confidence DECIMAL(4,2) NULL,
 category VARCHAR(40) NULL,
 evidence_ref VARCHAR(191) NULL,
 expires_at DATETIME NULL,
 undone_at DATETIME NULL,
 undone_by VARCHAR(191) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_learning_status(status,created_at),
 INDEX idx_learning_customer(customer_id,created_at),
 INDEX idx_learning_type(event_type,status),
 INDEX idx_learning_conversation(conversation_id,created_at),
 INDEX idx_learning_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily, deterministic summary of real human sales activity (weak hints only, never rules).
CREATE TABLE IF NOT EXISTS daily_ai_sales_patterns (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 pattern_date DATE NOT NULL,
 pattern_type VARCHAR(60) NOT NULL,
 pattern_key VARCHAR(191) NOT NULL,
 pattern_value TEXT NULL,
 sample_count INT NOT NULL DEFAULT 1,
 confidence DECIMAL(4,2) NOT NULL DEFAULT 0.50,
 source VARCHAR(60) NOT NULL DEFAULT 'daily_learner',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_pattern(pattern_date,pattern_type,pattern_key),
 INDEX idx_pattern_date_type(pattern_date,pattern_type),
 INDEX idx_pattern_key(pattern_key,pattern_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One auditable queue for work only a human can finish: photos, freight, sourcing, serious buyers.
CREATE TABLE IF NOT EXISTS staff_tasks (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_type VARCHAR(40) NOT NULL,
 dedupe_key VARCHAR(191) NULL,
 conversation_id BIGINT UNSIGNED NULL,
 customer_id BIGINT UNSIGNED NULL,
 vehicle_id BIGINT UNSIGNED NULL,
 stock_no VARCHAR(60) NULL,
 reason VARCHAR(255) NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 priority TINYINT NOT NULL DEFAULT 5,
 notes TEXT NULL,
 created_by VARCHAR(191) NULL,
 handled_by VARCHAR(191) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 completed_at DATETIME NULL,
 UNIQUE KEY uq_task_dedupe(dedupe_key),
 INDEX idx_task_status(status,priority,created_at),
 INDEX idx_task_type(request_type,status),
 INDEX idx_task_conversation(conversation_id,created_at),
 INDEX idx_task_customer(customer_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who on the team owns a customer (added by the app at runtime as well).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_staff VARCHAR(191) NULL;

-- V36 Telegram HTTPS webhook automation. All tables are additive; existing V35 inventory and
-- media are reused through inventory_import_items, vehicles and vehicle_media.
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id BIGINT PRIMARY KEY,update_type VARCHAR(40),chat_id BIGINT,message_id BIGINT,
  state ENUM('stored','processing','processed','failed','ignored') NOT NULL DEFAULT 'stored',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at DATETIME,error VARCHAR(1000),payload JSON,
  INDEX(chat_id,message_id),INDEX(state,received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS telegram_source_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,chat_id BIGINT NOT NULL,message_id BIGINT NOT NULL,
  media_group_id VARCHAR(191),last_update_id BIGINT,edit_date BIGINT,message_thread_id BIGINT,from_id BIGINT,
  sender_name VARCHAR(191),chat_title VARCHAR(191),text TEXT,caption TEXT,
  message_kind VARCHAR(30) NOT NULL DEFAULT 'other',file_id VARCHAR(255),file_unique_id VARCHAR(255),
  media_width INT,media_height INT,file_size BIGINT,
  processing_state ENUM('queued','processing','completed','review','failed','ignored') NOT NULL DEFAULT 'queued',
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  import_item_id BIGINT UNSIGNED,vehicle_id BIGINT UNSIGNED,prior_import_item_id BIGINT UNSIGNED,
  prior_vehicle_id BIGINT UNSIGNED,error VARCHAR(1000),payload JSON,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_telegram_message(chat_id,message_id),INDEX(media_group_id,processing_state),
  INDEX(processing_state,next_attempt_at),INDEX(import_item_id),INDEX(vehicle_id),INDEX(received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS telegram_automation_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,event_type VARCHAR(80) NOT NULL,status VARCHAR(40) NOT NULL,
  update_id BIGINT,source_message_id BIGINT UNSIGNED,import_item_id BIGINT UNSIGNED,vehicle_id BIGINT UNSIGNED,
  details JSON,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(event_type,status,created_at),INDEX(update_id),INDEX(import_item_id),INDEX(vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS telegram_connection_state (
  id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,state VARCHAR(40) NOT NULL,webhook_url TEXT,
  group_id VARCHAR(191),group_title VARCHAR(191),bot_id BIGINT,bot_username VARCHAR(191),
  bot_is_admin BOOLEAN,pending_updates INT,last_error TEXT,details JSON,checked_at DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
