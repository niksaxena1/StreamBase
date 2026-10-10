import { useEffect, useState, type ReactNode } from "react";
import { serializeState, useUrlState } from "../app/useUrlState";
import { useQuery } from "../lib/api";
import {
  bucketLabel,
  chartPoints,
  gapBands,
  numberValue,
  queryParams,
  readableNote,
  scopeOptions,
  strings,
  textValue,
  type Meta,
  type Row,
  type SeriesRow,
} from "../lib/explorer";
import {
  Artwork,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  Num,
  Select,
  StatCard,
  Tooltip,
} from "../components/ui";
import { DAILY_BAR_COLOR, MA_LABEL } from "../components/charts/data";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TimeSeriesChart } from "../components/charts";
export function useExplorer() {
  const [state, setState] = useUrlState();
  return {
    state,
    setState,
    params: queryParams(state),
    meta: useQuery<Meta>("/api/meta"),
    filter: (patch: Record<string, string>) =>
      setState({ params: { ...state.params, ...patch, offset: "0" } }),
    go: (page: string, params: Record<string, string>) =>
      setState({ page, params }),
  };
}
export function Title({
  children,
  description,
}: {
  children: ReactNode;
  description?: string;
}) {
  return (
    <header className="page-header">
      <h1>{children}</h1>
      {description && <p className="muted">{description}</p>}
    </header>
  );
}
export function Method({
  method,
  notes = [],
}: {
  method: string;
  notes?: string[];
}) {
  return (
    <Tooltip
      text={readableNote(
        `${method}. ${notes.join(" ")} Weekly/monthly counters use the last known value; deltas sum known days. Missing values remain gaps. The 7-day avg (MA7) uses the preceding seven UTC dates and needs at least four known daily values; it is only available at daily grain.`,
      )}
    >
      <Chip variant="info">Method</Chip>
    </Tooltip>
  );
}
export function Status<T>({
  query,
  children,
  skeleton,
}: {
  /** Content-shaped placeholder shown while loading (defaults to a generic card). */
  skeleton?: ReactNode;
  query: {
    data?: T;
    loading: boolean;
    error?: Error;
    refetch: () => Promise<void>;
  };
  children: (data: T) => ReactNode;
}) {
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        retry={() => void query.refetch()}
      />
    );
  if (query.loading || !query.data)
    return skeleton ? (
      <>{skeleton}</>
    ) : (
      <Card>
        <LoadingState message="Reading archive…" />
        <div className="explorer-skeleton" />
      </Card>
    );
  return <>{children(query.data)}</>;
}
export function Chips({
  value,
  max = Infinity,
}: {
  value: unknown;
  max?: number;
}) {
  const values = strings(value);
  return (
    <span className="row">
      {values.slice(0, max).map((v) => (
        <Chip key={v}>{v}</Chip>
      ))}
      {values.length > max && (
        <Tooltip text={values.slice(max).join(", ")}>
          <Chip>+{values.length - max}</Chip>
        </Tooltip>
      )}
    </span>
  );
}
export function TrackLink({ row }: { row: Row }) {
  const [state] = useUrlState();
  return (
    <a
      className="text-link"
      href={serializeState({
        ...state,
        page: "track",
        params: { isrc: textValue(row.isrc) },
      })}
    >
      {textValue(row.song_name)}
    </a>
  );
}
/** Track name link with its cover (square, click to enlarge) or an initials tile. */
export function TrackCell({ row }: { row: Row }) {
  return (
    <span className="cell-art" title={textValue(row.song_name)}>
      <Artwork
        src={row.art as string | null | undefined}
        name={textValue(row.song_name)}
        size={24}
        inline
      />
      <TrackLink row={row} />
    </span>
  );
}
/** Artist name with the round artist photo. */
export function ArtistCell({ name, art }: { name: string; art?: unknown }) {
  return (
    <span className="cell-art">
      <Artwork src={art as string | null | undefined} name={name} shape="round" size={24} inline />
      <span>{name}</span>
    </span>
  );
}
export function col(
  key: string,
  label: string,
  numeric = false,
  sortable = false,
): Column<Row> {
  return {
    key,
    label: readableNote(label),
    numeric,
    sortable,
    render: (r) =>
      numeric ? (
        <Num value={numberValue(r[key])} digits={key === "avg_daily" ? 1 : 0} />
      ) : (
        textValue(r[key])
      ),
  };
}
export function Rows({
  rows,
  label,
  columns,
  onRowClick,
  nowrap = false,
}: {
  rows: Row[];
  label: string;
  columns?: Column<Row>[];
  onRowClick?: (row: Row) => void;
  /** One line per row: for track/artist lists made of short values. */
  nowrap?: boolean;
}) {
  return (
    <DataTable
      dense
      nowrap={nowrap}
      label={label}
      rows={rows}
      columns={
        columns ??
        [...new Set(rows.flatMap(Object.keys))].map((k) => ({
          ...col(k, k.replaceAll("_", " ")),
          render: (r: Row) => textValue(r[k]),
        }))
      }
      rowKey={(r) =>
        r.id != null
          ? String(r.id)
          : [
              r.isrc,
              r.playlist_id,
              r.day,
              r.bucket,
              r.artist,
              r.account,
              r.user_id,
              r.relative_path,
            ]
              .filter((v) => v != null)
              .join("|") || JSON.stringify(r)
      }
      onRowClick={onRowClick}
      emptyMessage="No observations match this range and these filters. Try a wider range or clear filters."
    />
  );
}
export function Search({
  value,
  onChange,
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 250);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);
  return (
    <input
      className="select explorer-search"
      type="search"
      aria-label={label}
      placeholder={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}
export function Scope({ label = "Scope" }: { label?: string }) {
  const e = useExplorer();
  return (
    <label className="row">
      {label}
      <Select
        value={e.state.params.scope || "all"}
        onChange={(ev) => e.filter({ scope: ev.target.value })}
      >
        {scopeOptions(e.meta.data).map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
export function Metrics({
  items,
}: {
  items: { label: string; value: unknown; sublabel?: ReactNode }[];
}) {
  return (
    <div className="explorer-stats">
      {items.map((i) => (
        <StatCard
          key={i.label}
          label={i.label}
          value={typeof i.value === "string" ? i.value : numberValue(i.value)}
          sublabel={i.sublabel}
        />
      ))}
    </div>
  );
}
export function SeriesCharts({
  rows,
  counter = "streams",
  net = "net",
  method,
  notes = [],
  title = "Cumulative streams",
}: {
  rows: SeriesRow[];
  counter?: string;
  net?: string;
  method: string;
  notes?: string[];
  title?: string;
}) {
  const { state } = useExplorer(),
    points = chartPoints(rows),
    gaps = state.grain === "daily" ? gapBands(rows, counter) : [],
    events = rows
      .filter(
        (r) =>
          r.has_reset ||
          (numberValue(r.resets) !== null && Number(r.resets) > 0),
      )
      .map((r) => ({
        date: r.bucket,
        text: `Counter reset · ${bucketLabel(r.bucket, state.grain)}`,
      }));
  const action = <Method method={method} notes={notes} />;
  const empty = !rows.some((r) => r[counter] != null);
  return (
    <>
      {empty && (
        <EmptyState
          title="No observations in the selected range"
          description={`Collection gap ${state.from || rows[0]?.bucket || "selected start"} → ${state.to || rows.at(-1)?.bucket || "selected end"}. Widen the range to see earlier or later observations.`}
        />
      )}
      <TimeSeriesChart
        title={title}
        description={
          method.includes("hourly")
            ? "Playlist total (sum of member tracks' daily modes)"
            : undefined
        }
        actions={action}
        data={points}
        series={[
          {
            key: counter,
            label: title,
            type: "area",
            color: "var(--sb-accent)",
          },
        ]}
        gaps={gaps}
        events={events}
        stepDays={
          state.grain === "weekly" ? 7 : state.grain === "monthly" ? 32 : 1
        }
        extraFields={[
          { key: "observations", label: "Observations" },
          { key: "min_confidence", label: "Minimum confidence" },
          { key: "days_missing", label: "Days without a usable delta" },
        ]}
      />
      <TimeSeriesChart
        title={
          net === "daily_change"
            ? "Daily change (previous observed row)"
            : "Daily net"
        }
        description={
          state.grain !== "daily"
            ? "Known daily changes summed within each bucket; the 7-day avg is available at daily grain."
            : "7-day avg from the API; gap-spanning Explorer deltas and resets remain missing."
        }
        actions={action}
        data={points}
        series={[
          {
            key: net,
            label: state.grain === "daily" ? "Daily change" : "Bucket change",
            type: "bar",
            color: DAILY_BAR_COLOR,
          },
          { key: "ma7", label: MA_LABEL, color: "var(--sb-text)", dashed: true },
        ]}
        events={events}
        stepDays={
          state.grain === "weekly" ? 7 : state.grain === "monthly" ? 32 : 1
        }
      />
    </>
  );
}
export function Notes({ notes }: { notes: string[] }) {
  return (
    <Card className="explorer-notes">
      {notes.map((n) => (
        <p key={n}>{readableNote(n)}</p>
      ))}
    </Card>
  );
}
export { Button, Card, Chip, EmptyState, FilterBar, Select };
