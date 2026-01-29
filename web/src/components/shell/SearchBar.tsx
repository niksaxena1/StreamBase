"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";

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

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const [hoveredResultStats, setHoveredResultStats] = useState<Record<string, SearchStats>>({});
  const [loadingStats, setLoadingStats] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Update dropdown position when it opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownRect(rect);
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`
        );
        if (response.ok) {
          const data = await response.json();
          setResults(data.results || []);
          setIsOpen(true);
        }
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleResultClick = (result: SearchResult) => {
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
    setQuery("");
    setIsOpen(false);
  };

  const handleResultHover = (result: SearchResult) => {
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

  return (
    <>
      <div ref={searchRef} className="relative w-full">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40 dark:text-white/40" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tracks or artists..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim() && setIsOpen(true)}
            className="w-full rounded-lg border bg-white/70 px-3 py-2 pl-10 pr-8 text-sm outline-none placeholder:text-black/50 transition focus:border-black/30 focus:ring-2 focus:ring-black/5 dark:bg-white/5 dark:text-white dark:placeholder:text-white/50 dark:border-white/10 dark:focus:border-white/30 dark:focus:ring-white/5"
            style={{ borderColor: "var(--sb-border)" }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
                setIsOpen(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/60 dark:text-white/40 dark:hover:text-white/60"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Results dropdown - must be inside searchRef for click-outside logic */}
        {isOpen && (
          <div
            className="absolute top-full z-[9999] mt-1 rounded-lg border bg-white shadow-lg dark:bg-neutral-900"
            style={{
              borderColor: "var(--sb-border)",
              width: dropdownRect ? `${dropdownRect.width * 1.5}px` : "auto",
              left: "50%",
              transform: "translateX(-50%)",
            }}
          >
            {isLoading ? (
              <div className="px-3 py-2 text-sm text-black/50 dark:text-white/50">
                Searching...
              </div>
            ) : results.length > 0 ? (
              <div className="max-h-96 overflow-y-auto">
                {results.map((result) => {
                  const statsKey = `${result.type}-${result.id}`;
                  const stats = hoveredResultStats[statsKey];
                  const isLoadingStats = loadingStats[statsKey];

                  const formatStreams = (streams: number) => {
                    if (streams >= 1_000_000) return `${(streams / 1_000_000).toFixed(1)}M`;
                    if (streams >= 1_000) return `${(streams / 1_000).toFixed(1)}K`;
                    return String(streams);
                  };

                  return (
                    <button
                      key={statsKey}
                      type="button"
                      onClick={() => handleResultClick(result)}
                      onMouseEnter={() => handleResultHover(result)}
                      className="flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 last:border-b-0 relative"
                      style={{ borderColor: "var(--sb-border)", pointerEvents: "auto" }}
                    >
                      {result.imageUrl && (
                        <img
                          src={result.imageUrl}
                          alt={result.name}
                          className={`h-10 w-10 object-cover ${result.type === "artist" ? "rounded-full" : "rounded"}`}
                        />
                      )}
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-medium">{result.name}</div>
                        <div className="truncate text-xs text-black/60 dark:text-white/60">
                          {result.type === "artist" || result.type === "playlist"
                            ? `${result.trackCount || 0} track${result.trackCount !== 1 ? "s" : ""}`
                            : result.artistIds && result.artistNames && result.artistIds.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {result.artistNames.map((name, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const artistId = result.artistIds?.[idx];
                                        if (artistId) {
                                          router.push(`/catalog?artist_id=${encodeURIComponent(artistId)}`);
                                          setQuery("");
                                          setIsOpen(false);
                                        }
                                      }}
                                      className="cursor-pointer transition hover:text-lime-600 dark:hover:text-lime-400"
                                      title={`Go to ${name}`}
                                    >
                                      {name}
                                      {idx < (result.artistNames?.length || 0) - 1 && ","}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                result.subtitle
                              )}
                        </div>
                      </div>
                      <div className="text-xs font-medium" style={{ color: "var(--sb-accent)" }}>
                        {isLoadingStats ? "..." : stats ? formatStreams(stats.streams) : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-black/50 dark:text-white/50">
                No results found
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
