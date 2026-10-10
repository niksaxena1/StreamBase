import { useQuery } from "../lib/api";
import {
  chartPoints,
  textValue,
  type Row,
  type SeriesRow,
} from "../lib/explorer";
import { TimeSeriesChart } from "../components/charts";
import { followerNote } from "./Followers";
import {
  Card,
  Chips,
  Method,
  Notes,
  Rows,
  SeriesCharts,
  Status,
  Title,
  useExplorer,
} from "./shared";
export default function FollowerPlaylist() {
  const e = useExplorer(),
    q = useQuery<{
      playlist: Row;
      series: SeriesRow[];
      hourly: Row[];
      notes: string[];
    }>(
      `/api/followers/playlist/${encodeURIComponent(e.state.params.id || "")}`,
      e.params,
    );
  return (
    <>
      <Title>Follower playlist</Title>
      <Status query={q}>
        {(d) => (
          <>
            <Card className="detail-header">
              <h2>{textValue(d.playlist.name)}</h2>
              <p>Account: {textValue(d.playlist.account_name)}</p>
              <Chips value={d.playlist.dashboard_groups} />
              <p className="mono small">
                {textValue(d.playlist.first_reading)} →{" "}
                {textValue(d.playlist.last_reading)}
              </p>
            </Card>
            <Notes notes={[followerNote, ...d.notes]} />
            <TimeSeriesChart
              title="Daily maximum and last reading"
              actions={
                <Method
                  method="UTC daily most-frequent reading (Explorer) vs daily maximum (Grafana) vs last reading"
                  notes={d.notes}
                />
              }
              data={chartPoints(d.series)}
              series={[
                {
                  key: "daily_mode",
                  label: "Daily most-frequent (Explorer)",
                  color: "var(--sb-accent)",
                },
                {
                  key: "daily_max",
                  label: "Daily max (Grafana)",
                  color: "var(--sb-warning)",
                },
                {
                  key: "daily_last",
                  label: "Daily last",
                  color: "var(--sb-info)",
                },
              ]}
              stepDays={
                e.state.grain === "weekly"
                  ? 7
                  : e.state.grain === "monthly"
                    ? 32
                    : 1
              }
            />
            <SeriesCharts
              rows={d.series}
              counter="daily_mode"
              net="daily_change"
              title="Followers (daily most-frequent reading)"
              method="Most frequent reading per UTC day, tie -> higher (Grafana used the daily MAX)"
              notes={d.notes}
            />
            <h2>Daily readings</h2>
            <Rows rows={d.series} label="Follower daily readings" />
            <h2>Raw hourly readings</h2>
            {d.hourly.length ? (
              <Rows rows={d.hourly} label="Follower hourly readings" />
            ) : (
              <Notes
                notes={[
                  "Raw readings are available for ranges of at most 31 UTC dates. If this is already a short range, no readings were collected in it. Narrow the top-bar range to inspect readings.",
                ]}
              />
            )}
          </>
        )}
      </Status>
    </>
  );
}
