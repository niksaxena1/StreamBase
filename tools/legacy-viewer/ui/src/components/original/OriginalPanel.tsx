import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, ErrorState, LoadingState } from '../ui';
import { exportCSV, useQuery } from '../../lib/api';
import { panelParams, titleText, type Dashboard, type Panel, type PanelResult, type Validation, type Variables } from '../../lib/original';
import { PanelRenderer } from './PanelRenderer';

type QuerySQL = { targets: { refId: string; original_sql?: string; duckdb_sql?: string; translation_rules?: string[] }[]; quirks: string[]; validation: Validation; status_reason?: string };
function QueryDrawer({ panel, onClose }: { panel: Panel; onClose: () => void }) {
  const q = useQuery<QuerySQL>('/api/original/panel-sql', { id: panel.id });
  return <Drawer open title="Original query and validation" onClose={onClose}>
    {q.loading && <LoadingState />}{q.error && <ErrorState message={q.error.message} retry={() => void q.refetch()} />}
    {q.data && <><p>{q.data.validation.cases_passed} / {q.data.validation.cases_run} validation cases passed against PostgreSQL.</p>
      {Object.entries(q.data.validation.outcomes).map(([key, n]) => <p key={key}>{key}: {n}</p>)}
      {[...q.data.quirks, ...q.data.validation.notes, q.data.status_reason].filter(Boolean).map((s, i) => <p key={i}>{s}</p>)}
      {q.data.targets.map((t, i) => <section key={i}><h3>Target {t.refId}</h3><h4>Original SQL</h4><pre>{t.original_sql ?? 'No SQL target'}</pre><h4>DuckDB SQL</h4><pre>{t.duckdb_sql ?? 'No translation'}</pre><p>{t.translation_rules?.join('\n')}</p></section>)}
    </>}
  </Drawer>;
}
function explorerLink(p: Panel, values: Variables): string | undefined {
  const row = p.row ?? '';
  if (p.status === 'consolidated') return p.id.startsWith('pf.') ? '#/followers?dataset=followers&tab=raw' : '#/archive?tab=raw';
  if (/tax/.test(p.id)) return '#/tax';
  if (p.id.startsWith('pf.')) return '#/followers?dataset=followers';
  if (/Milestones/.test(row)) return '#/milestones';
  if (/Artist Specific/.test(row) && typeof values.artist_name === 'string') return `#/artist?name=${encodeURIComponent(values.artist_name)}`;
  if (/Track Specific/.test(row) && typeof values.track_name === 'string') return `#/tracks?q=${encodeURIComponent(values.track_name)}`;
  if (row === 'Individual Playlists' && p.playlist_ids?.length === 1) return `#/playlist?id=${encodeURIComponent(p.playlist_ids[0])}`;
  if (row === 'Overview') return '#/overview';
  return undefined;
}
function PanelData({ panel, values, range, visible, inlineQuirks, anchor }: { panel: Panel; values: Variables; range: { from?: string; to?: string }; visible: boolean; inlineQuirks: boolean; anchor: string }) {
  const q = useQuery<PanelResult>('/api/original/panel', panelParams(panel, values, range), visible);
  if (q.error) return <ErrorState message={q.error.message} retry={() => void q.refetch()} />;
  if (!q.data) return visible ? <LoadingState /> : <p className="muted">Loads when visible</p>;
  return <div data-panel-ready="true" data-panel-ms={q.data.ms}>
    <PanelRenderer panel={panel} frames={q.data.frames} range={q.data.time_range} anchor={anchor} />
    {q.data.truncated && <p className="chip chip-warning">Display capped at 50,000 rows per frame. CSV includes all rows.</p>}
    {inlineQuirks && q.data.quirks.length > 0 && <aside className="original-quirks">{q.data.quirks.map(s => <p key={s}>{s}</p>)}</aside>}
    <footer className="muted small original-panel-foot">{q.data.ms.toLocaleString()} ms · {q.data.validation.cases_passed}/{q.data.validation.cases_run} proof cases</footer>
  </div>;
}
export function OriginalPanel({ panel, dashboard, values, range, inlineQuirks = false, gridLayout = false }: { panel: Panel; dashboard: Dashboard; values: Variables; range: { from?: string; to?: string }; inlineQuirks?: boolean; gridLayout?: boolean }) {
  const root = useRef<HTMLElement>(null), [visible, setVisible] = useState(false), [drawer, setDrawer] = useState(false), [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const title = titleText(panel.title, values, dashboard), link = explorerLink(panel, values);
  async function copy() {
    try {
      if (!root.current || !navigator.clipboard?.write || !window.ClipboardItem) throw new Error('PNG clipboard is unavailable in this browser');
      const { toBlob } = await import('html-to-image');
      const image = await toBlob(root.current, { pixelRatio: 2, filter: node => !(node instanceof HTMLElement && node.dataset.captureIgnore === 'true') });
      if (!image) throw new Error('Could not render panel');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]); setCopyStatus('PNG copied');
    } catch (e) { setCopyStatus(e instanceof Error ? e.message : 'Copy failed'); }
  }
  return <article ref={root} className="card original-panel" data-panel-id={panel.id} data-instance={panel.instance}
    style={{ gridColumn: `${(panel.gridPos?.x ?? 0) + 1} / span ${panel.gridPos?.w ?? 24}`, gridRow: gridLayout ? `${(panel.gridPos?.y ?? 0) + 1} / span ${panel.gridPos?.h ?? 8}` : undefined, minHeight: gridLayout ? 0 : Math.max(panel.type === 'stat' ? 130 : 200, (panel.gridPos?.h ?? 8) * 30) }}>
    <header className="row spread"><h3 title={title}>{title}</h3><details className="original-actions" data-capture-ignore="true"><summary aria-label={`Actions for ${title}`}>•••</summary><div className="popover">
      <Button onClick={() => setDrawer(true)}>Show query</Button>
      <Button disabled={panel.status !== 'implemented' || panel.type === 'text'} onClick={() => exportCSV({ view: 'original_panel', ...panelParams(panel, values, range) })}>Download CSV</Button>
      <Button onClick={() => void copy()}>Copy PNG</Button>
      {link && <a href={link}>Open in Explorer</a>}
    </div></details></header>
    {panel.status !== 'implemented' ? <div className="original-status"><p>{panel.status_reason}</p>{link && <a href={link}>Open in Explorer</a>}</div> : <PanelData panel={panel} values={values} range={range} visible={visible} inlineQuirks={inlineQuirks} anchor={dashboard.anchor} />}
    {copyStatus && <p role="status">{copyStatus}</p>}
    {drawer && <QueryDrawer panel={panel} onClose={() => setDrawer(false)} />}
  </article>;
}
