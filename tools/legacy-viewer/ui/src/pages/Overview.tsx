import { serializeState } from "../app/useUrlState";
import { Artwork, Num } from "../components/ui";
import { useQuery } from "../lib/api";
import { originalHref } from "../lib/original";
import {
  numberValue,
  type Overview,
  type Paged,
  type Quality,
} from "../lib/explorer";
import { CalendarHeatmap } from "../components/charts";
import {
  HeatmapSkeleton,
  OverviewSkeleton,
  TopCardsSkeleton,
} from "../components/ui/Skeletons";
import {
  FilterBar,
  Method,
  Metrics,
  Scope,
  SeriesCharts,
  Status,
  Title,
  useExplorer,
} from "./shared";
export default function OverviewPage() {
  const e = useExplorer(),
    query = useQuery<Overview>("/api/explorer/overview", e.params),
    movers = useQuery<Paged>("/api/explorer/tracks", {
      ...e.params,
      sort: "gained",
      dir: "desc",
      limit: 8,
      offset: 0,
    }),
    quality = useQuery<Quality>("/api/quality", e.params);
  return (
    <>
      <Title description="ISRC history, collection gaps, and the original playlist measurement rules.">
        Overview
      </Title>
      <p className="small">
        <a href={originalHref(`${e.state.dataset}.spotify-dash`, "Overview")}>
          View the original Grafana panel
        </a>
      </p>
      <FilterBar>
        <Scope />
      </FilterBar>
      <Status query={query} skeleton={<OverviewSkeleton />}>
        {(d) => (
          <>
            <Metrics
              items={[
                {
                  label: "Latest cumulative streams",
                  value: d.kpis.latest_streams,
                },
                {
                  label: "Gained in range",
                  value: d.kpis.gained,
                  sublabel:
                    d.kpis.catalog_total_change == null
                      ? undefined
                      : `Sum of each track's growth · catalog total moved ${Number(d.kpis.catalog_total_change).toLocaleString("en-US")} incl. tracks entering/leaving tracking`,
                },
                { label: "Avg daily net", value: d.kpis.avg_daily_net },
                {
                  label: "Coverage",
                  value:
                    d.kpis.coverage_pct == null
                      ? null
                      : `${Number(d.kpis.coverage_pct).toFixed(1)}%`,
                },
              ]}
            />
            <div className="overview-secondary row muted small">
              <span>
                Tracks{" "}
                <strong className="mono">
                  <Num
                    value={numberValue(d.kpis.tracks ?? d.series.at(-1)?.tracks)}
                  />
                </strong>
              </span>
              <span
                title={
                  d.kpis.artists == null
                    ? "Not defined for playlist F2 totals"
                    : undefined
                }
              >
                Artists{" "}
                <strong className="mono">
                  <Num
                    value={d.kpis.artists == null ? null : Number(d.kpis.artists)}
                  />
                </strong>
              </span>
              <span
                title={
                  d.kpis.resets == null
                    ? "F2 totals do not identify track resets"
                    : undefined
                }
              >
                Resets in range{" "}
                <strong className="mono">
                  <Num
                    value={d.kpis.resets == null ? null : Number(d.kpis.resets)}
                  />
                </strong>
              </span>
            </div>
            <SeriesCharts
              rows={d.series}
              counter={d.method.includes("hourly") ? "total" : "streams"}
              net="net"
              method={d.method}
              notes={d.notes}
            />
          </>
        )}
      </Status>
      <h2>Top tracks in range</h2>
      <Status query={movers} skeleton={<TopCardsSkeleton />}>
        {(d) => (
          <ul className="top-cards" aria-label="Top tracks in range">
            {d.rows.map((r) => (
              <li className="top-card" key={String(r.isrc)}>
                <Artwork
                  src={r.art as string | null | undefined}
                  name={String(r.song_name)}
                  size={72}
                />
                <div className="top-card-body">
                  <a
                    className="top-card-title"
                    href={serializeState({
                      ...e.state,
                      page: "lookup",
                      from: "",
                      to: "",
                      params: { isrc: String(r.isrc) },
                    })}
                    title="Open in Track lookup"
                  >
                    {String(r.song_name)}
                  </a>
                  <span className="top-card-artist muted">
                    {String(r.artist)}
                  </span>
                  <dl className="top-card-stats">
                    <div>
                      <dt className="muted">Gained</dt>
                      <dd className="mono">
                        {r.gained == null ? "—" : <Num value={Number(r.gained)} signed />}
                      </dd>
                    </div>
                    <div>
                      <dt className="muted">Latest</dt>
                      <dd className="mono">
                        <Num value={numberValue(r.latest_streams)} />
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Status>
      <Status query={quality} skeleton={<HeatmapSkeleton />}>
        {(d) => (
          <CalendarHeatmap
            title="Collection coverage"
            description="All tracked tracks in the selected dataset; playlist scope does not change this archive-wide strip."
            actions={<Method method="Days with raw observations" />}
            bounds={{
              from:
                e.state.from ||
                e.meta.data?.datasets.find((x) => x.key === e.state.dataset)
                  ?.first_day ||
                String(d.coverage[0]?.day),
              to:
                e.state.to ||
                e.meta.data?.datasets.find((x) => x.key === e.state.dataset)
                  ?.last_day ||
                String(d.coverage.at(-1)?.day),
            }}
            data={d.coverage.map((r) => ({
              date: String(r.day),
              value: Number(r.observations),
            }))}
          />
        )}
      </Status>
    </>
  );
}
