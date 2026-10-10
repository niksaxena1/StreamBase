import { useQuery } from "../lib/api";
import {
  mergeSeries,
  numberValue,
  textValue,
  type Overview,
  type Row,
} from "../lib/explorer";
import { Num } from "../components/ui";
import { TimeSeriesChart } from "../components/charts";
import {
  Button,
  Card,
  Chip,
  Chips,
  EmptyState,
  FilterBar,
  Method,
  Status,
  Title,
  useExplorer,
} from "./shared";
function Compare({ ids }: { ids: string[] }) {
  const e = useExplorer();
  // Fixed slots keep hooks stable. Unselected slots share the cached first query.
  const q0 = useQuery<Overview>(
      `/api/explorer/playlist/${encodeURIComponent(ids[0])}`,
      e.params,
    ),
    q1 = useQuery<Overview>(
      `/api/explorer/playlist/${encodeURIComponent(ids[1] ?? ids[0])}`,
      e.params,
    ),
    q2 = useQuery<Overview>(
      `/api/explorer/playlist/${encodeURIComponent(ids[2] ?? ids[0])}`,
      e.params,
    ),
    q3 = useQuery<Overview>(
      `/api/explorer/playlist/${encodeURIComponent(ids[3] ?? ids[0])}`,
      e.params,
    ),
    q4 = useQuery<Overview>(
      `/api/explorer/playlist/${encodeURIComponent(ids[4] ?? ids[0])}`,
      e.params,
    ),
    q5 = useQuery<Overview>(
      `/api/explorer/playlist/${encodeURIComponent(ids[5] ?? ids[0])}`,
      e.params,
    );
  const queries = [q0, q1, q2, q3, q4, q5].slice(0, ids.length),
    bad = queries.find((q) => q.error),
    loading = queries.some((q) => q.loading);
  return (
    <Status
      query={{
        data: queries,
        loading,
        error: bad?.error,
        refetch: async () => {
          await Promise.all(queries.map((q) => q.refetch()));
        },
      }}
    >
      {() => (
        <TimeSeriesChart
          title="Compare playlist totals"
          actions={
            <Method method="F2: mode of hourly sums per playlist, ties choose higher" />
          }
          data={mergeSeries(
            ids.map((id, i) => ({
              key: id,
              series: queries[i].data?.series || [],
            })),
            "total",
          )}
          series={ids.map((id) => ({
            key: id,
            label: textValue(
              e.meta.data?.playlists.find((p) => p.playlist_id === id)?.name ??
                id,
            ),
          }))}
          stepDays={
            e.state.grain === "weekly"
              ? 7
              : e.state.grain === "monthly"
                ? 32
                : 1
          }
        />
      )}
    </Status>
  );
}
export default function PlaylistsPage() {
  const e = useExplorer(),
    q = useQuery<{ rows: Row[] }>("/api/explorer/playlists", e.params),
    ids = (e.state.params.compare || "").split(",").filter(Boolean),
    compare = e.state.params.mode === "compare";
  return (
    <>
      <Title description="Playlist totals sum each member track's daily mode, which is robust to duplicate scrapes. Grafana's hourly-total method is available in Original dashboards. Membership changes alter totals.">
        Playlists
      </Title>
      <FilterBar>
        <Button
          onClick={() => e.filter({ mode: compare ? "browse" : "compare" })}
        >
          {compare ? "Browse playlists" : "Compare playlists"}
        </Button>
        {compare && (
          <span className="muted">Select up to six playlists to overlay.</span>
        )}
      </FilterBar>
      {compare && ids.length > 0 && <Compare ids={ids} />}
      <Status query={q}>
        {(d) =>
          d.rows.length ? (
            <div className="playlist-grid">
              {d.rows.map((r) => (
                <Card key={String(r.playlist_id)} className="playlist-card">
                  <div className="row spread">
                    <h2>{textValue(r.name ?? r.playlist_id)}</h2>
                    {r.name == null && (
                      <Chip variant="warning">name unknown</Chip>
                    )}
                  </div>
                  <Chips value={r.persons} />
                  <Chips value={r.groups} />
                  <p className="mono small">
                    {textValue(r.first_day)} → {textValue(r.last_day)}
                  </p>
                  <p>
                    <Num value={numberValue(r.observed_tracks)} /> tracks observed
                  </p>
                  <div className="row spread">
                    <span>Latest total</span>
                    <strong className="mono">
                      <Num value={numberValue(r.total)} />
                    </strong>
                  </div>
                  <div className="row spread">
                    <span>Change in total</span>
                    <strong className="mono">
                      <Num value={numberValue(r.gained)} />
                    </strong>
                  </div>
                  <div className="row">
                    <Button
                      onClick={() =>
                        e.go("playlist", { id: String(r.playlist_id) })
                      }
                    >
                      Open playlist
                    </Button>
                    {compare && (
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={ids.includes(String(r.playlist_id))}
                          disabled={
                            ids.length >= 6 &&
                            !ids.includes(String(r.playlist_id))
                          }
                          onChange={(ev) =>
                            e.filter({
                              compare: (ev.target.checked
                                ? [...ids, String(r.playlist_id)]
                                : ids.filter((id) => id !== r.playlist_id)
                              ).join(","),
                            })
                          }
                        />
                        Compare
                      </label>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No playlists observed"
              description="No playlist counters were collected in these dates. Widen the range to include collection days."
            />
          )
        }
      </Status>
    </>
  );
}
