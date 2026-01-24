import Link from "next/link";

import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TracksPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const sb = await supabaseServer();

  let query = sb
    .from("tracks")
    .select("isrc,name,release_date,last_seen", { count: "exact" })
    .order("last_seen", { ascending: false })
    .order("isrc", { ascending: true })
    .range(from, to);

  if (q) {
    // Search by ISRC prefix or track name substring
    // Note: Supabase PostgREST filters are ANDed; use `or` for combined.
    const esc = q.replaceAll(",", "\\,").replaceAll("(", "\\(").replaceAll(")", "\\)");
    query = query.or(`isrc.ilike.${esc}%,name.ilike.%${esc}%`);
  }

  const { data, error, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Tracks</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
            Search your catalog by ISRC or title.
          </p>
        </div>
      </div>

      <form className="sb-card rounded-[28px] p-4" action="/tracks" method="get">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search ISRC or name…"
            className="w-full rounded-2xl border bg-white/70 px-4 py-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--sb-border)" }}
          />
          <button
            type="submit"
            className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white"
          >
            Search
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error: {error.message}
        </div>
      )}

      <div className="sb-card overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-sm font-medium">
            Results{" "}
            <span style={{ color: "var(--sb-muted)" }}>
              ({total.toLocaleString("en-US")})
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Page {page} / {totalPages}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs" style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
                <th className="px-5 py-3 font-medium">ISRC</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Release</th>
                <th className="px-5 py-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr
                  key={t.isrc}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link className="underline" href={`/tracks/${t.isrc}`}>
                      {t.isrc}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{t.name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {t.release_date ?? "—"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {t.last_seen ?? "—"}
                  </td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={4}>
                    No tracks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-4 border-t px-5 py-4" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Showing {from + 1}–{Math.min(to + 1, total)} of {total.toLocaleString("en-US")}
          </div>
          <div className="flex items-center gap-2">
            <PageLink disabled={page <= 1} href={pageHref(q, page - 1)}>
              Prev
            </PageLink>
            <PageLink disabled={page >= totalPages} href={pageHref(q, page + 1)}>
              Next
            </PageLink>
          </div>
        </div>
      </div>
    </div>
  );
}

function pageHref(q: string, page: number) {
  const u = new URL("https://example.com/tracks");
  if (q) u.searchParams.set("q", q);
  u.searchParams.set("page", String(page));
  return `${u.pathname}?${u.searchParams.toString()}`;
}

function PageLink(props: { href: string; disabled?: boolean; children: React.ReactNode }) {
  if (props.disabled) {
    return (
      <span
        className="sb-ring inline-flex items-center justify-center rounded-full bg-white/60 px-4 py-2 text-xs font-medium opacity-50"
      >
        {props.children}
      </span>
    );
  }
  return (
    <Link
      href={props.href}
      className="sb-ring inline-flex items-center justify-center rounded-full bg-white/70 px-4 py-2 text-xs font-medium hover:bg-white"
    >
      {props.children}
    </Link>
  );
}

