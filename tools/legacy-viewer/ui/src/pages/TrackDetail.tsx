import { useState } from "react";
import { exportCSV, useQuery } from "../lib/api";
import { originalHref } from '../lib/original';
import { serializeState } from "../app/useUrlState";
import {
  mergeSeries,
  numberValue,
  readingsExplanation,
  strings,
  textValue,
  type Row,
  type SeriesRow,
} from "../lib/explorer";
import {
  Artwork,
  ConfidenceMeter,
  CopyableText,
  Drawer,
  Tabs,
} from "../components/ui";
import { TimeSeriesChart } from "../components/charts";
import {
  Button,
  Card,
  Chips,
  col,
  Method,
  Metrics,
  Notes,
  Rows,
  SeriesCharts,
  Status,
  Title,
  useExplorer,
} from "./shared";
type Detail = {
  identity: Row;
  summary: Row | null;
  series: SeriesRow[];
  per_id: { spotify_track_id: string; series: SeriesRow[] }[];
  records: Row[];
  milestones: Row[];
  playlists: Row[];
  method: string;
};
function Readings({ isrc, day }: { isrc: string; day: string }) {
  const e = useExplorer(),
    q = useQuery<{ rows: Row[]; limit: number; method: string }>(
      `/api/track/${encodeURIComponent(isrc)}/readings`,
      { ...e.params, day },
    );
  return (
    <Status query={q}>
      {(d) => (
        <>
          <Notes notes={readingsExplanation(d.rows)} />
          <p className="muted">
            Highlighted values equal the per-ID mode; ties choose the higher
            counter.{" "}
            {d.rows.length === d.limit
              ? "Display capped at 5,000 readings; CSV includes every reading."
              : ""}
          </p>
          <Button
            onClick={() => exportCSV({ ...e.params, view: "track", isrc, day })}
          >
            Raw readings CSV for this day
          </Button>
          <Rows
            rows={d.rows}
            label="Raw readings"
            columns={[
              col("created_at", "Time (UTC)"),
              {
                key: "playlist_name",
                label: "Playlist",
                render: (r) => textValue(r.playlist_name ?? r.playlist_id),
              },
              col("spotify_track_id", "Spotify ID"),
              {
                ...col("play_count", "Play count", true),
                render: (r) => (
                  <span
                    className={
                      r.play_count != null && r.play_count === r.mode
                        ? "chip chip-accent mono"
                        : "mono"
                    }
                  >
                    {col("play_count", "", true).render(r)}
                  </span>
                ),
              },
              col("mode", "Chosen mode", true),
              col("mode_frequency", "Frequency", true),
            ]}
          />
        </>
      )}
    </Status>
  );
}
function Membership({ rows }: { rows: Row[] }) {
  const start = Math.min(...rows.map((r) => Date.parse(String(r.first_day)))),
    end = Math.max(...rows.map((r) => Date.parse(String(r.last_day))));
  return rows.length ? (
    <Card>
      <p className="muted small">
        Span between first and last observed membership; does not imply
        uninterrupted presence.
      </p>
      {rows.map((r) => (
        <div key={String(r.playlist_id)} className="membership-row">
          <span>{textValue(r.playlist)}</span>
          <div className="membership-track">
            <span
              style={{
                marginLeft: `${((Date.parse(String(r.first_day)) - start) / Math.max(86400000, end - start)) * 100}%`,
                width: `${Math.max(1, ((Date.parse(String(r.last_day)) - Date.parse(String(r.first_day))) / Math.max(86400000, end - start)) * 100)}%`,
              }}
            />
          </div>
          <span className="mono small">
            {textValue(r.first_day)} → {textValue(r.last_day)}
          </span>
        </div>
      ))}
    </Card>
  ) : (
    <Rows rows={[]} label="Membership" />
  );
}
export default function TrackDetail() {
  const e = useExplorer(),
    isrc = e.state.params.isrc || "",
    query = useQuery<Detail>(
      `/api/track/${encodeURIComponent(isrc)}`,
      e.params,
    ),
    [day, setDay] = useState("");
  return (
    <>
      <Title>Track detail</Title>
      <Status query={query}>
        {(d) => (
          <>
            <Card className="detail-header detail-header-art">
              <Artwork
                src={d.identity.art as string | null | undefined}
                name={textValue(d.identity.song_name)}
                size={72}
              />
              <div className="detail-header-text">
              <h2>{textValue(d.identity.song_name)}</h2>
              <p>
                {(
                  (d.identity.artists as
                    | { name: string; art: string | null }[]
                    | undefined) ??
                  String(d.identity.artist)
                    .split(",")
                    .map((name) => ({ name: name.trim(), art: null }))
                ).map((credit, index) => (
                  <span key={credit.name}>
                    {index > 0 && ", "}
                    <a
                      className="text-link"
                      href={serializeState({
                        ...e.state,
                        page: "artist",
                        from: "",
                        to: "",
                        params: { name: credit.name },
                      })}
                    >
                      {credit.name}
                    </a>
                  </span>
                ))}
              </p>
              <p className="small"><a href={originalHref('stats2.spotify-dash', 'Track Specific', { artist_name: String(d.identity.artist).split(',')[0].trim(), track_name: String(d.identity.song_name) })}>View the original Grafana panel</a></p>
              <CopyableText text={isrc} label="ISRC" />
              {strings(d.identity.spotify_track_ids).map((id) => (
                <CopyableText key={id} text={id} label="Spotify ID" />
              ))}
              <Chips
                value={
                  d.summary?.playlists ?? d.playlists.map((p) => p.playlist)
                }
              />
              <p className="mono small">
                First observed {textValue(d.identity.first_day)} · Last observed{" "}
                {textValue(d.identity.last_day)}
              </p>
              </div>
            </Card>
            <Metrics
              items={[
                {
                  label: "Latest streams in range",
                  value: d.summary?.latest_streams,
                },
                { label: "Gained", value: d.summary?.gained },
                { label: "Resets", value: d.summary?.resets },
              ]}
            />
            <SeriesCharts
              rows={d.series}
              method={d.method}
              notes={[
                "For each ID, use the most frequent daily reading; ties choose higher. The ISRC takes the highest linked-ID counter.",
              ]}
            />
            {d.per_id.length > 1 && (
              <>
                <h2>Linked Spotify IDs</h2>
                <Notes
                  notes={[
                    "Explorer uses the highest counter per UTC day across linked Spotify IDs. Grafana track panels add linked counters, which can double count re-releases.",
                  ]}
                />
                <TimeSeriesChart
                  title="Linked ID counters"
                  actions={
                    <Method method="F1 per-ID daily mode; ties choose higher" />
                  }
                  data={mergeSeries(
                    d.per_id.map((i) => ({
                      key: i.spotify_track_id,
                      series: i.series,
                    })),
                    "streams",
                  )}
                  series={d.per_id.map((i) => ({
                    key: i.spotify_track_id,
                    label: i.spotify_track_id,
                  }))}
                  stepDays={
                    e.state.grain === "weekly"
                      ? 7
                      : e.state.grain === "monthly"
                        ? 32
                        : 1
                  }
                />
              </>
            )}
            <div className="row">
              <Button
                onClick={() =>
                  exportCSV({ ...e.params, view: "track_records", isrc })
                }
              >
                Records CSV
              </Button>
              <Button
                onClick={() =>
                  exportCSV({ ...e.params, view: "track", isrc, raw: 1 })
                }
              >
                All raw readings CSV
              </Button>
            </div>
            <Tabs
              label="Track evidence"
              value={e.state.params.tab || "records"}
              onChange={(tab) => e.filter({ tab })}
              items={[
                {
                  value: "records",
                  label: "Records",
                  content: (
                    <Rows
                      label="Exact daily records"
                      rows={d.records}
                      columns={[...new Set(d.records.flatMap(Object.keys))].map(
                        (k) => ({
                          ...col(k, k.replaceAll("_", " ")),
                          render: (r: Row) =>
                            k === "mode_confidence" ? (
                              <ConfidenceMeter value={numberValue(r[k])} />
                            ) : (
                              textValue(r[k])
                            ),
                        }),
                      )}
                      onRowClick={(r) => setDay(String(r.day))}
                    />
                  ),
                },
                {
                  value: "milestones",
                  label: "Milestones",
                  content: (
                    <Rows label="Track milestones" rows={d.milestones} />
                  ),
                },
                {
                  value: "membership",
                  label: "Playlist membership",
                  content: <Membership rows={d.playlists} />,
                },
              ]}
            />
          </>
        )}
      </Status>
      <Drawer
        title={`Raw readings · ${day}`}
        open={!!day}
        onClose={() => setDay("")}
      >
        {day && <Readings isrc={isrc} day={day} />}
      </Drawer>
    </>
  );
}
