export const PAGE_SIZE = 36;

export function pageOf<T>(list: T[], page: unknown, size = PAGE_SIZE) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages, Math.max(1, parseInt(String(page || '1'), 10) || 1));
  return { items: list.slice((p - 1) * size, p * size), page: p, pages, total, from: total ? (p - 1) * size + 1 : 0, to: Math.min(total, p * size) };
}

export default function Pager({ base, params, page, pages, total, from, to }: { base: string; params?: Record<string, string | undefined>; page: number; pages: number; total: number; from: number; to: number }) {
  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v) u.set(k, v);
    if (p > 1) u.set('page', String(p));
    const q = u.toString();
    return q ? `${base}?${q}` : base;
  };
  return (
    <nav className="pager" aria-label="Pagination">
      <span>Showing {from}–{to} of {total}</span>
      {pages > 1 && <div>
        {page > 1 ? <a href={href(page - 1)} rel="prev">← Previous</a> : <span className="off">← Previous</span>}
        <b>Page {page} of {pages}</b>
        {page < pages ? <a href={href(page + 1)} rel="next">Next →</a> : <span className="off">Next →</span>}
      </div>}
    </nav>
  );
}
