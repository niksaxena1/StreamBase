"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Modal } from "@/components/ui/Modal";

type SearchResult = {
  type: "track" | "artist" | "playlist";
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  trackCount?: number;
  firstArtistId?: string | null;
  artistIds?: string[] | null;
  artistNames?: string[] | null;
};

type SearchStats = {
  streams: number;
};

type RecentItem = {
  type: SearchResult["type"];
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  trackCount?: number;
  firstArtistId?: string | null;
};

const RECENTS_KEY = "sb_recent_search_items_v1";
const MAX_RECENTS = 8;

function formatStreams(streams: number) {
  if (streams >= 1_000_000) return `${(streams / 1_000_000).toFixed(1)}M`;
  if (streams >= 1_000) return `${(streams / 1_000).toFixed(1)}K`;
  return String(streams);
}

function getShortcutLabel() {
  // This app runs in many environments; keep it simple & readable.
  return navigator.platform?.toLowerCase().includes("mac") ? "⌘ K" : "Ctrl K";
}

function safeReadRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object")
      .slice(0, MAX_RECENTS) as RecentItem[];
  } catch {
    return [];
  }
}

function safeWriteRecents(items: RecentItem[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
  } catch {
    // ignore
  }
}

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredResultStats, setHoveredResultStats] = useState<Record<string, SearchStats>>({});
  const [loadingStats, setLoadingStats] = useState<Record<string, boolean>>({});
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Load recents on mount (client-only).
    setRecents(safeReadRecents());
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === "k";
      const wantsOpen = (e.ctrlKey || e.metaKey) && isK;
      if (!wantsOpen) return;
      e.preventDefault();
      setOpen((prev) => {
        const next = !prev;
        if (!next) {
          setQuery("");
          setResults([]);
        }
        return next;
      });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Focus the input on open.
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Debounced search (only while palette is open).
  useEffect(() => {
    if (!open) return;

    if (!query.trim()) {
      setResults([]);
      return;
    }

    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          setResults(data.results || []);
        }
      } catch (error) {
        // Ignore aborts; log others.
        if ((error as any)?.name !== "AbortError") {
          console.error("Search error:", error);
        }
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, query]);

  const grouped = useMemo(() => {
    const tracks = results.filter((r) => r.type === "track");
    const artists = results.filter((r) => r.type === "artist");
    const playlists = results.filter((r) => r.type === "playlist");
    return { tracks, artists, playlists };
  }, [results]);

  const orderedResults = useMemo(() => {
    // UX: always prefer Artists first (then Tracks), regardless of backend ordering.
    return [...grouped.artists, ...grouped.tracks, ...grouped.playlists];
  }, [grouped.artists, grouped.playlists, grouped.tracks]);

  const orderedIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    orderedResults.forEach((r, idx) => m.set(`${r.type}-${r.id}`, idx));
    return m;
  }, [orderedResults]);

  const visibleItems = useMemo(() => {
    if (!query.trim()) return recents;
    return orderedResults;
  }, [orderedResults, query, recents]);

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // Reset selection when the list changes materially.
    setActiveIndex(0);
  }, [open, query, orderedResults.length, recents.length]);

  function toRecentItem(r: SearchResult): RecentItem {
    return {
      type: r.type,
      id: r.id,
      name: r.name,
      subtitle: r.subtitle,
      imageUrl: r.imageUrl,
      trackCount: r.trackCount,
      firstArtistId: r.firstArtistId ?? null,
    };
  }

  function addRecent(item: RecentItem) {
    const next = [item, ...recents.filter((x) => !(x.type === item.type && x.id === item.id))].slice(
      0,
      MAX_RECENTS,
    );
    setRecents(next);
    safeWriteRecents(next);
  }

  const navigateTo = (result: SearchResult) => {
    if (result.type === "track") {
      // If we have the first artist ID, load both artist and track in catalog
      if (result.firstArtistId) {
        router.push(
          `/catalog?artist_id=${encodeURIComponent(result.firstArtistId)}&isrc=${encodeURIComponent(result.id)}`
        );
      } else {
        // Fallback to just loading the track if no artist ID
        router.push(`/catalog?isrc=${encodeURIComponent(result.id)}`);
      }
    } else if (result.type === "artist") {
      router.push(`/catalog?artist_id=${encodeURIComponent(result.id)}`);
    } else if (result.type === "playlist") {
      router.push(`/playlists/${encodeURIComponent(result.id)}`);
    }

    addRecent(toRecentItem(result));
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const ensureStatsLoaded = (result: SearchResult) => {
    const key = `${result.type}-${result.id}`;

    // If already loaded, don't fetch again
    if (hoveredResultStats[key]) {
      return;
    }

    // Don't fetch if already loading
    if (loadingStats[key]) {
      return;
    }

    setLoadingStats((prev) => ({ ...prev, [key]: true }));

    fetch(`/api/search-stats?type=${result.type}&id=${encodeURIComponent(result.id)}`)
      .then((res) => res.json())
      .then((data) => {
        setHoveredResultStats((prev) => ({ ...prev, [key]: data }));
      })
      .catch((error) => console.error("Failed to fetch stats:", error))
      .finally(() => {
        setLoadingStats((prev) => ({ ...prev, [key]: false }));
      });
  };

  useEffect(() => {
    if (!open) return;
    if (query.trim() && orderedResults.length > 0) {
      const item =
        orderedResults[Math.max(0, Math.min(activeIndex, orderedResults.length - 1))];
      if (item) ensureStatsLoaded(item);
    }
  }, [activeIndex, open, query, orderedResults]);

  function onKeyDownList(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, visibleItems.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = visibleItems[activeIndex] as any;
      if (!item) return;
      // Recents have the same identifying fields as results.
      navigateTo(item as SearchResult);
    }
  }

  return (
    <>
      {/* Header trigger (command palette style) */}
      <button
        type="button"
        className="w-full sb-ring rounded-lg border bg-white/70 px-3 py-2 text-sm transition hover:bg-white/80 dark:bg-white/5 dark:hover:bg-white/10 text-left"
        style={{ borderColor: "var(--sb-border)", color: "var(--sb-text)" }}
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 opacity-50" />
          <span className="flex-1 truncate opacity-70">Search…</span>
        </div>
      </button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery("");
          setResults([]);
        }}
        title="Search"
        subtitle={
          <span>
            Tracks, artists, playlists.
          </span>
        }
        maxWidthClassName="max-w-xl"
      >
        <div className="flex flex-col gap-3" onKeyDown={onKeyDownList}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full rounded-lg border bg-white/70 px-3 py-2 pl-10 pr-10 text-sm outline-none transition focus:ring-2 focus:ring-lime-500/30 focus:border-lime-500 dark:bg-white/5 dark:text-white dark:border-white/10 dark:focus:ring-lime-500/30 dark:focus:border-lime-500"
              style={{ borderColor: "var(--sb-border)", color: "var(--sb-text)" }}
            />
            {query ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-60 hover:opacity-90"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                }}
                aria-label="Clear"
                title="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="max-h-[55vh] overflow-auto rounded-xl border" style={{ borderColor: "var(--sb-border)" }}>
            {!query.trim() ? (
              <div className="p-1">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                  Recent
                </div>
                {recents.length ? (
                  <div>
                    {recents.map((r, idx) => {
                      const key = `${r.type}-${r.id}`;
                      const active = idx === activeIndex;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={[
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                            active ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5",
                          ].join(" ")}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => navigateTo(r as any)}
                        >
                          {r.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.imageUrl}
                              alt={r.name}
                              className={`h-8 w-8 object-cover ${r.type === "artist" ? "rounded-full" : "rounded"}`}
                            />
                          ) : (
                            <div
                              className={`h-8 w-8 ${r.type === "artist" ? "rounded-full" : "rounded"} bg-black/10 dark:bg-white/10`}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{r.name}</div>
                            <div className="truncate text-xs opacity-60">
                              {r.type === "artist" ? "Artist" : r.type === "playlist" ? "Playlist" : "Track"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-3 text-sm opacity-60">No recent searches yet.</div>
                )}
              </div>
            ) : isLoading ? (
              <div className="px-3 py-3 text-sm opacity-60">Searching…</div>
            ) : results.length ? (
              <div className="p-1">
                {(
                  [
                    { label: "Artists", items: grouped.artists },
                    { label: "Tracks", items: grouped.tracks },
                    { label: "Playlists", items: grouped.playlists },
                  ] as const
                ).map((group) => {
                  if (!group.items.length) return null;
                  return (
                    <div key={group.label}>
                      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                        {group.label}
                      </div>
                      <div>
                        {group.items.map((result) => {
                          const globalIndex =
                            orderedIndexByKey.get(`${result.type}-${result.id}`) ?? 0;
                          const active = globalIndex === activeIndex;
                          const statsKey = `${result.type}-${result.id}`;
                          const stats = hoveredResultStats[statsKey];
                          const isLoadingStats = loadingStats[statsKey];

                          const subtitle =
                            result.type === "artist" || result.type === "playlist"
                              ? `${result.trackCount || 0} track${result.trackCount !== 1 ? "s" : ""}`
                              : result.artistNames?.length
                                ? result.artistNames.join(", ")
                                : result.subtitle ?? "";

                          return (
                            <button
                              key={statsKey}
                              type="button"
                              className={[
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                                active ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5",
                              ].join(" ")}
                              onMouseEnter={() => {
                                setActiveIndex(globalIndex);
                                ensureStatsLoaded(result);
                              }}
                              onClick={() => navigateTo(result)}
                            >
                              {result.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={result.imageUrl}
                                  alt={result.name}
                                  className={`h-8 w-8 object-cover ${result.type === "artist" ? "rounded-full" : "rounded"}`}
                                />
                              ) : (
                                <div
                                  className={`h-8 w-8 ${result.type === "artist" ? "rounded-full" : "rounded"} bg-black/10 dark:bg-white/10`}
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{result.name}</div>
                                {subtitle ? <div className="truncate text-xs opacity-60">{subtitle}</div> : null}
                              </div>
                              <div className="text-xs font-medium" style={{ color: "var(--sb-accent)" }}>
                                {isLoadingStats ? "…" : stats ? formatStreams(stats.streams) : ""}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-3 text-sm opacity-60">No results found.</div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
