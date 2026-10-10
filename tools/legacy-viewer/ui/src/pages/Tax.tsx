import { useUrlState } from '../app/useUrlState';
import { useQuery } from '../lib/api';
import { originalHref, type Dashboard } from '../lib/original';
import { OriginalPanel } from '../components/original/OriginalPanel';
import { useDashboardVariables, VariableSelect, OriginalTimePicker } from '../components/original/DashboardControls';
import { Card, SegmentedControl } from '../components/ui';
import { Status, Title } from './shared';

function TaxView({ dashboard }: { dashboard: Dashboard }) {
  const [state, setState] = useUrlState(), controls = useDashboardVariables(dashboard), view = state.params.view === 'playlist' ? 'playlist' : 'person';
  const name = view === 'person' ? 'person' : 'playlist_id', row = dashboard.rows.find(r => r.title === (view === 'person' ? 'Person View' : 'Playlist View'));
  const value = controls.values.person;
  const playlists = typeof value === 'string' ? value.split(';').map(id => dashboard.variables.playlist_id.options.find(o => o.value === id)?.text ?? id) : [];
  const accounting = dashboard.rows.find(r => r.title === 'Accounting Help')?.panels.filter(p => p.status === 'implemented' && (view === 'person' ? /\$person/.test(p.title) : /\$playlist_id/.test(p.title))) ?? [];
  return <><Title description="Tax V2 calculations preserved from the original dashboard.">Tax</Title>
    <Card className="explorer-notes tax-revenue-note"><strong>Est. Revenue = streams × 0.002 — the hard-coded rate from the original dashboard; not accounting data</strong><p>Monthly values use the 2nd-of-month snapshot; months without a day-2 snapshot are skipped. Tied daily modes can duplicate rows. Daily changes span collection gaps, just as in the original.</p></Card>
    <div className="filter-bar"><SegmentedControl label="Tax view" value={view} options={[{ value: 'person', label: 'Person' }, { value: 'playlist', label: 'Playlist' }]} onChange={v => setState({ params: { ...state.params, view: v } })} />
      <VariableSelect variable={dashboard.variables[name]} value={controls.values[name]} options={controls.options[name]} onChange={v => controls.change(name, v)} />
      <VariableSelect variable={dashboard.variables.month} value={controls.values.month} options={controls.options.month} onChange={v => controls.change('month', v)} />
    </div><OriginalTimePicker dashboard={dashboard} />
    {view === 'person' && <Card className="explorer-notes"><strong>Playlists in this person</strong><p>{playlists.join(' · ')}</p></Card>}
    <Status query={{ data: !controls.loading ? controls : undefined, loading: controls.loading, error: controls.error ? new Error(controls.error) : undefined, refetch: async () => controls.change(name, controls.values[name]) }}>{() => <div className="original-grid tax-grid">{[...(row?.panels ?? []), ...accounting].map(p => <OriginalPanel key={p.id} panel={p} dashboard={dashboard} values={controls.values} range={{ from: state.from || undefined, to: state.to || undefined }} inlineQuirks />)}</div>}</Status>
    <p><a href={originalHref('stats2.tax-v2')}>Open the full Tax V2 dashboard</a> · <a href={originalHref('stats2.tax-old')}>Open Tax (Old)</a></p>
  </>;
}
export default function TaxPage() {
  const q = useQuery<{ dashboards: Dashboard[] }>('/api/original/dashboards');
  return <Status query={q}>{d => <TaxView dashboard={d.dashboards.find(d => d.key === 'stats2.tax-v2')!} />}</Status>;
}
