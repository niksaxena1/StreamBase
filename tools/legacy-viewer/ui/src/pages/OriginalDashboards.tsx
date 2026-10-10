import { useEffect, useState } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useQuery } from '../lib/api';
import { originalHref, layoutPanels, type Dashboard, type DashboardRow, type Variables } from '../lib/original';
import { Chip, CollapsibleSection, EmptyState } from '../components/ui';
import { OriginalPanel } from '../components/original/OriginalPanel';
import { OriginalTimePicker, useDashboardVariables, VariableBar } from '../components/original/DashboardControls';
import { Status, Title } from './shared';

export function OriginalRow({ dashboard, row, values, range }: { dashboard: Dashboard; row: DashboardRow; values: Variables; range: { from?: string; to?: string } }) {
  const [state] = useUrlState(), storageKey = `legacy-original-row:${dashboard.key}:${row.id}`;
  const [open, setOpen] = useState(() => {
    try { const saved = localStorage.getItem(storageKey); return state.params.row === row.title || (saved == null ? !row.collapsed : saved === 'true'); } catch { return !row.collapsed; }
  });
  function toggle(value: boolean) { setOpen(value); try { localStorage.setItem(storageKey, String(value)); } catch { /* storage optional */ } }
  return <CollapsibleSection title={row.title} description={`${row.panels.length} panels`} open={open} onOpenChange={toggle}>
    {open && (row.panels.length ? <div className="original-grid original-positioned-grid">{layoutPanels(row.panels).sort((a, b) => (a.gridPos?.y ?? 0) - (b.gridPos?.y ?? 0) || (a.gridPos?.x ?? 0) - (b.gridPos?.x ?? 0)).map(p => <OriginalPanel key={`${p.id}:${p.instance ?? ''}`} panel={p} dashboard={dashboard} values={values} range={range} gridLayout />)}</div> : <p className="muted">Other panels identical to stats2.</p>)}
  </CollapsibleSection>;
}
function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const [state, setState] = useUrlState(), controls = useDashboardVariables(dashboard);
  useEffect(() => {
    const dataset = dashboard.dataset === 'pf' ? 'followers' : dashboard.dataset === 'stats' ? 'stats' : 'stats2';
    if (state.dataset !== dataset) setState({ dataset });
  }, [dashboard.dataset, state.dataset, setState]);
  const range = { from: state.from || undefined, to: state.to || undefined };
  return <div className="original-dashboard"><Title>{dashboard.title}</Title>
    <Chip variant="info">Grafana v{dashboard.grafana_version} · version {dashboard.version} · reproduced offline, proven equal to the original SQL</Chip>
    <OriginalTimePicker dashboard={dashboard} /><VariableBar dashboard={dashboard} controls={controls} />
    {dashboard.server === 'stats' && <p className="original-older">Older version on stats server — only panels that differ. {dashboard.identical_panel_ids.length} other panels identical to stats2. <a href={originalHref(dashboard.key.replace('stats.', 'stats2.'))}>Open stats2 version</a></p>}
    {!controls.loading && !controls.error && dashboard.rows.map(row => <OriginalRow key={row.id} dashboard={dashboard} row={row} values={controls.values} range={range} />)}
    {!dashboard.rows.some(row => row.panels.length) && <EmptyState title="All panels identical to stats2" description="Open the stats2 dashboard to see these panels." />}
  </div>;
}
export default function OriginalDashboardsPage() {
  const [state, setState] = useUrlState(), q = useQuery<{ dashboards: Dashboard[] }>('/api/original/dashboards');
  return <Status query={q}>{({ dashboards }) => {
    const current = dashboards.find(d => d.key === state.params.dash) ?? dashboards.find(d => d.key === (state.dataset === 'followers' ? 'pf.playlist-followers' : `${state.dataset}.spotify-dash`)) ?? dashboards[0];
    return <div className="original-layout"><aside className="original-nav" aria-label="Original dashboards">
      {['stats2', 'stats', 'pf'].map(server => <section key={server}><h2>{server === 'pf' ? 'Playlist followers server' : `${server} server`}</h2>{dashboards.filter(d => d.server === server).map(d => <a key={d.key} href={originalHref(d.key)} aria-current={d.key === current.key ? 'page' : undefined}
        onClick={e => { e.preventDefault(); setState({ page: 'original', dataset: d.dataset === 'pf' ? 'followers' : d.dataset === 'stats' ? 'stats' : 'stats2', from: '', to: '', params: { dash: d.key } }); }}>
        <strong>{d.starred ? '★ ' : ''}{d.title}</strong><span className="small muted">v{d.version}{d.starred ? ' · you used this' : ''}</span>{server === 'stats' && <span className="small muted">Older version on stats server — only panels that differ</span>}
      </a>)}</section>)}
    </aside><DashboardView key={current.key} dashboard={current} /></div>;
  }}</Status>;
}
