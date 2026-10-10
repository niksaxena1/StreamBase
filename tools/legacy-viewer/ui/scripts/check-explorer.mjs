// Read-only live contract/performance check. Start the archive API first.
import assert from "node:assert/strict";
const base = `http://127.0.0.1:${process.env.LEGACY_API_PORT || 8765}`;
const timings = [];
async function get(path, params = {}) {
  const url = new URL(path, base);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.set(k, String(v)),
  );
  const start = performance.now(),
    response = await fetch(url),
    body = await response.json();
  assert.equal(response.status, 200, `${url.pathname}: ${body.error}`);
  timings.push({
    path: url.pathname,
    ms: Math.round(performance.now() - start),
  });
  return body;
}
const meta = await get("/api/meta");
assert.equal(meta.datasets.length, 2);
assert.ok(meta.followers.last_day && meta.scopes.length);
const exports = [];
for (const dataset of ["stats2", "stats"]) {
  const params = { dataset };
  const [overview, tracks, artists, playlists, milestones, quality] =
    await Promise.all([
      get("/api/explorer/overview", params),
      get("/api/explorer/tracks", { ...params, sort: "gained", limit: 10 }),
      get("/api/artists", { ...params, limit: 5 }),
      get("/api/explorer/playlists", params),
      get("/api/milestones", { ...params, limit: 5, exclude_lofi: 1 }),
      get("/api/quality", params),
    ]);
  assert.ok(overview.series.length && overview.method && overview.kpis);
  assert.ok(overview.series.some((r) => r.streams === null));
  assert.ok(tracks.total && artists.total && playlists.rows.length);
  assert.ok(
    "gained" in playlists.rows[0] && "observed_tracks" in playlists.rows[0],
  );
  assert.ok(milestones.summary.ladder.length && milestones.notes.length);
  assert.ok(
    quality.coverage.length &&
      quality.calendar_gaps.length &&
      quality.notes.length,
  );
  const track = tracks.rows[0],
    pid = playlists.rows[0].playlist_id,
    name = track.artist.split(",")[0].trim();
  const [detail, artist, playlist] = await Promise.all([
    get(`/api/track/${encodeURIComponent(track.isrc)}`, params),
    get(`/api/artist/${encodeURIComponent(name)}`, params),
    get(`/api/explorer/playlist/${pid}`, params),
  ]);
  assert.ok(
    detail.records.length &&
      detail.per_id.length &&
      detail.identity.isrc === track.isrc,
  );
  assert.ok(
    artist.tracks.length &&
      playlist.tracks.length &&
      playlist.method.includes("hourly"),
  );
  const day = detail.records[0].day,
    readings = await get(`/api/track/${track.isrc}/readings`, {
      ...params,
      day,
    });
  assert.ok(readings.rows.length && "mode_frequency" in readings.rows[0]);
  for (const grain of ["week", "month"]) {
    const series = await get(`/api/track/${track.isrc}`, { ...params, grain });
    assert.ok(
      series.series.length && series.series.every((r) => r.ma7 === null),
    );
  }
  exports.push(
    ...[
      "explorer_overview",
      "explorer_tracks",
      "artists",
      "explorer_playlists",
      "milestones",
      "quality_resets",
    ].map((view) => ({ ...params, view })),
    { ...params, view: "track_records", isrc: track.isrc },
    { ...params, view: "track", isrc: track.isrc, day },
    { ...params, view: "track", isrc: track.isrc, raw: 1 },
    { ...params, view: "artist", name },
    { ...params, view: "explorer_playlist", id: pid },
  );
}
const [followers, fp, accounts, archive] = await Promise.all([
  get("/api/followers/overview"),
  get("/api/followers/playlists", { limit: 5 }),
  get("/api/followers/accounts"),
  get("/api/archive"),
]);
assert.ok(
  followers.series.length &&
    followers.kpis.accounts &&
    accounts.rows.length &&
    archive.rows.length,
);
const followerId = fp.rows[0].playlist_id,
  shortRange = { from: "2026-08-15", to: meta.followers.last_day };
const fd = await get(`/api/followers/playlist/${followerId}`, shortRange);
assert.ok(fd.hourly.length && "daily_last" in fd.series[0]);
const unknown = meta.playlists.find((p) => p.name === null);
if (unknown) {
  await get(`/api/explorer/playlist/${unknown.playlist_id}`);
  await get("/api/explorer/overview", { scope: unknown.playlist_id });
  await get("/api/explorer/tracks", { scope: unknown.playlist_id, limit: 1 });
}
exports.push(
  ...[
    "followers_overview",
    "followers_playlists",
    "followers_accounts",
    "archive",
  ].map((view) => ({ view })),
  { view: "followers_playlist", id: followerId },
);
for (const params of exports) {
  const response = await fetch(
    new URL(`/api/export?${new URLSearchParams(params)}`, base),
    { method: "HEAD" },
  );
  assert.equal(response.status, 200, `CSV ${params.view}`);
  assert.match(response.headers.get("content-type"), /text\/csv/);
}
assert.ok(
  timings.every((t) => t.ms < 2000),
  `Queries over 2s: ${JSON.stringify(timings.filter((t) => t.ms >= 2000))}`,
);
console.log(
  JSON.stringify(
    {
      queries: timings.length,
      exports: exports.length,
      maxQueryMs: Math.max(...timings.map((t) => t.ms)),
      datasets: ["stats2", "stats", "followers"],
      passed: true,
    },
    null,
    2,
  ),
);
