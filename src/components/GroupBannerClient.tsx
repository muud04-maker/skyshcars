'use client';
import { useEffect, useState } from 'react';

const KEY = 'sky_whatsapp_group_banner_dismissed';

/** One small dismissible invitation to the Sky Cars WhatsApp group; hidden forever after dismiss. */
export default function GroupBannerClient({ link, name }: { link: string; name: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== '1'); } catch { setShow(true); } }, []);
  if (!show) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', flexWrap: 'wrap', background: '#e8f6ee', borderBottom: '1px solid #bfe3cd', padding: '8px 14px', fontSize: 14 }}>
      <span>New arrivals are posted in our WhatsApp group &ldquo;{name}&rdquo;.</span>
      <a className="btn small" href={link} target="_blank" rel="noreferrer">Join the group</a>
      <button
        type="button"
        aria-label="Dismiss this notice"
        onClick={() => { try { localStorage.setItem(KEY, '1'); } catch {} setShow(false); }}
        style={{ background: 'transparent', border: 0, fontSize: 18, lineHeight: 1, cursor: 'pointer', color: '#4a5a68' }}
      >&times;</button>
    </div>
  );
}
