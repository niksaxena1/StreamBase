import { useQuery } from "../lib/api";
import {
  type Overview,
  type Paged,
  type Row,
  textValue,
} from "../lib/explorer";
import { Tabs } from "../components/ui";
import { RawBrowser } from '../components/original/RawBrowser';
import { DataTable } from "../components/ui/DataTable";
import {
  col,
  FilterBar,
  Metrics,
  Notes,
  Rows,
  Search,
  Select,
  SeriesCharts,
  Status,
  Title,
  useExplorer,
} from "./shared";
export const followerNote =
  "This archive ends on 2026-09-01. The live follower collector still runs on the old server; these are preserved readings, not live counts.";
export default function FollowersPage() {
  const e = useExplorer(),
    offset = Math.max(0, Number(e.state.params.offset) || 0),
    overview = useQuery<Overview>("/api/followers/overview", e.params),
    playlists = useQuery<Paged>("/api/followers/playlists", {
      ...e.params,
      limit: 50,
      offset,
    }),
    accounts = useQuery<{ rows: Row[] }>("/api/followers/accounts", e.params),
    options = useQuery<{ rows: Row[] }>("/api/followers/accounts", {
      dataset: "stats2",
    });
  return (
    <>
      <Title>Followers</Title>
      <Notes notes={[followerNote]} />
      <FilterBar>
        <label className="row">
          Group
          <Select
            value={e.state.params.group || ""}
            onChange={(ev) => e.filter({ group: ev.target.value })}
          >
            <option value="">All groups</option>
            {e.meta.data?.followers.groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </label>
        <label className="row">
          Account
          <Select
            value={e.state.params.account || ""}
            onChange={(ev) => e.filter({ account: ev.target.value })}
          >
            <option value="">All accounts</option>
            {[
              ...new Set(
                options.data?.rows
                  .map((r) => r.account)
                  .filter((a): a is string => typeof a === "string"),
              ),
            ]
              .sort()
              .map((a) => (
                <option key={a}>{a}</option>
              ))}
          </Select>
        </label>
        <Search
          label="Search playlists"
          value={e.state.params.q || ""}
          onChange={(q) => e.filter({ q })}
        />
      </FilterBar>
      <Status query={overview}>
        {(d) => (
          <>
            <Metrics
              items={[
                { label: "Playlists", value: d.kpis.playlists },
                { label: "Accounts", value: d.kpis.accounts },
                {
                  label: "Total followers latest",
                  value: d.kpis.total_latest,
                  sublabel: "Latest per-playlist values; dates may differ",
                },
                { label: "Change in range", value: d.kpis.change_in_range },
                {
                  label: "Zero-follower playlists",
                  value: d.kpis.zero_follower_playlists,
                },
              ]}
            />
            <SeriesCharts
              rows={d.series}
              counter="total_followers"
              net="daily_change"
              title="Total followers"
              method={d.method}
              notes={d.notes}
            />
          </>
        )}
      </Status>
      <Tabs
        label="Follower tables"
        value={e.state.params.tab || "playlists"}
        onChange={(tab) => e.filter({ tab })}
        items={[
          { value: 'raw', label: 'Raw readings', content: e.state.params.tab === 'raw' ? <RawBrowser followers /> : null },
          {
            value: "playlists",
            label: "Playlists",
            content: (
              <DataTable
                label="Follower playlists"
                rows={playlists.data?.rows || []}
                columns={[
                  col("name", "Playlist", false, true),
                  col("account", "Account", false, true),
                  {
                    key: "groups",
                    label: "Groups",
                    render: (r) => textValue(r.groups),
                  },
                  col("latest_followers", "Latest", true, true),
                  col("change", "Change", true, true),
                  col("first_reading", "First reading (UTC)", false, true),
                  col("last_reading", "Last reading (UTC)", false, true),
                  col("range_readings", "Readings in range", true),
                ]}
                rowKey={(r) => String(r.playlist_id)}
                loading={playlists.loading}
                error={playlists.error?.message}
                retry={() => void playlists.refetch()}
                sort={{
                  key: e.state.params.sort || "latest_followers",
                  direction: e.state.params.dir === "asc" ? "asc" : "desc",
                }}
                onSort={(s) => e.filter({ sort: s.key, dir: s.direction })}
                pagination={{
                  page: offset / 50,
                  pageSize: 50,
                  total: playlists.data?.total || 0,
                  onPageChange: (p) =>
                    e.setState({
                      params: { ...e.state.params, offset: String(p * 50) },
                    }),
                }}
                onRowClick={(r) =>
                  e.go("follower-playlist", { id: String(r.playlist_id) })
                }
              />
            ),
          },
          {
            value: "accounts",
            label: "Accounts",
            content: (
              <Status query={accounts}>
                {(d) => (
                  <Rows
                    label="Follower accounts"
                    rows={d.rows}
                    columns={[
                      col("account", "Account"),
                      col("user_id", "User ID"),
                      col("playlists", "Playlists", true),
                      col("total_latest_followers", "Total", true),
                      col("change", "Change", true),
                    ]}
                  />
                )}
              </Status>
            ),
          },
        ]}
      />
    </>
  );
}
