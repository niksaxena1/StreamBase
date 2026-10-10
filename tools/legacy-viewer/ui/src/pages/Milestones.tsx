import { useQuery } from "../lib/api";
import { numberValue, textValue, type Paged, type Row } from "../lib/explorer";
import { BarChart, TimeSeriesChart } from "../components/charts";
import { DataTable } from "../components/ui/DataTable";
import {
  col,
  FilterBar,
  Method,
  Notes,
  Search,
  Select,
  Status,
  Title,
  useExplorer,
} from "./shared";
type Milestones = Paged & {
  summary: { ladder: Row[]; per_day: Row[] };
  notes: string[];
};
export default function MilestonesPage() {
  const e = useExplorer(),
    offset = Math.max(0, Number(e.state.params.offset) || 0),
    q = useQuery<Milestones>("/api/milestones", {
      ...e.params,
      limit: 50,
      offset,
    }),
    levels = useQuery<Milestones>("/api/milestones", {
      ...e.params,
      milestone: undefined,
      q: undefined,
      limit: 1,
      offset: 0,
    });
  return (
    <>
      <Title>Milestones</Title>
      <FilterBar>
        <label className="row">
          <input
            type="checkbox"
            checked={e.state.params.exclude_lofi === "1"}
            onChange={(ev) =>
              e.filter({ exclude_lofi: ev.target.checked ? "1" : "0" })
            }
          />
          Without lofi
        </label>
        <label className="row">
          Level
          <Select
            value={e.state.params.milestone || ""}
            onChange={(ev) => e.filter({ milestone: ev.target.value })}
          >
            <option value="">All levels</option>
            {levels.data?.summary.ladder.map((r) => (
              <option key={String(r.milestone)}>
                {textValue(r.milestone)}
              </option>
            ))}
          </Select>
        </label>
        <Search
          label="Search track or artist"
          value={e.state.params.q || ""}
          onChange={(q) => e.filter({ q })}
        />
      </FilterBar>
      <Status query={q}>
        {(d) => (
          <>
            <Notes notes={d.notes} />
            <BarChart
              title="Milestone ladder"
              description="Distinct artist–song pairs reaching each level, ordered numerically."
              actions={
                <Method
                  method="Distinct (song, artist) per recorded milestone"
                  notes={d.notes}
                />
              }
              data={d.summary.ladder.map((r) => ({
                name: textValue(r.milestone),
                value: numberValue(r.tracks),
              }))}
            />
            <TimeSeriesChart
              title="Milestones per UTC day"
              data={d.summary.per_day.map((r) => ({
                date: String(r.day),
                count: numberValue(r.count),
              }))}
              series={[
                { key: "count", label: "Recorded milestones", type: "bar" },
              ]}
              actions={
                <Method method="Count original milestone records by UTC date; unrecorded dates remain missing" />
              }
            />
          </>
        )}
      </Status>
      <DataTable
        label="Milestones"
        rows={q.data?.rows || []}
        columns={[
          col("created_at", "Date (UTC)", false, true),
          {
            key: "song_name",
            label: "Artist – track",
            sortable: true,
            render: (r) => `${textValue(r.artist)} – ${textValue(r.song_name)}`,
          },
          col("milestone", "Milestone", false, true),
          col("play_count", "Play count", true, true),
          col("is_latest_for_track", "Latest for track"),
        ]}
        rowKey={(r) => String(r.id)}
        loading={q.loading}
        error={q.error?.message}
        retry={() => void q.refetch()}
        sort={{
          key: e.state.params.sort || "created_at",
          direction: e.state.params.dir === "asc" ? "asc" : "desc",
        }}
        onSort={(s) => e.filter({ sort: s.key, dir: s.direction })}
        pagination={{
          page: offset / 50,
          pageSize: 50,
          total: q.data?.total || 0,
          onPageChange: (p) =>
            e.setState({
              params: { ...e.state.params, offset: String(p * 50) },
            }),
        }}
      />
    </>
  );
}
