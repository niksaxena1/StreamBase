import { useQuery } from "../lib/api";
import type { Paged } from "../lib/explorer";
import { DataTable } from "../components/ui/DataTable";
import {
  ArtistCell,
  col,
  FilterBar,
  Notes,
  Search,
  Title,
  useExplorer,
} from "./shared";
export const artistNote =
  "Artist totals sum member tracks. Collaboration tracks count for every credited artist, so summing artists can count the same track more than once.";
export default function ArtistsPage() {
  const e = useExplorer(),
    offset = Math.max(0, Number(e.state.params.offset) || 0),
    q = useQuery<Paged>("/api/artists", { ...e.params, limit: 50, offset });
  return (
    <>
      <Title>Artists</Title>
      <Notes notes={[artistNote]} />
      <FilterBar>
        <Search
          label="Search artists"
          value={e.state.params.q || ""}
          onChange={(q) => e.filter({ q })}
        />
      </FilterBar>
      <DataTable
        nowrap
        label="Artists"
        rows={q.data?.rows || []}
        columns={[
          {
            ...col("artist", "Artist", false, true),
            render: (r) => (
              <ArtistCell name={String(r.artist)} art={r.art} />
            ),
          },
          col("tracks", "Tracks", true, true),
          col("latest_streams", "Latest streams", true, true),
          col("gained", "Gained", true, true),
        ]}
        rowKey={(r) => String(r.artist)}
        loading={q.loading}
        error={q.error?.message}
        retry={() => void q.refetch()}
        sort={{
          key: e.state.params.sort || "latest_streams",
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
        onRowClick={(r) => e.go("artist", { name: String(r.artist) })}
      />
    </>
  );
}
