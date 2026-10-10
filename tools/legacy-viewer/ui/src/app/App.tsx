import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
import { LogoMark } from "../components/LogoMark";
import { CommandPalette } from "../components/CommandPalette";
import { ArtworkPreviewProvider } from "../components/ui/Artwork";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  SegmentedControl,
} from "../components/ui";
import {
  DateRangePicker,
  GranularitySelect,
} from "../components/ui/DateRangePicker";
import { ApiError, exportCSV, getJSON, useQuery } from "../lib/api";
import { queryParams, type Meta } from "../lib/explorer";
import { useNumberMode, type NumberMode } from "../lib/numberMode";
import { TITLED_PAGES, windowTitle } from "../lib/title";
import { pages } from "../pages/Placeholder";
import { pageComponents } from "../pages";
import { useTheme } from "./theme";
import { serializeState, useUrlState, type Dataset } from "./useUrlState";
// Vite folds this branch to null and removes the module import from production.
const Gallery = import.meta.env.DEV
  ? lazy(() => import("../pages/__gallery/Gallery"))
  : null;
const datasets: { value: Dataset; label: string }[] = [
  { value: "stats2", label: "Streams · complete (stats2)" },
  { value: "stats", label: "Streams · stats server" },
  { value: "followers", label: "Playlist followers" },
];
const numberModes: { value: NumberMode; label: string; title: string }[] = [
  { value: "exact", label: "1,234", title: "Exact numbers (1,234,567)" },
  { value: "compact", label: "1.2M", title: "Compact numbers (1.2M); hover for the exact value" },
];
const navGroups: Record<string, string> = {
  overview: "Explore",
  tax: "Reports",
  original: "Original dashboards",
  quality: "About the data",
};
export function App() {
  const [state, setState] = useUrlState(),
    { theme, toggle, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [stopped, setStopped] = useState(false),
    [quitting, setQuitting] = useState(false),
    [quitError, setQuitError] = useState(""),
    [offline, setOffline] = useState(false);
  // Detect a stopped local server: failed requests raise "viewer-offline", and a light
  // heartbeat catches it while idle. When offline, poll until the EXE is started again.
  useEffect(() => {
    if (stopped) return;
    const goOffline = () => setOffline(true);
    window.addEventListener("viewer-offline", goOffline);
    const ping = async () => {
      try {
        const r = await fetch("/api/session", { cache: "no-store" });
        if (r.ok) {
          if (offline) window.location.reload();
        } else setOffline(true);
      } catch {
        setOffline(true);
      }
    };
    const timer = window.setInterval(ping, offline ? 3000 : 15000);
    return () => {
      window.removeEventListener("viewer-offline", goOffline);
      window.clearInterval(timer);
    };
  }, [offline, stopped]);
  const page = pages.find(
    (page) =>
      page.route === state.page ||
      (page.route === "original" && state.page === "original-dashboards"),
  );
  const originalMode = ["original", "original-dashboards", "tax"].includes(
    state.page,
  );
  const lookupMode = ["lookup", "artist-report"].includes(state.page);
  const [numberMode, setNumberMode] = useNumberMode();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const topbar = useRef<HTMLElement>(null);
  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
  // Quick jump: Ctrl+K / Cmd+K works everywhere, even while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  // The sticky track bar sits just under the (sticky) top bar.
  useEffect(() => {
    const bar = topbar.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const apply = () =>
      document.documentElement.style.setProperty(
        "--topbar-h",
        `${Math.round(bar.getBoundingClientRect().height)}px`,
      );
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [offline, stopped]);
  const Page = pageComponents[state.page];
  const meta = useQuery<Meta>("/api/meta");
  const datasetMeta =
    state.dataset === "followers"
      ? meta.data?.followers
      : meta.data?.datasets.find((d) => d.key === state.dataset);
  const bounds = datasetMeta
    ? { from: datasetMeta.first_day, to: datasetMeta.last_day }
    : undefined;
  const exportViews: Record<string, string> = {
    lookup: "lookup_monthly",
    overview: "explorer_overview",
    tracks: "explorer_tracks",
    track: "track_records",
    artists: "artists",
    artist: "artist",
    playlists: "explorer_playlists",
    playlist: "explorer_playlist",
    milestones: "milestones",
    followers:
      state.params.tab === "accounts"
        ? "followers_accounts"
        : "followers_overview",
    "follower-playlist": "followers_playlist",
    quality: "quality_resets",
    "data-quality": "quality_resets",
    archive: "archive",
  };
  const exportView = exportViews[state.page];
  useEffect(() => {
    const followerRoute = ["followers", "follower-playlist"].includes(
      state.page,
    );
    if (
      state.dataset === "followers" &&
      !followerRoute &&
      !["archive", "original-dashboards", "original"].includes(state.page) &&
      !(import.meta.env.DEV && state.page === "__gallery")
    )
      setState({ page: "followers", params: {} });
    else if (state.dataset !== "followers" && followerRoute)
      setState({ dataset: "followers", from: "", to: "" });
  }, [state.dataset, state.page, setState]);
  useEffect(() => {
    const details: Record<string, string> = {
      track: "Track detail",
      artist: state.params.name || "Artist detail",
      playlist: "Playlist detail",
      "follower-playlist": "Follower playlist",
      quality: "Data quality",
    };
    // Track lookup and the artist report name their own window (useDocumentTitle).
    if (TITLED_PAGES.includes(state.page)) return;
    document.title = windowTitle(
      page?.title ?? details[state.page] ?? undefined,
    );
  }, [page, state.page, state.params.name]);
  async function quit() {
    setQuitting(true);
    setQuitError("");
    try {
      const session = await getJSON<{ token: string }>("/api/session");
      if (!session.token)
        throw new Error("The viewer did not return a shutdown token");
      // Some servers terminate without a JSON body; only the status matters here.
      const response = await fetch("/api/shutdown", {
        method: "POST",
        headers: { "X-Viewer-Token": session.token },
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new ApiError(
          body && typeof body === "object" && "error" in body
            ? String(body.error)
            : `Shutdown failed (${response.status})`,
          response.status,
          "/api/shutdown",
        );
      }
      setStopped(true);
    } catch (error) {
      setQuitError(
        error instanceof Error ? error.message : "Could not stop the viewer",
      );
    } finally {
      setQuitting(false);
    }
  }
  if (offline && !stopped)
    return (
      <main className="stopped" role="alert">
        <LogoMark />
        <h1>The viewer isn't running</h1>
        <p>
          Its local server was stopped. Start{" "}
          <strong>StreamBase Legacy Viewer.exe</strong> again — this window
          reconnects automatically — or simply close it.
        </p>
      </main>
    );
  if (stopped)
    return (
      <main className="stopped">
        <LogoMark />
        <h1>Viewer stopped</h1>
        <p>You can close this window.</p>
      </main>
    );
  return (
    <ArtworkPreviewProvider>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div
        className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobileOpen ? "mobile-nav-open" : ""}`}
      >
        <aside className="sidebar" aria-label="Archive navigation">
          <div className="brand">
            <LogoMark />
            <div className="brand-text">
              <strong>StreamBase</strong>
              <span>Legacy Archive</span>
            </div>
          </div>
          <nav>
            {pages.map((item) => (
              <Fragment key={item.route}>
                {navGroups[item.route] && (
                  <div className="sidebar-heading muted small">
                    {navGroups[item.route]}
                  </div>
                )}
                <a
                  className={item.route === "lookup" ? "nav-lookup" : ""}
                  key={item.route}
                  href={serializeState({
                    ...state,
                    dataset:
                      item.route === "followers"
                        ? "followers"
                        : state.dataset === "followers" &&
                            !["original", "archive"].includes(item.route)
                          ? "stats2"
                          : state.dataset,
                    from:
                      item.route === "followers" ||
                      (state.dataset === "followers" &&
                        !["original", "archive"].includes(item.route))
                        ? ""
                        : state.from,
                    to:
                      item.route === "followers" ||
                      (state.dataset === "followers" &&
                        !["original", "archive"].includes(item.route))
                        ? ""
                        : state.to,
                    page: item.route,
                    params: {},
                  })}
                  aria-current={item.route === state.page ? "page" : undefined}
                  title={item.title}
                  onClick={() => setMobileOpen(false)}
                >
                  <span aria-hidden="true" className="nav-icon">
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.title}</span>
                </a>
              </Fragment>
            ))}
            {import.meta.env.DEV && (
              <a href="#/__gallery">
                <span aria-hidden="true" className="nav-icon">
                  ◈
                </span>
                <span className="nav-label">Component gallery</span>
              </a>
            )}
          </nav>
          <footer className="sidebar-footer">
            <Chip variant="warning">Read-only archive</Chip>
            <p className="muted small">Local history, preserved.</p>
            <IconButton
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="collapse-sidebar"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? "»" : "«"}
            </IconButton>
            <Button
              className="close-mobile-nav"
              onClick={() => setMobileOpen(false)}
            >
              Close navigation
            </Button>
          </footer>
        </aside>
        {mobileOpen && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <div className="workspace">
          <header className="topbar" ref={topbar}>
            <div className="row spread">
              <div className="row">
                <IconButton
                  className="mobile-menu"
                  aria-label="Toggle navigation"
                  aria-expanded={mobileOpen}
                  onClick={() => setMobileOpen(!mobileOpen)}
                >
                  ☰
                </IconButton>
                <SegmentedControl
                  label="Archive dataset"
                  value={state.dataset}
                  options={datasets}
                  onChange={(dataset) =>
                    setState({
                      dataset,
                      page:
                        dataset === "followers"
                          ? "followers"
                          : state.dataset === "followers"
                            ? "lookup"
                            : state.page,
                      from: "",
                      to: "",
                      params: {},
                    })
                  }
                />
              </div>
              <div className="row">
                <button
                  type="button"
                  className="search-button"
                  aria-label="Quick jump: search tracks and artists"
                  aria-haspopup="dialog"
                  title="Jump to any track or artist"
                  onClick={() => setPaletteOpen(true)}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="m10.6 10.6 3.4 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span>Search</span>
                  <kbd>{isMac ? "⌘ K" : "Ctrl K"}</kbd>
                </button>
                <SegmentedControl
                  label="Number display"
                  value={numberMode}
                  options={numberModes}
                  onChange={setNumberMode}
                />
                <span className="topbar-readonly">
                  <Chip variant="warning">Read-only archive</Chip>
                </span>
                <IconButton
                  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                  onClick={toggle}
                >
                  {theme === "dark" ? "☀" : "☾"}
                </IconButton>
                <Button
                  variant="ghost"
                  onClick={() => setTheme(null)}
                  title="Follow system colour preference"
                >
                  System
                </Button>
                <Button onClick={() => void quit()} loading={quitting}>
                  Quit
                </Button>
              </div>
            </div>
            {!lookupMode && (
              <div className="row spread topbar-filters">
                <div className="row">
                  {bounds && !originalMode && state.params.tab !== "raw" && (
                    <DateRangePicker
                      bounds={bounds}
                      value={{ from: state.from, to: state.to }}
                      onChange={(range) => setState(range)}
                    />
                  )}
                  {!originalMode && (
                    <GranularitySelect
                      value={state.grain}
                      onChange={(grain) => setState({ grain })}
                    />
                  )}
                  <span className="muted small">UTC calendar dates</span>
                </div>
                <Button
                  disabled={!exportView || !meta.data}
                  title={
                    exportView
                      ? "Export the primary series or table with current filters"
                      : "Use the panel menu to export CSV"
                  }
                  onClick={() =>
                    exportCSV({ ...queryParams(state), view: exportView })
                  }
                >
                  Export CSV
                </Button>
              </div>
            )}
          </header>
          <div id="sticky-slot" className="sticky-slot" />
          <main id="main-content" tabIndex={-1}>
            {meta.error && (
              <ErrorState
                message={meta.error.message}
                retry={() => void meta.refetch()}
              />
            )}
            {quitError && (
              <ErrorState message={quitError} retry={() => void quit()} />
            )}
            {Gallery && state.page === "__gallery" ? (
              <Suspense fallback={<LoadingState />}>
                <Gallery />
              </Suspense>
            ) : Page ? (
              <Page key={numberMode} />
            ) : (
              <EmptyState
                title="View not found"
                description="Choose a page from the archive navigation."
              />
            )}
          </main>
          <footer className="workspace-footer">
            <span>StreamBase Legacy Archive</span>
            <span>Offline · Read-only</span>
          </footer>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ArtworkPreviewProvider>
  );
}
