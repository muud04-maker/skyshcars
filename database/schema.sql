create extension if not exists pgcrypto;
create table if not exists vehicles(id bigserial primary key,legacy_id text unique,stock_no text unique not null,category text not null,brand text,model text,year int,specifications jsonb default '{}'::jsonb,price_usd numeric(12,2),country text default 'China',status text default 'pending_verification',created_at timestamptz default now());
create table if not exists vehicle_media(id uuid primary key default gen_random_uuid(),vehicle_id bigint references vehicles(id) on delete cascade,url text not null,kind text default 'image');
create table if not exists customers(id uuid primary key default gen_random_uuid(),name text,whatsapp text unique,email text,country text,created_at timestamptz default now());
create table if not exists countries(id bigserial primary key,name text unique not null);create table if not exists ports(id bigserial primary key,country_id bigint references countries(id),name text not null,unique(country_id,name));
create table if not exists shipping_routes(id bigserial primary key,departure_port text,destination_port_id bigint references ports(id),method text,status text default 'reference',transit_days_min int,transit_days_max int,last_verified_at timestamptz,notes text);
create table if not exists shipping_rates(id bigserial primary key,route_id bigint references shipping_routes(id),vehicle_class text,amount numeric(12,2),currency text default 'USD',status text default 'estimate',effective_from date,effective_to date,verified_at timestamptz);
create table if not exists quote_requests(id uuid primary key default gen_random_uuid(),reference text unique not null,customer_id uuid references customers(id),vehicle_id bigint references vehicles(id),country text,port text,method text,status text default 'pending',notes text,created_at timestamptz default now());
create table if not exists shipments(id uuid primary key default gen_random_uuid(),reference text unique not null,customer_id uuid references customers(id),status text default 'order_confirmed',created_at timestamptz default now());
create table if not exists tracking_events(id uuid primary key default gen_random_uuid(),shipment_id uuid references shipments(id) on delete cascade,status text not null,location text,public_note text,event_at timestamptz default now());
create table if not exists conversations(id uuid primary key default gen_random_uuid(),whatsapp_id text unique not null,customer_id uuid references customers(id),mode text default 'ai',updated_at timestamptz default now());
create table if not exists messages(id uuid primary key default gen_random_uuid(),conversation_id uuid references conversations(id) on delete cascade,direction text,role text,body text,media_url text,created_at timestamptz default now());
create table if not exists inventory_import_items(id uuid primary key default gen_random_uuid(),source text,source_message_id text unique,raw_text text,media jsonb default '[]'::jsonb,extracted jsonb default '{}'::jsonb,status text default 'pending_review',created_at timestamptz default now());
create table if not exists leads(id uuid primary key default gen_random_uuid(),name text,whatsapp text,email text,message text,status text default 'new',created_at timestamptz default now());
create table if not exists shipment_documents(id uuid primary key default gen_random_uuid(),shipment_id uuid references shipments(id) on delete cascade,name text,url text,is_public boolean default false,created_at timestamptz default now());
create table if not exists audit_logs(id uuid primary key default gen_random_uuid(),actor text,action text,entity_type text,entity_id text,details jsonb default '{}'::jsonb,created_at timestamptz default now());
create table if not exists business_settings(key text primary key,value jsonb not null default '{}'::jsonb,updated_at timestamptz default now());

alter table conversations add column if not exists channel text default 'whatsapp';
alter table conversations add column if not exists mode text default 'ai';
alter table conversations add column if not exists external_user_id text;
alter table conversations add column if not exists takeover_by text;
alter table conversations add column if not exists takeover_at timestamptz;
alter table vehicle_media add column if not exists source text default 'admin';
alter table vehicle_media add column if not exists is_cover boolean default false;
create table if not exists social_connections(
 id uuid primary key default gen_random_uuid(),
 channel text not null unique,
 external_account_id text,
 display_name text,
 enabled boolean default false,
 created_at timestamptz default now(),
 updated_at timestamptz default now()
);
