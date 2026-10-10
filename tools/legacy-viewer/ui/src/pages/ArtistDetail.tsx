import { useQuery } from "../lib/api";
import { originalHref } from '../lib/original';
import {
  numberValue,
  textValue,
  type Row,
  type SeriesRow,
} from "../lib/explorer";
import { BarGauge } from "../components/charts";
import { Artwork } from "../components/ui";
import { artistNote } from "./Artists";
import { trackColumns } from "./Tracks";
import {
  Method,
  Notes,
  Rows,
  SeriesCharts,
  Status,
  Title,
  useExplorer,
} from "./shared";
export default function ArtistDetail() {
  const e = useExplorer(),
    q = useQuery<{
      artist: string;
      art?: string | null;
      series: SeriesRow[];
      top_tracks: Row[];
      tracks: Row[];
      notes: string[];
    }>(
      `/api/artist/${encodeURIComponent(e.state.params.name || "")}`,
      e.params,
    );
  return (
    <>
      <Title>{e.state.params.name || "Artist detail"}</Title>
      {q.data && (
        <div className="artist-photo-row">
          <Artwork
            src={q.data.art}
            name={e.state.params.name || "Artist"}
            shape="round"
            size={72}
          />
        </div>
      )}
      <p className="small"><a href={originalHref('stats2.spotify-dash', 'Artist Specific', { artist_name: e.state.params.name || '' })}>View the original Grafana panel</a></p>
      <Status query={q}>
        {(d) => (
          <>
            <Notes notes={[artistNote, ...d.notes]} />
            <SeriesCharts
              rows={d.series}
              method="Sum of observed member ISRC counters"
              notes={d.notes}
            />
            <BarGauge
              title="Top tracks by latest streams"
              data={d.top_tracks.map((r) => ({
                name: textValue(r.song_name),
                value: numberValue(r.latest_streams),
              }))}
              actions={
                <Method method="Member ISRCs ranked by latest non-null counter" />
              }
            />
            <Rows
              nowrap
              label="Artist tracks"
              rows={d.tracks}
              columns={trackColumns}
              onRowClick={(r) => e.go("track", { isrc: String(r.isrc) })}
            />
          </>
        )}
      </Status>
    </>
  );
}
