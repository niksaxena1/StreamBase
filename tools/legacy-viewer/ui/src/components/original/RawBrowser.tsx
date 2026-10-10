import { useUrlState } from '../../app/useUrlState';
import { exportCSV, useQuery } from '../../lib/api';
import type { Meta, Row } from '../../lib/explorer';
import { Button, FilterBar, Select } from '../ui';
import { DateRangePicker } from '../ui/DateRangePicker';
import { DataTable } from '../ui/DataTable';
import { col, Search } from '../../pages/shared';

export function RawBrowser({ followers = false }: { followers?: boolean }) {
  const [state, setState] = useUrlState(), meta = useQuery<Meta>('/api/meta');
  const dataset = state.dataset === 'stats' ? 'stats' : 'stats2';
  const end = (followers ? meta.data?.followers.last_day : meta.data?.datasets.find(d => d.key === dataset)?.last_day) ?? '';
  const start = end ? new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10) : '';
  const from = state.params['raw-from'] || start, to = state.params['raw-to'] || end;
  const offset = Math.max(0, Number(state.params['raw-offset']) || 0);
  const params = { dataset, from, to, playlist: state.params['raw-playlist'] || undefined, account: state.params['raw-account'] || undefined,
    q: state.params['raw-q'] || undefined, spotify_id: state.params['raw-spotify-id'] || undefined, limit: 100, offset,
    sort: state.params['raw-sort'] || (followers ? 'timestamp' : 'created_at'), dir: state.params['raw-dir'] || 'desc' };
  const q = useQuery<{ rows: Row[]; total: number; note: string }>('/api/raw/' + (followers ? 'follower-readings' : 'observations'), params, Boolean(from && to));
  const filter = (patch: Record<string, string>) => setState({ params: { ...state.params, ...patch, 'raw-offset': '0' } });
  const fields = followers ? ['timestamp', 'playlist_name', 'playlist_id', 'account_name', 'user_id', 'followers'] : ['created_at', 'playlist_id', 'spotify_track_id', 'song_name', 'artist', 'play_count', 'id', 'in_stats_dump'];
  return <section className="raw-browser"><p className="muted">Verbatim collector readings. Default: last 7 archive days. Choose up to 367 days to keep raw scans fast.</p>
    <FilterBar>{end && <DateRangePicker bounds={{ from: followers ? meta.data!.followers.first_day : meta.data!.datasets.find(d => d.key === dataset)!.first_day, to: end }} value={{ from, to }} onChange={r => filter({ 'raw-from': r.from, 'raw-to': r.to })} />}
      {followers ? <Search label="Playlist ID" value={state.params['raw-playlist'] || ''} onChange={v => filter({ 'raw-playlist': v })} /> : <label>Playlist <Select value={state.params['raw-playlist'] || ''} onChange={e => filter({ 'raw-playlist': e.target.value })}><option value="">All playlists</option>{meta.data?.playlists.map(p => <option key={String(p.playlist_id)} value={String(p.playlist_id)}>{String(p.name ?? p.playlist_id)}</option>)}</Select></label>}
      {followers ? <Search label="Account" value={state.params['raw-account'] || ''} onChange={v => filter({ 'raw-account': v })} /> : <Search label="Spotify ID" value={state.params['raw-spotify-id'] || ''} onChange={v => filter({ 'raw-spotify-id': v })} />}
      <Search label={followers ? 'Search playlist or account' : 'Search track or artist'} value={state.params['raw-q'] || ''} onChange={v => filter({ 'raw-q': v })} />
      <Button disabled={!from || !to} onClick={() => exportCSV({ ...params, view: followers ? 'raw_follower_readings' : 'raw_observations' })}>Export raw CSV</Button>
    </FilterBar>
    <DataTable<Row> label={followers ? 'Raw follower readings' : 'Raw observations'} rows={q.data?.rows ?? []} columns={fields.map(f => col(f, f.replaceAll('_', ' '), ['followers', 'play_count', 'id'].includes(f), followers ? ['timestamp', 'followers', 'playlist_name', 'account_name'].includes(f) : ['created_at', 'play_count', 'song_name', 'artist', 'id'].includes(f)))}
      rowKey={r => followers ? `${r.timestamp}:${r.playlist_id}:${r.account_name}` : String(r.id)} loading={!from || q.loading} error={q.error?.message} retry={() => void q.refetch()}
      sort={{ key: params.sort, direction: params.dir === 'asc' ? 'asc' : 'desc' }} onSort={s => filter({ 'raw-sort': s.key, 'raw-dir': s.direction })}
      pagination={{ page: offset / 100, pageSize: 100, total: q.data?.total ?? 0, onPageChange: page => setState({ params: { ...state.params, 'raw-offset': String(page * 100) } }) }} />
  </section>;
}
