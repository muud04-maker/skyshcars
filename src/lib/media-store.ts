import { db } from './db';

/*
  Vehicle photos are stored in MySQL (not on the web-server disk).
  Hostinger Git deployments can replace the app folder and Next.js does not serve files
  added to /public after the build, so disk uploads would disappear or return 404.
*/
let ready: Promise<void> | null = null;
export function ensureMediaStore() {
  if (!ready) ready = db().execute(`CREATE TABLE IF NOT EXISTS media_blobs(
    name VARCHAR(120) NOT NULL PRIMARY KEY,
    mime VARCHAR(80) NOT NULL,
    data LONGBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).then(() => undefined).catch(e => { ready = null; throw e; });
  return ready;
}
export async function saveBlob(name: string, mime: string, data: Buffer) {
  await ensureMediaStore();
  await db().execute('INSERT INTO media_blobs(name,mime,data) VALUES(?,?,?) ON DUPLICATE KEY UPDATE mime=VALUES(mime),data=VALUES(data)', [name, mime, data]);
  return `/media/${name}`;
}
export async function deleteBlobByUrl(url: string) {
  if (!url.startsWith('/media/')) return;
  await ensureMediaStore();
  await db().execute('DELETE FROM media_blobs WHERE name=?', [url.slice(7)]);
}
