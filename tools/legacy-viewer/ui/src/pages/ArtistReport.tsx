import { useCallback, useEffect, useMemo, useState } from "react";
import { serializeState, useUrlState } from "../app/useUrlState";
import { RangeControls } from "../components/RangeControls";
import { Artwork, Combobox, Num, Tooltip } from "../components/ui";
import { DataTable, type Column } from "../components/ui/DataTable";
import { ArtistReportSkeleton } from "../components/ui/Skeletons";
import { exportCSV, getJSON, useQuery } from "../lib/api";
import type { Meta } from "../lib/explorer";
import { monthsBetween } from "../lib/calendar";
import { formatUtcDate } from "../lib/format";
import {
  presetRange,
  readingFlag,
  reportNotes,
  sortReport,
  type ArtistReport,
  type Reading,
  type ReportRow,
  type ReportSortKey,
} from "../lib/lookup";
import { artistOption, type PickerOption } from "../lib/pickers";
import { trackTitle, useDocumentTitle, windowTitle } from "../lib/title";
import { Button, Card, Chip, EmptyState, Status, Title } from "./shared";

function ReadingCell({ reading }: { reading: Reading | null }) {
  const flag = readingFlag(reading);
  if (!reading) return <span className="muted">—</span>;
  return (
    <span className="report-reading">
      <Num value={reading.streams} />
      {flag && (
        <Tooltip text={flag.title}>
          <Chip variant="warning">{flag.label}</Chip>
        </Tooltip>
      )}
    </span>
  );
}

export default function ArtistReportPage() {
  const [state, setState] = useUrlState();
  const artist = state.params.artist || "";
  const dataset = state.dataset === "stats" ? "stats" : "stats2";
  const meta = useQuery<Meta>("/api/meta");
  const datasetMeta = meta.data?.datasets.find((d) => d.key === dataset);
  const bounds = useMemo(
    () =>
      datasetMeta
        ? { from: datasetMeta.first_day, to: datasetMeta.last_day }
        : undefined,
    [datasetMeta],
  );
  const range = useMemo(() => {
    if (!bounds) return undefined;
    const fallback = presetRange("Last 30 days", bounds);
    return {
      from: state.from || fallback.from,
      to: state.to || fallback.to,
    };
  }, [bounds, state.from, state.to]);
  // Canonicalize missing dates (no extra Back step), as Track lookup does.
  useEffect(() => {
    if (!range || (state.from && state.to)) return;
    history.replaceState(null, "", serializeState({ ...state, ...range }));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [state, range]);
  const report = useQuery<ArtistReport>(
    "/api/lookup/artist-report",
    { dataset, artist, from: range?.from, to: range?.to },
    !!artist && !!range,
  );
  useDocumentTitle(
    windowTitle(artist ? trackTitle("Artist report", artist) : "Artist report"),
  );
  const [sort, setSort] = useState<{
    key: ReportSortKey;
    direction: "asc" | "desc";
  }>({ key: "difference", direction: "desc" });
  const rows = useMemo(
    () => (report.data ? sortReport(report.data.rows, sort.key, sort.direction) : []),
    [report.data, sort],
  );
  const months = useMemo(() => (bounds ? monthsBetween(bounds) : []), [bounds]);
  const searchArtist = useCallback(
    async (q: string, signal: AbortSignal) => {
      const data = await getJSON<{
        rows: { name: string; track_count: number; art: string | null }[];
      }>("/api/lookup/artists", { dataset, q }, signal);
      return data.rows.map(artistOption);
    },
    [dataset],
  );
  const artistOptions = useMemo<PickerOption[]>(
    () =>
      artist
        ? [
            artistOption({
              name: artist,
              track_count: report.data?.rows.length ?? 0,
              art: report.data?.art,
            }),
          ]
        : [],
    [artist, report.data],
  );
  const sortProps = (key: ReportSortKey) => ({ key, sortable: true });
  const lookupHref = (row: ReportRow) =>
    serializeState({
      ...state,
      page: "lookup",
      grain: "daily",
      params: { isrc: row.track.isrc, artist },
      from: range?.from ?? "",
      to: range?.to ?? "",
    });
  const columns: Column<ReportRow>[] = [
    {
      ...sortProps("title"),
      label: "Track",
      render: (r) => (
        <span className="cell-art" title={r.track.song_name}>
          <Artwork src={r.track.art} name={r.track.song_name} size={24} inline />
          <a
            className="text-link"
            href={lookupHref(r)}
            title="Open this track in Track lookup with these dates"
            onClick={(event) => event.stopPropagation()}
          >
            {r.track.song_name}
          </a>
          {r.track.artist.includes(",") && (
            <span className="muted small report-credit"> · {r.track.artist}</span>
          )}
        </span>
      ),
    },
    {
      ...sortProps("from"),
      label: range ? `Streams on ${formatUtcDate(range.from)}` : "From",
      numeric: true,
      render: (r) => <ReadingCell reading={r.from} />,
    },
    {
      ...sortProps("to"),
      label: range ? `Streams on ${formatUtcDate(range.to)}` : "To",
      numeric: true,
      render: (r) => <ReadingCell reading={r.to} />,
    },
    {
      ...sortProps("difference"),
      label: "Difference",
      numeric: true,
      render: (r) =>
        r.difference === null ? (
          <span className="muted">—</span>
        ) : (
          <strong>
            <Num value={r.difference} signed />
          </strong>
        ),
    },
    {
      ...sortProps("per_day"),
      label: "Per day",
      numeric: true,
      render: (r) => <Num value={r.per_day} digits={1} />,
    },
    {
      key: "notes",
      label: "Reading notes",
      render: (r) => (
        <span className="row">
          {reportNotes(r).map((n) => (
            <Tooltip key={n.label} text={n.title}>
              <Chip variant="warning">{n.label}</Chip>
            </Tooltip>
          ))}
        </span>
      ),
    },
  ];
  const data = report.data;
  const days = range
    ? Math.round(
        (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000,
      )
    : 0;
  return (
    <div className="report-page">
      <Title description="Every track credited to an artist, compared between the same two UTC readings as Track lookup.">
        Artist report
      </Title>
      <div className="report-controls">
        <div className="report-artist">
          <span className="lookup-field-label">Artist</span>
          <Combobox
            label="Artist"
            value={artist || null}
            options={artistOptions}
            search={searchArtist}
            onChange={(value) =>
              setState({ params: { artist: value }, from: state.from, to: state.to })
            }
          />
          <a
            className="text-link small"
            href={serializeState({
              ...state,
              page: "lookup",
              grain: "daily",
              params: { artist },
              from: "",
              to: "",
            })}
          >
            Back to Track lookup
          </a>
        </div>
        <Card className="report-range">
          {bounds && range ? (
            <RangeControls
              range={range}
              bounds={bounds}
              months={months}
              onRange={(next) => setState(next)}
              presetTitle="Ends at the dataset’s last archived day"
            />
          ) : (
            <span className="muted small">Loading dates…</span>
          )}
          <p className="muted small lookup-definition">
            Difference = To reading − From reading for each track. From-day streams
            are excluded. Calendar dates are those of the whole dataset
            {bounds
              ? ` (${formatUtcDate(bounds.from)} – ${formatUtcDate(bounds.to)})`
              : ""}
            ; a track tracked for less time uses its own first/last reading.
          </p>
        </Card>
      </div>
      {!artist ? (
        <EmptyState
          title="Choose an artist"
          description="Pick an artist to list every track credited to them. You can also open this report from Track lookup."
        />
      ) : (
        <Status query={report} skeleton={<ArtistReportSkeleton />}>
          {() => (
            <>
              <div className="report-summary" aria-live="polite">
                <Card>
                  <span className="muted small">
                    Total difference · {formatUtcDate(range?.from ?? "")} →{" "}
                    {formatUtcDate(range?.to ?? "")}
                  </span>
                  <strong className="mono report-total" data-testid="report-total">
                    {data?.total === null || data?.total === undefined ? (
                      "—"
                    ) : (
                      <Num value={data.total} signed />
                    )}
                  </strong>
                  <span className="muted small">
                    streams · {days} {days === 1 ? "day" : "days"}
                  </span>
                </Card>
                <Card>
                  <span className="muted small">Tracks counted</span>
                  <strong className="mono report-total">
                    <Num value={data?.counted_tracks} />
                  </strong>
                  <span className="muted small">
                    of <Num value={data?.rows.length} /> credited
                    {data && data.excluded_tracks > 0
                      ? ` · ${data.excluded_tracks} without a reading in range`
                      : ""}
                  </span>
                </Card>
                <Card>
                  <span className="muted small">Export</span>
                  <Button
                    disabled={!data || !range}
                    onClick={() =>
                      exportCSV({
                        dataset,
                        artist,
                        from: range?.from,
                        to: range?.to,
                        view: "artist_report",
                      })
                    }
                  >
                    Report CSV
                  </Button>
                  <span className="muted small">Every column below, one row per track</span>
                </Card>
              </div>
              <DataTable
                label={`${artist}: every track`}
                dense
                nowrap
                rows={rows}
                rowKey={(r) => r.track.isrc}
                columns={columns}
                sort={sort}
                onSort={(next) =>
                  setSort({
                    key: next.key as ReportSortKey,
                    direction: next.direction,
                  })
                }
                emptyMessage="This artist has no tracks in this dataset."
                footerRow={
                  <tr className="report-total-row">
                    <td>
                      Total · {data?.counted_tracks} {data?.counted_tracks === 1 ? "track" : "tracks"}
                    </td>
                    <td />
                    <td />
                    <td className="numeric mono" data-testid="report-total-row">
                      {data?.total === null || data?.total === undefined ? (
                        "—"
                      ) : (
                        <Num value={data.total} signed />
                      )}
                    </td>
                    <td />
                    <td />
                  </tr>
                }
              />
              <p className="muted small report-note">
                Collaboration tracks count fully for each credited artist, so
                totals for different artists can overlap. A reading that was
                substituted (no reading that day, or before tracking began) is
                included as the substituted reading and flagged in its row.
                Tracks with no reading in the range show “—” and are left out of
                the total, never counted as zero.
              </p>
            </>
          )}
        </Status>
      )}
    </div>
  );
}
