import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { serializeState, useUrlState } from "../app/useUrlState";
import {
  AnimatedNumber,
  Artwork,
  Combobox,
  ErrorState,
  Num,
  Tooltip,
} from "../components/ui";
import { LookupSkeleton } from "../components/ui/Skeletons";
import { RangeControls } from "../components/RangeControls";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import { StickyTrackBar, useScrolledPast } from "../components/StickyTrackBar";
import { stepRange } from "../lib/calendar";
import { shortcutAction } from "../lib/shortcuts";
import { trackTitle, useDocumentTitle, windowTitle } from "../lib/title";
import { DataTable, type Column } from "../components/ui/DataTable";
import { MonthlyBars, Sparkline, TimeSeriesChart } from "../components/charts";
import { DAILY_BAR_COLOR } from "../components/charts/data";
import { artistOption, buildTrackOptions, type PickerOption } from "../lib/pickers";
import { exportCSV, getJSON, useQuery } from "../lib/api";
import type { Paged } from "../lib/explorer";
import {
  displaySigned,
  formatUtcDate,
  monthLabel,
} from "../lib/format";
import {
  clampRange,
  copyResult,
  lookupWarnings,
  monthBars,
  monthFlags,
  monthRange,
  MONTH_DEFINITION,
  ownMilestones,
  pickPoint,
  presetRange,
  readRecent,
  saveLast,
  saveRecent,
  selectPoints,
  signed,
  sparklineSeries,
  switchLines,
  switchWarnings,
  type Between,
  type DaysResponse,
  type LookupMonth,
  type LookupTrack,
  type Monthly,
  type Range,
} from "../lib/lookup";
import { Button, Card, Chip, EmptyState, Status, Title } from "./shared";

type Artists = {
  rows: {
    name: string;
    track_count: number;
    latest_total: number;
    art: string | null;
  }[];
};

export default function LookupPage() {
  const [state, setState] = useUrlState();
  const isrc = state.params.isrc || "";
  const monthly = useQuery<Monthly>(
    "/api/lookup/monthly",
    { dataset: state.dataset, isrc },
    !!isrc,
  );
  const artist =
    state.params.artist ||
    monthly.data?.track.artist.split(",")[0].trim() ||
    "";
  const tracks = useQuery<{ rows: LookupTrack[] }>(
    "/api/lookup/tracks",
    { dataset: state.dataset, artist },
    !!artist,
  );
  const artistInfo = useQuery<Artists>(
    "/api/lookup/artists",
    { dataset: state.dataset, q: artist },
    !!artist,
  );
  const artistOptions = useMemo<PickerOption[]>(() => {
    if (!artist) return [];
    const known = artistInfo.data?.rows.find((a) => a.name === artist);
    return [
      artistOption(
        known ?? {
          name: artist,
          track_count: tracks.data?.rows.length ?? 0,
          art: monthly.data?.track.artists?.find((a) => a.name === artist)?.art,
        },
      ),
    ];
  }, [artist, artistInfo.data, tracks.data, monthly.data]);
  const trackOptions = useMemo<PickerOption[]>(
    () =>
      tracks.data
        ? buildTrackOptions(tracks.data.rows)
        : monthly.data
          ? buildTrackOptions([monthly.data.track])
          : [],
    [tracks.data, monthly.data],
  );
  const [recent, setRecent] = useState(readRecent);
  const searchArtist = useCallback(
    async (q: string, signal: AbortSignal) => {
      const data = await getJSON<Artists>(
        "/api/lookup/artists",
        { dataset: state.dataset, q },
        signal,
      );
      return data.rows.map(artistOption);
    },
    [state.dataset],
  );
  const searchQuick = useCallback(
    async (raw: string, signal: AbortSignal) => {
      const pasted = raw.trim();
      if (!pasted) return [];
      const spotify = pasted.match(
        /(?:spotify:track:|\/track\/)([A-Za-z0-9]{22})/,
      );
      const parts = pasted.split(/\s+[–—-]\s+/);
      const q = spotify?.[1] || (parts.length === 2 ? parts[1] : pasted);
      const data = await getJSON<Paged>(
        "/api/tracks",
        { dataset: state.dataset, q, limit: 100 },
        signal,
      );
      const normalize = (s: string) =>
        s
          .normalize("NFKD")
          .replace(/\p{M}/gu, "")
          .toLowerCase()
          .replace(/ø/g, "o");
      return data.rows
        .filter(
          (t) =>
            parts.length !== 2 ||
            normalize(String(t.artist)).includes(normalize(parts[0])),
        )
        .map(
          (t): PickerOption => ({
            value: String(t.isrc),
            label: `${t.artist} – ${t.song_name}`,
            thumb: {
              src: t.art as string | null,
              name: String(t.song_name),
              shape: "square",
            },
            primary: String(t.song_name),
            secondary: String(t.artist),
            trailing: String(t.isrc),
          }),
        );
    },
    [state.dataset],
  );
  const selectTrack = (selected: string) =>
    setState({
      params: {
        isrc: selected,
        ...(state.params.artist ? { artist: state.params.artist } : {}),
      },
      from: "",
      to: "",
    });
  useEffect(() => {
    if (
      !monthly.data?.track ||
      monthly.data.empty ||
      state.dataset === "followers"
    )
      return;
    setRecent(saveRecent({ ...monthly.data.track, dataset: state.dataset }));
  }, [monthly.data, state.dataset]);
  useDocumentTitle(
    monthly.data?.track && isrc
      ? windowTitle(
          trackTitle(monthly.data.track.song_name, monthly.data.track.artist),
        )
      : windowTitle("Track lookup"),
  );
  // ---- keyboard: "/" artist picker, "t" track picker, "?" help (C and [ ] live with the result) ----
  const artistInput = useRef<HTMLInputElement>(null);
  const trackInput = useRef<HTMLInputElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutAction(event, !!document.querySelector("dialog[open]"));
      if (action === "focus-artist") {
        event.preventDefault();
        artistInput.current?.focus();
      } else if (action === "focus-track") {
        event.preventDefault();
        trackInput.current?.focus();
      } else if (action === "help") {
        event.preventDefault();
        setHelpOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="lookup-page">
      <div className="lookup-title">
        <Title description="Pick a track. Compare two UTC readings. Get the difference.">
          Track lookup
        </Title>
        <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
      <div className="lookup-selectors">
        <div>
          <span className="lookup-field-label">Artist</span>
          <Combobox
            label="Artist"
            inputRef={artistInput}
            value={artist || null}
            options={artistOptions}
            search={searchArtist}
            onChange={(value) =>
              setState({ params: { artist: value }, from: "", to: "" })
            }
          />
          {artist && (
            <a
              className="text-link small"
              data-testid="artist-report-link"
              href={serializeState({
                ...state,
                page: "artist-report",
                grain: "daily",
                params: { artist },
              })}
            >
              All tracks for this artist
            </a>
          )}
        </div>
        <div>
          <span className="lookup-field-label">Track</span>
          <Combobox
            key={`${state.dataset}:${artist}`}
            label="Track"
            inputRef={trackInput}
            value={isrc || null}
            disabled={!artist}
            loading={tracks.loading}
            options={trackOptions}
            onChange={selectTrack}
          />
          {tracks.error && <p role="alert">{tracks.error.message}</p>}
        </div>
        <div>
          <span className="lookup-field-label">Quick find</span>
          <Combobox
            label="Quick find"
            value={null}
            ranking="server"
            search={searchQuick}
            onChange={(value) =>
              setState({ params: { isrc: value }, from: "", to: "" })
            }
          />
          <span className="small muted">
            Paste ISRC, Spotify ID, or artist – track
          </span>
        </div>
      </div>
      {!!recent.length && (
        <div className="lookup-recents row">
          <span className="muted small">Recent tracks</span>
          {recent.map((t) => (
            <Button
              key={`${t.dataset}:${t.isrc}`}
              className="recent-track"
              title={`${t.artist} – ${t.song_name} (${t.dataset})`}
              onClick={() =>
                setState({
                  dataset: t.dataset,
                  params: { isrc: t.isrc },
                  from: "",
                  to: "",
                })
              }
            >
              {t.song_name}
              <span className="muted small">
                {" "}
                · {t.artist}
                {t.dataset === "stats" ? " · stats" : ""}
              </span>
            </Button>
          ))}
        </div>
      )}
      {!isrc ? (
        <EmptyState
          title="Choose an artist, then a track"
          description="Compare cumulative streams on any two dates. The calculator does the subtraction for you. Press Ctrl+K to jump to any track."
        />
      ) : (
        <Status query={monthly} skeleton={<LookupSkeleton />}>
          {(data) =>
            data.empty ? (
              <EmptyState
                title="No readings for this track"
                description="This track has no data in the selected dataset. Try the complete stats2 archive."
              />
            ) : (
              <LookupResult key={`${state.dataset}:${isrc}`} data={data} />
            )
          }
        </Status>
      )}
    </div>
  );
}

function IsrcChip({ isrc }: { isrc: string }) {
  const [status, setStatus] = useState("");
  return (
    <span className="isrc-chip">
      <span className="muted small">ISRC</span>
      <code>{isrc}</code>
      <button
        type="button"
        className="isrc-copy"
        aria-label="Copy ISRC"
        title="Copy ISRC"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(isrc);
            setStatus("Copied");
          } catch {
            setStatus("Copy unavailable");
          }
          setTimeout(() => setStatus(""), 2000);
        }}
      >
        ⧉
      </button>
      <span role="status" className="small isrc-status">
        {status}
      </span>
    </span>
  );
}

function TrackHero({
  data,
  spark,
  heroRef,
}: {
  data: Monthly;
  spark: (number | null)[];
  heroRef: RefObject<HTMLDivElement | null>;
}) {
  const [state] = useUrlState();
  const { track } = data;
  const credits =
    track.artists ??
    track.artist
      .split(",")
      .map((name) => ({ name: name.trim(), art: null }))
      .filter((a) => a.name);
  return (
    <div ref={heroRef} className="lookup-hero-slot">
      <Card className="lookup-hero" data-testid="track-hero">
        <Artwork src={track.art} name={track.song_name} size={72} />
        <div className="hero-main">
          <h2 className="hero-title">{track.song_name}</h2>
          <p className="hero-artists">
            {credits.map((credit, index) => (
              <span key={credit.name}>
                {index > 0 && ", "}
                <a
                  className="text-link"
                  href={serializeState({
                    ...state,
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
          <div className="row hero-meta">
            <IsrcChip isrc={track.isrc} />
            <a
              className="text-link small"
              href={serializeState({
                ...state,
                page: "track",
                from: "",
                to: "",
                params: { isrc: track.isrc },
              })}
            >
              Full track details
            </a>
          </div>
        </div>
        <div className="hero-stat">
          <span className="muted small">Latest total</span>
          <strong className="mono">
            <Num value={track.latest_streams} />
          </strong>
          <span className="muted small">on {formatUtcDate(track.last_day)}</span>
        </div>
        <div className="hero-spark">
          <span className="muted small">Daily net · last 30 days</span>
          <Sparkline values={spark} label="Daily net, last 30 days" />
        </div>
      </Card>
    </div>
  );
}

function LookupResult({ data }: { data: Monthly }) {
  const [state, setState] = useUrlState();
  const bounds = useMemo(
    () => ({ from: data.track.first_day, to: data.track.last_day }),
    [data.track.first_day, data.track.last_day],
  );
  const fallback = presetRange("Last 30 days", bounds);
  const range = useMemo(
    () => ({ from: state.from || fallback.from, to: state.to || fallback.to }),
    [state.from, state.to, fallback.from, fallback.to],
  );
  const query = useQuery<Between>("/api/lookup/between", {
    dataset: state.dataset,
    isrc: data.track.isrc,
    ...range,
  });
  const days = useQuery<DaysResponse>("/api/lookup/days", {
    dataset: state.dataset,
    isrc: data.track.isrc,
  });
  const [copyStatus, setCopyStatus] = useState("");
  const [firstPoint, setFirstPoint] = useState<string | null>(null);
  const [showDaily, setShowDaily] = useState(false);
  // Canonicalize missing dates without an extra Back step after choosing a track.
  useEffect(() => {
    if (state.from && state.to) return;
    history.replaceState(null, "", serializeState({ ...state, ...range }));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [state, range]);
  // Remember the last lookup so the app reopens on it.
  useEffect(() => {
    if (state.dataset === "followers" || !state.from || !state.to) return;
    saveLast({
      dataset: state.dataset,
      isrc: data.track.isrc,
      from: state.from,
      to: state.to,
    });
  }, [state.dataset, state.from, state.to, data.track.isrc]);
  const setRange = useCallback(
    (value: Range) => {
      setCopyStatus("");
      setFirstPoint(null);
      setState(value);
    },
    [setState],
  );
  const months = useMemo(
    () => [...new Set(data.daily.map((r) => r.day.slice(0, 7)))].reverse(),
    [data.daily],
  );
  const points = useMemo(
    () =>
      data.daily.map((r) => ({
        date: r.day,
        streams: r.streams,
        delta: r.delta,
        observations: r.observations,
        confidence: r.confidence,
      })),
    [data.daily],
  );
  const columns: Column<LookupMonth>[] = [
    {
      key: "month",
      label: "Month",
      render: (r) => (
        <button
          className="lookup-month-link"
          onClick={(event) => {
            event.stopPropagation();
            setRange(clampRange(monthRange(r.month), bounds));
          }}
        >
          {monthLabel(r.month)}
        </button>
      ),
    },
    {
      key: "streams_in_month",
      label: "Streams in month",
      numeric: true,
      render: (r) => <Num value={r.streams_in_month} signed />,
    },
    {
      key: "end_total",
      label: "End-of-month total",
      numeric: true,
      render: (r) => <Num value={r.end_total} />,
    },
    {
      key: "flags",
      label: "Reading notes",
      render: (r) => (
        <span className="row">
          {monthFlags(r).map((f) => (
            <Tooltip key={f.label} text={f.explanation}>
              <Chip variant="warning">{f.label}</Chip>
            </Tooltip>
          ))}
        </span>
      ),
    },
  ];
  const result = query.data;
  const milestones = useMemo(() => ownMilestones(data.daily), [data.daily]);
  const lines = useMemo(
    () => switchLines(data.source_switches),
    [data.source_switches],
  );
  const switches = useMemo(
    () => switchWarnings(result?.source_switches),
    [result?.source_switches],
  );
  const bars = useMemo(() => monthBars(data.rows, range), [data.rows, range]);
  const spark = useMemo(() => sparklineSeries(data.daily), [data.daily]);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroGone = useScrolledPast(heroRef);
  const copyNow = useCallback(async () => {
    if (!result || result.empty) return;
    try {
      await navigator.clipboard.writeText(copyResult(result));
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy unavailable. Select the result text below.");
    }
  }, [result]);
  // ---- keyboard: [ ] move From, Shift+[ ] move To, c copy ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutAction(event, !!document.querySelector("dialog[open]"));
      const steps = {
        "from-back": ["from", -1],
        "from-forward": ["from", 1],
        "to-back": ["to", -1],
        "to-forward": ["to", 1],
      } as const;
      if (action && action in steps) {
        event.preventDefault();
        const [side, delta] = steps[action as keyof typeof steps];
        const next = stepRange(range, side, delta, bounds);
        if (next) setRange(next);
      } else if (action === "copy") {
        event.preventDefault();
        void copyNow();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [range, bounds, setRange, copyNow]);
  return (
    <>
      <TrackHero data={data} spark={spark} heroRef={heroRef} />
      <StickyTrackBar
        visible={heroGone}
        cover={data.track.art}
        title={data.track.song_name}
        artist={data.track.artist}
        from={range.from}
        to={range.to}
        difference={result && !result.empty ? result.difference : null}
      />
      <Card className="lookup-calculator">
        <RangeControls
          range={range}
          bounds={bounds}
          ranges={days.data?.ranges}
          months={months}
          onRange={setRange}
          presetTitle="Ends at the track’s last archived reading"
        />
        {query.error ? (
          <ErrorState
            message={query.error.message}
            retry={() => void query.refetch()}
          />
        ) : query.loading || !result ? (
          <div className="lookup-tiles skeleton-tiles" aria-busy="true">
            <span role="status" className="sr-only">
              Comparing readings…
            </span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <span className="skeleton" style={{ width: "50%", height: 12 }} />
                <span className="skeleton" style={{ width: "80%", height: 30 }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            {result.empty ? (
              <EmptyState
                title="No readings inside these dates"
                description="Choose a wider range containing a tracked day. Missing readings are never treated as zero."
              />
            ) : (
              <div className="lookup-tiles" aria-live="polite">
                <div>
                  <span>Streams on {formatUtcDate(range.from)}</span>
                  <strong className="mono">
                    <Num value={result.from?.streams} />
                  </strong>
                  <small className="muted">
                    {result.from?.substituted
                      ? `Reading: ${formatUtcDate(result.from.used_day)}`
                      : " "}
                  </small>
                </div>
                <div>
                  <span>Streams on {formatUtcDate(range.to)}</span>
                  <strong className="mono">
                    <Num value={result.to?.streams} />
                  </strong>
                  <small className="muted">
                    {result.to?.substituted
                      ? `Reading: ${formatUtcDate(result.to.used_day)}`
                      : " "}
                  </small>
                </div>
                <div className="lookup-difference">
                  <span>Difference</span>
                  {result.difference === null ? (
                    <strong className="mono">—</strong>
                  ) : (
                    <>
                      <strong
                        className="mono"
                        aria-hidden="true"
                        title={signed(result.difference)}
                      >
                        <AnimatedNumber
                          value={result.difference}
                          format={(value) => displaySigned(value)}
                        />
                      </strong>
                      <span className="sr-only">
                        {signed(result.difference)} streams
                      </span>
                    </>
                  )}
                  <small>streams</small>
                </div>
                <div>
                  <span>Per day · {result.days} days</span>
                  <strong className="mono">
                    <Num value={result.per_day} digits={1} />
                  </strong>
                  <small className="muted">Between used readings</small>
                </div>
              </div>
            )}
            {!!lookupWarnings(result).length && (
              <ul className="lookup-warnings">
                {lookupWarnings(result).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {!!switches.lines.length && (
              <div
                className="lookup-switch-warning"
                role="note"
                data-testid="switch-warning"
              >
                <span aria-hidden="true" className="switch-icon">
                  ⇄
                </span>
                <div>
                  {switches.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  {switches.minor > 0 && (
                    <p className="muted small">
                      Also {switches.minor} minor source{" "}
                      {switches.minor === 1 ? "switch" : "switches"} under 1,000
                      streams in this range.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="row spread lookup-copy-row">
              <span className="muted small lookup-definition">
                Difference = To reading − From reading; From-day streams are
                excluded. Presets end at the last archived reading. Tracked{" "}
                {formatUtcDate(bounds.from)} – {formatUtcDate(bounds.to)} · UTC
              </span>
              <div className="row">
                <span role="status" className="small">
                  {copyStatus}
                </span>
                <Button
                  variant="accent"
                  disabled={result.empty}
                  title="Copy result (C)"
                  onClick={() => void copyNow()}
                >
                  Copy result
                </Button>
              </div>
            </div>
            {copyStatus.startsWith("Copy unavailable") && (
              <p className="mono small">{copyResult(result)}</p>
            )}
          </>
        )}
      </Card>
      <section className="lookup-months">
        <div className="row spread lookup-month-heading">
          <div className="row">
            <h2>Streams per month</h2>
            <Tooltip text={MONTH_DEFINITION}>
              <Chip variant="info">Definition</Chip>
            </Tooltip>
          </div>
          <div className="row lookup-export-row">
            <Button
              onClick={() =>
                exportCSV({
                  dataset: state.dataset,
                  isrc: data.track.isrc,
                  view: "lookup_monthly",
                })
              }
            >
              Monthly CSV
            </Button>
            <Button
              onClick={() =>
                exportCSV({
                  dataset: state.dataset,
                  isrc: data.track.isrc,
                  view: "lookup_daily",
                })
              }
            >
              Daily readings CSV
            </Button>
          </div>
        </div>
        <p className="muted small">
          Month-end minus previous month-end. Click a month or a bar to compare
          its first and last dates.
        </p>
        <DataTable
          label="Streams per month"
          dense
          rows={[...data.rows].reverse()}
          rowKey={(r) => r.month}
          columns={columns}
          onRowClick={(r) => setRange(clampRange(monthRange(r.month), bounds))}
        />
      </section>
      <div className="lookup-charts">
        <TimeSeriesChart
          title="Cumulative streams"
          height={260}
          description={
            firstPoint
              ? `From set to ${formatUtcDate(firstPoint)}. Click a second reading to set To.`
              : "Click a reading for From, then another for To. Drag across readings to select both."
          }
          data={points}
          series={[
            {
              key: "streams",
              label: "Streams",
              color: "var(--sb-accent-stroke)",
            },
          ]}
          markers={milestones.markers}
          lines={lines}
          extraFields={[
            { key: "observations", label: "Observations" },
            { key: "confidence", label: "Confidence" },
          ]}
          selection={{
            ...range,
            points: result
              ? [
                  result.from && {
                    day: result.from.used_day,
                    value: result.from.streams,
                    label: "From",
                  },
                  result.to && {
                    day: result.to.used_day,
                    value: result.to.streams,
                    label: "To",
                  },
                ].filter(
                  (p): p is { day: string; value: number; label: string } =>
                    !!p,
                )
              : [],
            onPoint: (day) => {
              // First click sets From, second sets To (swapped when earlier).
              setCopyStatus("");
              const next = pickPoint(firstPoint, day, range);
              setFirstPoint(next.first);
              setState(next.range);
            },
            onRange: (from, to) => setRange(selectPoints(from, to)),
          }}
          actions={
            <label className="row small">
              <input
                type="checkbox"
                checked={showDaily}
                onChange={(event) => setShowDaily(event.target.checked)}
              />
              Daily change bars
            </label>
          }
        />
        <p className="muted small lookup-chart-note" data-testid="milestone-note">
          Flags mark the first reading at or above each milestone in this
          track’s own series
          {milestones.alreadyPast.length > 0 &&
            `; already past at first reading: ${milestones.alreadyPast.join(", ")}`}
          .{lines.length > 0 && " ⇄ marks a day the counter source switched."}
        </p>
        <h2 className="lookup-chart-heading">Monthly streams</h2>
        <MonthlyBars
          bars={bars}
          onSelect={(month) => setRange(clampRange(monthRange(month), bounds))}
        />
        {showDaily && (
          <TimeSeriesChart
            title="Daily change"
            description="Only consecutive-day changes; resets and gaps remain missing. The 7-day avg needs four known days."
            data={points}
            series={[
              {
                key: "delta",
                label: "Daily change",
                type: "bar",
                color: DAILY_BAR_COLOR,
                movingAverage: true,
                movingAverageMinKnown: 4,
              },
            ]}
            height={190}
          />
        )}
      </div>
    </>
  );
}
