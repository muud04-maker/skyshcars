import type {AnalyticsReport, ChartItem, Kpi, Panel, ReportTable} from '../../../../lib/analytics';
import PrintButton from './PrintButton';

const fmt = (value: any) => typeof value === 'number' ? value.toLocaleString('en-US') : String(value ?? 'Not tracked');
const qLabel = (q: string) => q === 'verified' ? 'Verified' : q === 'inferred' ? 'Inferred' : q === 'heuristic' ? 'Heuristic' : q === 'untracked' ? 'Not tracked' : 'Unavailable';
const changeText = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value}%`;
const changeClass = (value: number | null) => value == null ? 'flat' : value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
const titleAttr = (value: any) => String(value ?? '').replace(/\s+/g, ' ').slice(0, 300);

function qs(period: AnalyticsReport['period'], patch: Record<string, string> = {}) {
  const p = new URLSearchParams({ range: period.key });
  if (period.key === 'custom') { p.set('from', period.from); p.set('to', period.to); }
  for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
  return '?' + p.toString();
}

function KpiCard({ item }: { item: Kpi }) {
  const inner = <>
    <span className="analyticsKpiLabel">{item.label}<i className={'analyticsQualityDot ' + item.quality} title={qLabel(item.quality)} /></span>
    <strong className={typeof item.value === 'string' ? 'analyticsKpiText' : ''}>{fmt(item.value)}</strong>
    <div className="analyticsKpiFoot">
      {item.current ? <em>Current state</em> : <span className={'analyticsChange ' + changeClass(item.change)}>{changeText(item.change)}</span>}
      <small title={`${item.method}. Source: ${item.source}`}>{item.source}</small>
    </div>
  </>;
  return item.href ? <a className={`analyticsKpi tone-${item.tone || 'navy'}`} href={item.href} title={`${item.label}: ${item.method}. Source: ${item.source}`}>{inner}</a>
    : <div className={`analyticsKpi tone-${item.tone || 'navy'}`} title={`${item.label}: ${item.method}. Source: ${item.source}`}>{inner}</div>;
}

function Donut({ items }: { items: ChartItem[] }) {
  const total = items.reduce((a, b) => a + Number(b.value || 0), 0);
  if (!total) return <div className="analyticsNoData">No rows for this period.</div>;
  let acc = 0;
  const stops = items.map((item, i) => {
    const start = acc / total * 360; acc += Number(item.value || 0);
    return `${item.color || ['#f4b942','#2f80ed','#16a085','#7c5cff','#e05d5d','#6b7f93'][i % 6]} ${start}deg ${acc / total * 360}deg`;
  }).join(', ');
  return <div className="analyticsDonutWrap">
    <div className="analyticsDonut" style={{background:`conic-gradient(${stops})`}} aria-label={`${total} total across ${items.length} categories`}>
      <div><b>{fmt(total)}</b><span>total</span></div>
    </div>
    <div className="analyticsLegend">
      {items.map((item, i) => <div key={item.label + i} title={titleAttr(item.title || `${item.label}: ${item.value}`)}>
        <i style={{background:item.color || ['#f4b942','#2f80ed','#16a085','#7c5cff','#e05d5d','#6b7f93'][i % 6]}} />
        <span>{item.label}</span><b>{fmt(item.value)}</b>
      </div>)}
    </div>
  </div>;
}

function Bars({ items }: { items: ChartItem[] }) {
  if (!items.length) return <div className="analyticsNoData">No rows for this period.</div>;
  const max = Math.max(1, ...items.map((x) => Number(x.value || 0)));
  return <div className="analyticsBars">
    {items.map((item) => {
      const row = <><span className="analyticsBarLabel">{item.label}</span><span className="analyticsBarTrack"><i style={{width:`${Math.max(2, Number(item.value || 0) / max * 100)}%`, background:item.color || undefined}} /></span><b className="analyticsBarValue">{fmt(item.value)}</b>{(item as any).demand != null && <small className="analyticsDemand">{fmt((item as any).demand)} demand</small>}</>;
      return item.href ? <a className="analyticsBarRow" href={item.href} key={item.label} title={titleAttr(item.title || `${item.label}: ${item.value}`)}>{row}</a>
        : <div className="analyticsBarRow" key={item.label} title={titleAttr(item.title || `${item.label}: ${item.value}`)}>{row}</div>;
    })}
  </div>;
}

function Line({ labels, series }: { labels: string[]; series: { name: string; color: string; values: number[] }[] }) {
  if (!labels.length || !series.length) return <div className="analyticsNoData">No rows for this period.</div>;
  const width = 720, height = 220, pad = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map(Number)));
  const x = (i: number) => pad + (labels.length === 1 ? 0 : i / (labels.length - 1) * (width - pad * 2));
  const y = (v: number) => height - pad - Number(v || 0) / max * (height - pad * 2);
  return <div className="analyticsLineWrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Line chart with ${series.length} series across ${labels.length} points`}>
      {[0, .25, .5, .75, 1].map((p) => <line key={p} x1={pad} x2={width - pad} y1={pad + p * (height - pad * 2)} y2={pad + p * (height - pad * 2)} className="analyticsGridLine" />)}
      {series.map((s, si) => <g key={s.name}>
        <polyline fill="none" stroke={s.color} strokeWidth="2.5" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={s.color}><title>{`${s.name} · ${labels[i]}: ${fmt(v)}`}</title></circle>)}
      </g>)}
    </svg>
    <div className="analyticsLegend analyticsLegendInline">{series.map((s) => <div key={s.name}><i style={{background:s.color}} /><span>{s.name}</span><b>{fmt(s.values.reduce((a, b) => a + Number(b || 0), 0))}</b></div>)}</div>
  </div>;
}

function Stacked({ labels, series }: { labels: string[]; series: { name: string; color: string; values: number[] }[] }) {
  if (!labels.length || !series.length) return <div className="analyticsNoData">No rows for this period.</div>;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Number(s.values[i] || 0), 0));
  const max = Math.max(1, ...totals);
  return <div className="analyticsStacked">
    {labels.map((label, i) => <div className="analyticsStackRow" key={label}>
      <span>{label}</span>
      <div className="analyticsStackTrack" title={`${label}: ${series.map((s) => `${s.name} ${s.values[i] || 0}`).join(', ')}`}>
        {series.map((s) => <i key={s.name} style={{width:`${(Number(s.values[i] || 0) / max) * 100}%`, background:s.color}} title={`${s.name}: ${s.values[i] || 0}`} />)}
      </div>
      <b>{fmt(totals[i])}</b>
    </div>)}
    <div className="analyticsLegend analyticsLegendInline">{series.map((s) => <div key={s.name}><i style={{background:s.color}} /><span>{s.name}</span></div>)}</div>
  </div>;
}

function Funnel({ steps }: { steps: { label: string; value: number; note?: string }[] }) {
  if (!steps.length) return <div className="analyticsNoData">No rows for this period.</div>;
  const max = Math.max(1, ...steps.map((s) => Number(s.value || 0)));
  return <div className="analyticsFunnel">
    {steps.map((step, i) => {
      const prev = i ? steps[i - 1]?.value : null;
      const rate = prev == null ? '' : prev > 0 ? `${Math.round(Number(step.value || 0) / prev * 100)}% of previous` : 'previous stage is zero';
      return <div className="analyticsFunnelRow" key={step.label} title={titleAttr(`${step.label}: ${step.value}${step.note ? ` · ${step.note}` : ''}`)}>
        <div className="analyticsFunnelTop"><b>{step.label}</b><strong>{fmt(step.value)}</strong></div>
        <div className="analyticsFunnelTrack"><i style={{width:`${Math.max(2, Number(step.value || 0) / max * 100)}%`, background:['#f4b942','#2f80ed','#16a085','#7c5cff','#e05d5d'][i % 5]}} /></div>
        <small>{step.note || rate}{rate && step.note ? ` · ${rate}` : ''}</small>
      </div>;
    })}
  </div>;
}

function DataTable({ columns, rows }: { columns: { key: string; label: string; align?: string }[]; rows: Record<string, any>[] }) {
  if (!rows.length) return <div className="analyticsNoData">No rows for this period.</div>;
  const hasLink = rows.some((row) => row.href);
  return <div className="analyticsTableWrap"><table className="analyticsTable"><thead><tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'right' : ''}>{c.label}</th>)}{hasLink && <th />}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id || row.reference || row.stock_no || i}>
    {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'right' : ''} title={titleAttr(row[c.key])}>{row.href && c === columns[0] ? <a href={row.href}>{fmt(row[c.key] || '—')}</a> : fmt(row[c.key] ?? '—')}</td>)}
    {hasLink && <td className="right">{row.href ? <a className="analyticsRowLink" href={row.href}>Open</a> : null}</td>}
  </tr>)}</tbody></table></div>;
}

function Status({ items }: { items: ChartItem[] }) {
  if (!items.length) return <div className="analyticsNoData">No diagnostics available.</div>;
  return <div className="analyticsStatusList">{items.map((item) => <div key={item.label} title={titleAttr(item.title || item.label)}>
    <span className={'analyticsStatusDot ' + (item.value ? 'ok' : 'wait')} />
    <b>{item.label}</b><span>{item.title || (item.value ? 'Available' : 'No activity recorded')}</span>
    {item.href ? <a href={item.href}>Inspect</a> : null}
  </div>)}</div>;
}

function PanelBody({ panel }: { panel: Panel }) {
  if (panel.error) return <div className="analyticsUnavailable"><b>Not available</b><span>{panel.error}</span></div>;
  if (panel.kind === 'bars') return <Bars items={panel.data.items || []} />;
  if (panel.kind === 'donut') return <Donut items={panel.data.items || []} />;
  if (panel.kind === 'line') return <Line labels={panel.data.labels || []} series={panel.data.series || []} />;
  if (panel.kind === 'stacked') return <Stacked labels={panel.data.labels || []} series={panel.data.series || []} />;
  if (panel.kind === 'funnel') return <Funnel steps={panel.data.steps || []} />;
  if (panel.kind === 'status') return <Status items={panel.data.items || []} />;
  return <DataTable columns={panel.data.columns || []} rows={panel.data.rows || []} />;
}

function PanelCard({ panel }: { panel: Panel }) {
  return <section className={`analyticsPanel span-${panel.span || 1}`}>
    <div className="analyticsPanelHead"><div><h2>{panel.title}</h2><p>{panel.question}</p></div><span className={'analyticsQualityBadge ' + panel.quality} title={`Source: ${panel.source}. Method: ${panel.method}`}>{qLabel(panel.quality)}</span></div>
    <PanelBody panel={panel} />
    <div className="analyticsPanelFoot"><span>{panel.source}</span>{panel.href ? <a href={panel.href}>Open report</a> : null}</div>
    {panel.note ? <p className="analyticsNote">{panel.note}</p> : null}
  </section>;
}

function DetailTable({ table }: { table: ReportTable }) {
  return <section className="analyticsWideTable">
    <div className="analyticsPanelHead"><div><h2>{table.title}</h2><p>{table.description}</p></div><span className={'analyticsQualityBadge ' + table.quality}>{qLabel(table.quality)}</span></div>
    {table.error ? <div className="analyticsUnavailable"><b>Not available</b><span>{table.error}</span></div> : <DataTable columns={table.columns} rows={table.rows} />}
    <div className="analyticsPanelFoot"><span>{table.source}</span></div>
  </section>;
}

export default function AnalyticsDashboard({ report, printMode = false }: { report: AnalyticsReport; printMode?: boolean }) {
  const period = report.period;
  return <div className={'analyticsDashboard' + (printMode ? ' analyticsPrint' : '')}>
    <header className="analyticsHero">
      <div>
        <span className="eyebrow">SKY CARS / EXECUTIVE REPORTING</span>
        <h1>Business Analytics</h1>
        <p>One operating view for inventory, customers, conversations, quotes, fulfilment, AI and staff work.</p>
      </div>
      <div className="analyticsHeroMeta">
        <span className="analyticsPeriod">{period.label}</span>
        <small>Updated {new Date(report.generatedAt).toLocaleString()} · {period.comparisonLabel}</small>
        {report.alertCount ? <a className="analyticsAlertPill" href="#priorities">{report.alertCount} actions need attention</a> : null}
      </div>
    </header>
    {!report.databaseConfigured && <div className="analyticsWarning"><b>Database not configured</b><span>Connect the Hostinger MySQL environment variables to populate this report. The dashboard is showing untracked states rather than invented numbers.</span></div>}
    {!printMode && <section className="analyticsToolbar">
      <div className="analyticsRangeLinks">
        {[['today','Today'],['7d','7 days'],['30d','30 days'],['this_month','This month'],['previous_month','Previous month'],['this_year','This year'],['all','All time']].map(([key,label]) => <a key={key} className={period.key === key ? 'active' : ''} href={qs(period,{range:key})}>{label}</a>)}
      </div>
      <form className="analyticsCustomRange" method="get">
        <input type="hidden" name="range" value="custom" />
        <label>From<input type="date" name="from" defaultValue={period.from} /></label>
        <label>To<input type="date" name="to" defaultValue={period.to} /></label>
        <button className="btn-primary" type="submit">Apply</button>
      </form>
      <div className="analyticsActions">
        <a className="btn-neutral" href={'/api/admin/analytics/export?format=csv&' + new URLSearchParams({range:period.key,from:period.from,to:period.to}).toString()}>CSV</a>
        <a className="btn-neutral" href={'/api/admin/analytics/export?format=xls&' + new URLSearchParams({range:period.key,from:period.from,to:period.to}).toString()}>Excel</a>
        <a className="btn-neutral" href={'/admin/analytics/print?' + new URLSearchParams({range:period.key,from:period.from,to:period.to}).toString()}>Print / PDF</a>
      </div>
    </section>}
    <section className="analyticsKpiGrid">{report.kpis.map((item) => <KpiCard item={item} key={item.key} />)}</section>
    <div className="analyticsSectionIntro"><div><span className="eyebrow">OPERATING ANALYSIS</span><h2>What the numbers are doing</h2></div><span>{report.panels.length} analytical panels · {report.tables.length} detailed tables</span></div>
    <div className="analyticsPanelGrid">{report.panels.map((panel) => <PanelCard panel={panel} key={panel.key} />)}</div>
    <div className="analyticsSectionIntro"><div><span className="eyebrow">DETAILED REPORTS</span><h2>Work queues and inventory quality</h2></div></div>
    <div className="analyticsTables">{report.tables.map((table) => <DetailTable table={table} key={table.key} />)}</div>
    <details className="analyticsDefinitions"><summary>Metric dictionary: sources, periods, deduplication and limitations</summary>
      <div className="analyticsTableWrap"><table className="analyticsTable"><thead><tr><th>Metric</th><th>Source</th><th>Period</th><th>Logic / deduplication</th><th>Quality</th><th>Limitation</th></tr></thead><tbody>
        {report.definitions.map((d) => <tr key={d.metric}><td><b>{d.metric}</b></td><td>{d.source}</td><td>{d.period}</td><td>{d.method}</td><td><span className={'analyticsQualityBadge ' + d.quality}>{qLabel(d.quality)}</span></td><td>{d.limitation}</td></tr>)}
      </tbody></table></div>
    </details>
    {printMode && <PrintButton />}
  </div>;
}
