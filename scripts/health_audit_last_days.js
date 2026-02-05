#!/usr/bin/env node
/**
 * SpotiBase - Health audit for recent ingestion days (Supabase).
 *
 * - Reads Supabase URL + service role key from environment variables, OR best-effort from `web/.env.local`.
 * - Queries ingestion_runs / ingestion_warnings / raw_exports / track_daily_streams / playlist_daily_stats.
 * - Prints a concise JSON report (no secrets).
 *
 * Usage:
 *   node scripts/health_audit_last_days.js --days 6
 */
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = { days: 6 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0 && n <= 90) out.days = Math.floor(n);
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

function readEnvFile(absPath) {
  /** @type {Record<string,string>} */
  const out = {};
  let txt = "";
  try {
    txt = fs.readFileSync(absPath, "utf8");
  } catch {
    return out;
  }
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2] ?? "";
    // Strip surrounding quotes
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadSupabaseCreds() {
  const env = process.env;
  let supabaseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  let serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (supabaseUrl && serviceKey) return { supabaseUrl, serviceKey, source: "process.env" };

  // Best-effort local dev env file (do not print it)
  const envLocalPath = path.resolve(process.cwd(), "web", ".env.local");
  const fileEnv = readEnvFile(envLocalPath);

  if (!supabaseUrl) supabaseUrl = String(fileEnv.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!serviceKey) serviceKey = String(fileEnv.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  return { supabaseUrl, serviceKey, source: "web/.env.local" };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function getJson(url, serviceKey) {
  const r = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 400));
  return JSON.parse(t || "[]");
}

async function getCount(url, serviceKey) {
  const r = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      Prefer: "count=exact",
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("HTTP " + r.status + " " + t.slice(0, 400));
  }
  // PostgREST returns e.g. `content-range: 0-0/123`
  const cr = r.headers.get("content-range") || "";
  const m = cr.match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: node scripts/health_audit_last_days.js --days 6");
    process.exit(0);
  }

  const { supabaseUrl, serviceKey, source } = loadSupabaseCreds();
  if (!supabaseUrl || !serviceKey) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: "Missing Supabase credentials (need URL + SUPABASE_SERVICE_ROLE_KEY).",
          hasUrl: Boolean(supabaseUrl),
          hasServiceKey: Boolean(serviceKey),
          lookedIn: ["process.env", "web/.env.local"],
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const base = supabaseUrl.replace(/\/+$/g, "") + "/rest/v1";

  // Playlist catalog-ness map (used to interpret missing_streams_track_count rows)
  const playlists = await getJson(
    base + "/playlists?select=playlist_key,is_catalog&limit=5000",
    serviceKey,
  );
  const isCatalogByKey = new Map(
    (Array.isArray(playlists) ? playlists : []).map((p) => [
      String(p.playlist_key || "").trim(),
      Boolean(p.is_catalog),
    ]),
  );

  // Pull enough runs to cover window + gaps
  const runs = await getJson(
    base + "/ingestion_runs?select=run_date,status,id&order=run_date.desc&limit=30",
    serviceKey,
  );

  if (!Array.isArray(runs) || runs.length === 0) {
    console.log(JSON.stringify({ ok: false, reason: "No ingestion_runs rows returned." }, null, 2));
    process.exit(1);
  }

  const latestRunDate = String(runs[0].run_date);
  const latestD = new Date(latestRunDate + "T00:00:00Z");
  /** @type {string[]} */
  const windowDates = [];
  for (let i = args.days - 1; i >= 0; i--) {
    const dd = new Date(latestD);
    dd.setUTCDate(dd.getUTCDate() - i);
    windowDates.push(isoDate(dd));
  }

  const runByDate = new Map(runs.map((r) => [String(r.run_date), r]));

  const report = {
    ok: true,
    credsSource: source,
    latestRunDate,
    windowDates,
    days: [],
  };

  for (const d of windowDates) {
    const run = runByDate.get(d) || null;
    if (!run) {
      report.days.push({ run_date: d, run_present: false });
      continue;
    }

    const runId = String(run.id);

    const critical = await getCount(
      base + "/ingestion_warnings?select=id&run_date=eq." + d + "&severity=eq.critical",
      serviceKey,
    );
    const warn = await getCount(
      base + "/ingestion_warnings?select=id&run_date=eq." + d + "&severity=eq.warn",
      serviceKey,
    );
    const info = await getCount(
      base + "/ingestion_warnings?select=id&run_date=eq." + d + "&severity=eq.info",
      serviceKey,
    );

    // Tally critical codes (small payload)
    const criticalRows = await getJson(
      base +
        "/ingestion_warnings?select=code,playlist_key&run_date=eq." +
        d +
        "&severity=eq.critical&limit=2000",
      serviceKey,
    );
    const critical_codes = {};
    for (const w of criticalRows || []) {
      const c = String((w && w.code) || "");
      critical_codes[c] = (critical_codes[c] || 0) + 1;
    }

    const raw_exports = await getCount(
      base + "/raw_exports?select=run_id&run_id=eq." + runId,
      serviceKey,
    );

    // Catalog snapshot size (sanity check)
    const catalog_snapshots = await getCount(
      base + "/track_daily_streams?select=isrc&date=eq." + d,
      serviceKey,
    );

    // Playlist stats coverage (sanity check)
    const playlist_stats_rows = await getCount(
      base + "/playlist_daily_stats?select=playlist_key&date=eq." + d,
      serviceKey,
    );
    const playlists_with_missing_streams = await getCount(
      base +
        "/playlist_daily_stats?select=playlist_key&date=eq." +
        d +
        "&missing_streams_track_count=gt.0&limit=1",
      serviceKey,
    );

    const missingStatsTop = await getJson(
      base +
        "/playlist_daily_stats?select=playlist_key,missing_streams_track_count,track_count&date=eq." +
        d +
        "&missing_streams_track_count=gt.0&order=missing_streams_track_count.desc&limit=25",
      serviceKey,
    );

    const missingStatsTopParsed = (Array.isArray(missingStatsTop) ? missingStatsTop : [])
      .map((r) => {
        const playlist_key = String(r.playlist_key || "").trim();
        const is_catalog = isCatalogByKey.has(playlist_key) ? Boolean(isCatalogByKey.get(playlist_key)) : null;
        const m = Number(r.missing_streams_track_count ?? 0);
        const t = Number(r.track_count ?? 0);
        return {
          playlist_key,
          is_catalog,
          missing_streams_track_count: Number.isFinite(m) ? m : null,
          track_count: Number.isFinite(t) ? t : null,
        };
      })
      .filter((x) => Boolean(x.playlist_key));

    // Pull "missing-related" warning rows explicitly (helps answer: "missing tracks not reported")
    const missingRelatedWarnings = await getJson(
      base +
        "/ingestion_warnings?select=severity,code,playlist_key&run_date=eq." +
        d +
        "&code=in.(non_catalog_tracks_present,catalog_missing_stream_snapshots,catalog_streams_missing_prev_nonzero,total_streams_decreased,missing_export,zero_row_export,min_rows_failed,track_count_swing_hard_fail)",
      serviceKey,
    );

    const missingRelated = {
      non_catalog_tracks_present: [], // { playlist_key, severity }
      catalog_missing_stream_snapshots: false,
      catalog_streams_missing_prev_nonzero: false,
      total_streams_decreased: [], // { playlist_key, severity }
    };

    for (const w of Array.isArray(missingRelatedWarnings) ? missingRelatedWarnings : []) {
      const code = String(w.code || "").trim();
      const pk = w.playlist_key == null ? null : String(w.playlist_key || "").trim();
      const sev = String(w.severity || "").trim();
      if (code === "non_catalog_tracks_present" && pk)
        missingRelated.non_catalog_tracks_present.push({ playlist_key: pk, severity: sev });
      if (code === "total_streams_decreased" && pk)
        missingRelated.total_streams_decreased.push({ playlist_key: pk, severity: sev });
      if (code === "catalog_missing_stream_snapshots") missingRelated.catalog_missing_stream_snapshots = true;
      if (code === "catalog_streams_missing_prev_nonzero") missingRelated.catalog_streams_missing_prev_nonzero = true;
    }

    const missingNonCatalog = missingStatsTopParsed
      .filter((r) => r.is_catalog === false && (r.missing_streams_track_count || 0) > 0)
      .map((r) => r.playlist_key);
    const warnedNonCatalogCritical = missingRelated.non_catalog_tracks_present
      .filter((x) => x.severity === "critical")
      .map((x) => x.playlist_key);
    const warnedNonCatalogAny = missingRelated.non_catalog_tracks_present.map((x) => x.playlist_key);

    const missingNonCatalogSet = new Set(missingNonCatalog);
    const warnedCriticalSet = new Set(warnedNonCatalogCritical);
    const warnedAnySet = new Set(warnedNonCatalogAny);
    const missingNonCatalogNotWarnedCritical = Array.from(missingNonCatalogSet)
      .filter((k) => !warnedCriticalSet.has(k))
      .sort();
    const missingNonCatalogNotWarnedAny = Array.from(missingNonCatalogSet)
      .filter((k) => !warnedAnySet.has(k))
      .sort();

    report.days.push({
      run_date: d,
      run_present: true,
      status: String(run.status || ""),
      critical_warnings: critical,
      warn_warnings: warn,
      info_warnings: info,
      raw_exports,
      catalog_snapshots,
      playlist_stats_rows,
      playlists_with_missing_streams_count: playlists_with_missing_streams,
      missing_streams_top: missingStatsTopParsed.slice(0, 10),
      missing_related_warnings: {
        non_catalog_tracks_present: missingRelated.non_catalog_tracks_present
          .slice()
          .sort((a, b) => (a.playlist_key + a.severity).localeCompare(b.playlist_key + b.severity)),
        total_streams_decreased: missingRelated.total_streams_decreased
          .slice()
          .sort((a, b) => (a.playlist_key + a.severity).localeCompare(b.playlist_key + b.severity)),
        catalog_missing_stream_snapshots: missingRelated.catalog_missing_stream_snapshots,
        catalog_streams_missing_prev_nonzero: missingRelated.catalog_streams_missing_prev_nonzero,
      },
      missing_non_catalog_not_warned: {
        compared_against: "ingestion_warnings.code=non_catalog_tracks_present",
        not_warned_critical: missingNonCatalogNotWarnedCritical,
        not_warned_any_severity: missingNonCatalogNotWarnedAny,
      },
      critical_codes,
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 2));
  process.exit(1);
});

