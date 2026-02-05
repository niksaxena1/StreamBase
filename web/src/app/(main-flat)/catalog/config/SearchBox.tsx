"use client";

import { useState, useEffect } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type SearchBoxProps = {
  onSearchChange: (query: string) => void;
  placeholder?: string;
  className?: string;
};

export function SearchBox({ onSearchChange, placeholder = "Search…", className }: SearchBoxProps) {
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // Initialize from URL params if present (only on mount)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlQuery = params.get("q") ?? "";
      if (urlQuery) {
        setSearchQuery(urlQuery);
        onSearchChange(urlQuery);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    onSearchChange(value);
    
    // Update URL without page reload
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (value.trim()) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
  };

  return (
    <input
      type="text"
      value={searchQuery}
      onChange={handleChange}
      placeholder={placeholder}
      className={cx(
        "w-full max-w-sm rounded-xl border bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 transition focus:border-black/20 focus:ring-2 focus:ring-black/5 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40 dark:border-white/10 dark:focus:border-white/20 dark:focus:ring-white/5",
        className,
      )}
      style={{ borderColor: "var(--sb-border)" }}
    />
  );
}
