import { useCallback } from "react";
import { getJSON, useQuery } from "../lib/api";
import {
  numberValue,
  scopeOptions,
  type Paged,
  type Row,
} from "../lib/explorer";
import { Combobox, CopyableText } from "../components/ui";
import { artistOption, rankOptions, type PickerOption } from "../lib/pickers";
import { DataTable, type Column } from "../components/ui/DataTable";
import {
  Button,
  Chips,
  col,
  FilterBar,
  Search,
  Select,
  Title,
  TrackCell,
  useExplorer,
} from "./shared";
export const trackColumns: Column<Row>[] = [
  {
    key: "song_name",
    label: "Track",
    sortable: true,
    render: (r) => <TrackCell row={r} />,
  },
  col("artist", "Artist", false, true),
  {
    key: "isrc",
    label: "ISRC",
    sortable: true,
    render: (r) => (
      <span onClick={(e) => e.stopPropagation()}>
        <CopyableText text={String(r.isrc)} label="ISRC" />
      </span>
    ),
  },
  {
    key: "playlists",
    label: "Playlists",
    render: (r) => <Chips value={r.playlists} max={1} />,
  },
  col("first_day", "First seen", false, true),
  col("last_day", "Last seen", false, true),
  col("latest_streams", "Latest streams", true, true),
  {
    ...col("gained", "Gained in range", true, true),
    render: (r) => (
      <>
        {col("gained", "", true).render(r)}{" "}
        {r.started_in_range === true && (
          <span
            className="small muted"
            title="No counter baseline exists before this range; gained starts at its first observed value."
          >
            started in range
          </span>
        )}
      </>
    ),
  },
  col("avg_daily", "Avg/day", true, true),
  col("resets", "Resets", true, true),
  {
    key: "ids_disagree_days",
    label: "Linked IDs",
    sortable: true,
    render: (r) =>
      numberValue(r.ids_disagree_days) ? (
        <span className="chip chip-warning">
          {String(r.ids_disagree_days)} disagreement days
        </span>
      ) : (
        "—"
      ),
  },
];
export default function TracksPage() {
  const e = useExplorer(),
    offset = Math.max(0, Number(e.state.params.offset) || 0),
    query = useQuery<Paged>("/api/explorer/tracks", {
      ...e.params,
      limit: 50,
      offset,
    }),
    paramsJSON = JSON.stringify(e.params);
  const search = useCallback(
    async (q: string, signal: AbortSignal) => {
      const data = await getJSON<Paged>(
        "/api/artists",
        {
          ...JSON.parse(paramsJSON),
          scope: "all",
          playlist: undefined,
          artist: undefined,
          sort: "artist",
          dir: "asc",
          q,
          limit: 500,
          offset: 0,
        },
        signal,
      );
      // Prefix matches first (the API only knows "contains"), then cap the list.
      const options: PickerOption[] = data.rows.map((r) => ({
        ...artistOption({
          name: String(r.artist),
          track_count: Number(r.tracks ?? 0),
          art: r.art as string | null,
        }),
      }));
      return [
        { value: "", label: "All artists", keep: true },
        ...rankOptions(options, q, false).slice(0, 100),
      ];
    },
    [paramsJSON],
  );
  return (
    <>
      <Title description="Search song, artist, ISRC, or Spotify ID. Counters are reconciled by stable ISRC.">
        Tracks
      </Title>
      <FilterBar>
        <Search
          value={e.state.params.q || ""}
          onChange={(q) => e.filter({ q })}
          label="Search song / artist / ISRC / Spotify ID"
        />
        <Combobox
          label="Artist"
          value={e.state.params.artist || null}
          search={search}
          options={
            e.state.params.artist
              ? [{ value: e.state.params.artist, label: e.state.params.artist }]
              : []
          }
          onChange={(artist) => e.filter({ artist })}
        />
        <label className="row">
          Playlist
          <Select
            value={e.state.params.scope || "all"}
            onChange={(ev) => e.filter({ scope: ev.target.value })}
          >
            {scopeOptions(e.meta.data)
              .filter((s) => s.key === "all" || s.playlist_ids.length === 1)
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
          </Select>
        </label>
        <Button onClick={() => e.setState({ params: {} })}>
          Clear filters
        </Button>
      </FilterBar>
      <DataTable
        nowrap
        label="Tracks"
        rows={query.data?.rows || []}
        columns={trackColumns}
        rowKey={(r) => String(r.isrc)}
        loading={query.loading}
        error={query.error?.message}
        retry={() => void query.refetch()}
        emptyMessage="No track observations match these dates and filters; collection may have stopped or this track was not collected in this range."
        sort={{
          key: e.state.params.sort || "latest_streams",
          direction: e.state.params.dir === "asc" ? "asc" : "desc",
        }}
        onSort={(s) => e.filter({ sort: s.key, dir: s.direction })}
        pagination={{
          page: Math.floor(offset / 50),
          pageSize: 50,
          total: query.data?.total || 0,
          onPageChange: (p) =>
            e.setState({
              params: { ...e.state.params, offset: String(p * 50) },
            }),
        }}
        onRowClick={(r) => e.go("track", { isrc: String(r.isrc) })}
      />
    </>
  );
}
