import { useQuery } from "../lib/api";
import { originalHref } from '../lib/original';
import { textValue, type Overview, type Row } from "../lib/explorer";
import { trackColumns } from "./Tracks";
import {
  Card,
  Chips,
  col,
  Metrics,
  Rows,
  SeriesCharts,
  Status,
  Title,
  useExplorer,
} from "./shared";
export default function PlaylistDetail() {
  const e = useExplorer(),
    q = useQuery<Overview & { playlist: Row; tracks: Row[] }>(
      `/api/explorer/playlist/${encodeURIComponent(e.state.params.id || "")}`,
      e.params,
    );
  return (
    <>
      <Title>Playlist detail</Title>
      <Status query={q}>
        {(d) => (
          <>
            <Card className="detail-header">
              <h2>{textValue(d.playlist.name ?? d.playlist.playlist_id)}</h2>
              {['0OwqBeZIh0JNJcIVobdtOz','0lPHklGFUqJpaXr5wSiruZ','6Cbnl3B3t8mPcEXWskPjfw','2EuoQnq87hZO6gVNkAv0gA'].includes(String(d.playlist.playlist_id)) && <p className="small"><a href={originalHref('stats2.spotify-dash', 'Individual Playlists')}>View the original Grafana panel</a></p>}
              <Chips value={d.playlist.persons} />
              <Chips value={d.playlist.groups} />
              <p className="mono small">{textValue(d.playlist.playlist_id)}</p>
            </Card>
            <Metrics
              items={[
                { label: "Latest total", value: d.kpis.latest_streams },
                { label: "Change in playlist total", value: d.kpis.gained, sublabel: "Includes tracks added to or removed from the playlist" },
                { label: "Avg daily net", value: d.kpis.avg_daily_net },
              ]}
            />
            <SeriesCharts
              rows={d.series}
              counter="total"
              net="net"
              method={d.method}
              notes={d.notes}
            />
            <Rows
              nowrap
              label="Playlist tracks"
              rows={d.tracks}
              columns={[
                ...trackColumns.slice(0, 4),
                col("membership_first_day", "First seen here"),
                col("membership_last_day", "Last seen here"),
                ...trackColumns.slice(6),
              ]}
              onRowClick={(r) => e.go("track", { isrc: String(r.isrc) })}
            />
          </>
        )}
      </Status>
    </>
  );
}
