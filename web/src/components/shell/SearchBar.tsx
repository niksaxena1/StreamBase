"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";

type SearchResult = {
  type: "track" | "artist";
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
};

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
      router.push(`/catalog?isrc=${encodeURIComponent(result.id)}`);
    } else if (result.type === "artist") {
      router.push(`/catalog?artist_id=${encodeURIComponent(result.id)}`);
    }
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={searchRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40 dark:text-white/40" />
        <input
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

      {/* Results dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border bg-white shadow-lg dark:bg-neutral-900" style={{ borderColor: "var(--sb-border)" }}>
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-black/50 dark:text-white/50">
              Searching...
            </div>
          ) : results.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              {results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleResultClick(result)}
                  className="flex w-full items-center gap-3 border-b px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 last:border-b-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  {result.imageUrl && (
                    <img
                      src={result.imageUrl}
                      alt={result.name}
                      className="h-10 w-10 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium">
                      {result.name}
                    </div>
                    {result.subtitle && (
                      <div className="truncate text-xs text-black/60 dark:text-white/60">
                        {result.subtitle}
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-medium opacity-50">
                    {result.type === "track" ? "Track" : "Artist"}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-black/50 dark:text-white/50">
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
