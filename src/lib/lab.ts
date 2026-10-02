import {db,rows,one} from './db';
export async function ensureLabSchema(){await db().execute(`CREATE TABLE IF NOT EXISTS lab_apps(
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(191) NOT NULL,
 slug VARCHAR(120) NOT NULL UNIQUE,
 category VARCHAR(80) NULL,
 status ENUM('development','testing','live','paused') NOT NULL DEFAULT 'development',
 launch_url TEXT NULL,
 notes TEXT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX(status),INDEX(category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)}
export async function labApps(){await ensureLabSchema();return rows<any>(`SELECT * FROM lab_apps ORDER BY updated_at DESC,id DESC`)}
export async function labApp(slug:string){await ensureLabSchema();return one<any>(`SELECT * FROM lab_apps WHERE slug=? LIMIT 1`,[slug])}
function slugify(s:string){return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)}
export async function saveLabApp(p:any){await ensureLabSchema();const name=String(p.name||'').trim().slice(0,191);if(!name)throw new Error('App name required');const slug=slugify(String(p.slug||name));if(!slug)throw new Error('Valid slug required');const status=['development','testing','live','paused'].includes(String(p.status))?String(p.status):'development';if(p.id){await db().execute(`UPDATE lab_apps SET name=?,slug=?,category=?,status=?,launch_url=?,notes=? WHERE id=?`,[name,slug,String(p.category||'').trim().slice(0,80)||null,status,String(p.launch_url||'').trim()||null,String(p.notes||'').trim()||null,Number(p.id)]);return {ok:true,id:Number(p.id),slug}}const [r]:any=await db().execute(`INSERT INTO lab_apps(name,slug,category,status,launch_url,notes) VALUES(?,?,?,?,?,?)`,[name,slug,String(p.category||'').trim().slice(0,80)||null,status,String(p.launch_url||'').trim()||null,String(p.notes||'').trim()||null]);return {ok:true,id:Number(r.insertId),slug}}
export async function deleteLabApp(id:number){await ensureLabSchema();await db().execute(`DELETE FROM lab_apps WHERE id=?`,[id]);return {ok:true}}
