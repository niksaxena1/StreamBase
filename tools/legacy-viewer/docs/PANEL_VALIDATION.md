# Original dashboards - panel validation (DuckDB vs PostgreSQL)

Generated 2026-10-04T06:27:02Z by `build/validate_panels.py`. Raw per-case results: `.tmp/legacy-build/panel_validation_results.jsonl`, aggregate: `.tmp/legacy-build/panel_validation.json`.

## Method

* **Oracle**: the original Grafana SQL executed unchanged in the restored PostgreSQL 17.11 databases (`stats2`, `stats_old`, `playlistfollowers`; all C locale), session `TimeZone=UTC`, read-only, after Grafana 11 variable interpolation (`grafana_compat.interpolate`: SQL-datasource formatter, `${var:csv}`, `${var:raw}`, `${var:sqlstring}`, multi/includeAll, custom `allValue`).
* **Candidate**: the registry's `duckdb_sql` (deterministic rewrite of the same SQL, see rules below) executed on DuckDB 1.5.6 with the same interpolation, PostgreSQL NULL ordering (`default_null_order=nulls_last_on_asc_first_on_desc`) and the same anchor.
* **Anchor**: Grafana evaluated `NOW()` / `CURRENT_DATE` at view time. Both engines use a fixed anchor = the dataset's last observation (stats2 `2025-12-22 12:31:38.698682`, stats subset `2025-03-10 08:35:26.881731`, followers `2026-09-01 14:10:34.83615`): PG side `NOW()` -> `TIMESTAMPTZ '<anchor>+00'`, `CURRENT_DATE` -> `DATE '<anchor date>'`; DuckDB side `anchor_now()` / `anchor_date()` macros.
* **Equality**: same column names (case-sensitive, in order), same row count, cell-wise equality; integers / decimals / text / dates **exactly**; columns where either engine returns a float (e.g. `AVG`, numeric division) use relative tolerance 1e-9 (absolute floor 1e-9). Timestamps compared as UTC wall-clock values.
* **Ties**: when the SQL's ORDER BY / ROW_NUMBER is not total the result is not defined in either engine. Statuses: `pass` exact ordered equality; `pass_unordered` same rows, order differs only inside ties (the projected ORDER BY keys are compared exactly when they can be mapped to output columns); `pass_topn_ties` LIMIT cuts inside a tie group (everything strictly above the boundary key is identical); `pass_tiebreak` original results differ but a **tie-broken variant** (extra ORDER BY columns added to BOTH the original and the translated SQL, listed per rule below) is exactly equal; `pass_unicode_oracle` the C-locale PG and a Unicode-case-folding PG differ for this ILIKE value and the translation equals the latter (see ILIKE below); `pass_both_error` both engines reject the SQL (the original panel is broken, or a value breaks the quoting); `fail` anything else.
* **ILIKE and locale**: the restored clusters are C-locale (ILIKE folds ASCII only) but the production servers ran `C.UTF-8` (`lc_*` / `LANG` in the stats server's postgresql.conf; stats2 is the same provider/OS), whose ctype is Unicode-aware, so a value like `RÖ` matched `Rö` in Grafana. The default translation keeps DuckDB's Unicode-aware ILIKE (`grafana_compat.ILIKE_MODE = "unicode"`). Every ILIKE target also has a `duckdb_sql_c_locale` variant (rule R9, ASCII-only folding) which is validated **exactly** against the real restored C-locale PG; wherever the two DuckDB variants return different data, the default translation is validated against PG using an ICU collation on the ILIKE operand (Unicode folding), reported as `pass_unicode_oracle`.

## Result

**6641 cases run, 6641 pass, 0 fail.**

| status | cases |
|---|---|
| pass | 6311 |
| pass_unordered | 225 |
| pass_topn_ties | 52 |
| pass_tiebreak | 31 |
| pass_unicode_oracle | 9 |
| pass_both_error | 13 |
| fail | 0 |

| dashboard | panels | targets | cases | exact pass | unordered / topn / tiebreak | both error | fail |
|---|---|---|---|---|---|---|---|
| stats2.spotify-dash | 57 | 58 | 3254 | 3197 | 44 / 0 / 4 | 0 | 0 |
| stats2.tax-v2 | 55 | 55 | 577 | 422 | 126 / 6 / 23 | 0 | 0 |
| stats2.tax-old | 30 | 30 | 30 | 24 | 4 / 0 / 1 | 1 | 0 |
| stats.spotify-dash | 40 | 40 | 405 | 400 | 4 / 0 / 1 | 0 | 0 |
| stats.tax-v2 | 6 | 6 | 42 | 38 | 2 / 0 / 2 | 0 | 0 |
| pf.playlist-followers | 52 | 52 | 2333 | 2230 | 45 / 46 / 0 | 12 | 0 |

## Variable samples

* **stats2 artist/track variables**: 196 artists and 410 (artist, track) pairs per artist-panel; hard-case artists (104): apostrophes/quotes/commas/non-ASCII (ø é Æ Ö ...), HTML-entity names, substrings of other artists, 'Never Giving Up' / 'Never Giving Up Again', plus the empty-result artist `Nonexistent Artist ZZZ`. Pair trait counts: `{"multiple playlists": 22, "first seen late": 22, "reset (play_count decrease)": 7, "gaps": 3}` (single-observation tracks, tracks in several playlists, tracks first seen late, tracks with gaps, tracks with counter resets).
* **stats artist/track variables**: 71 artists and 86 (artist, track) pairs per artist-panel; hard-case artists (83): apostrophes/quotes/commas/non-ASCII (ø é Æ Ö ...), HTML-entity names, substrings of other artists, 'Never Giving Up' / 'Never Giving Up Again', plus the empty-result artist `Nonexistent Artist ZZZ`. Pair trait counts: `{"multiple playlists": 8, "first seen late": 8, "reset (play_count decrease)": 6, "gaps": 2}` (single-observation tracks, tracks in several playlists, tracks first seen late, tracks with gaps, tracks with counter resets).
* **Tax V2**: every `person` option (5) and every `playlist_id` option (23); `month` multi-select sets: saved default (Apr..Jan 2025), single months, two/six months, all months, last two months.
* **Playlist Followers**: every stamped per-playlist panel instance (all dashboard-group playlists), 49 accounts, >= 60 (account, playlist) pairs incl. special-character names, and `$account = $__all` (custom allValue 'All' => both engines reject).
* Single-quote handling: single-value variables are interpolated with `'` -> `''` (Grafana 11 `@grafana/sql` formatter); multi/includeAll variables via `quoteLiteral`. Artists with apostrophes therefore run (and must match).

## Translation rules (PostgreSQL -> DuckDB)

Applied by `grafana_compat.translate_pg_to_duckdb` to the SQL template (before interpolation). Everything else in the corpus is accepted by DuckDB unchanged.

* **R0 lowercase identifiers** - used by 244 targets
* **R1 E-string decode** - used by 1 targets
* **R2 NOW()/CURRENT_DATE anchored** - used by 81 targets
* **R3 string_to_array macro** - used by 18 targets
* **R4 to_char/to_date -> strftime/strptime** - used by 42 targets
* **R5 unnest alias names the column** - used by 4 targets
* **R6 FLOAT is float8 in PG** - used by 2 targets
* **R6 unconstrained numeric -> DECIMAL(38,10)** - used by 6 targets
* **R8 round -> exact decimal pg_round** - used by 2 targets
* **R9 ILIKE -> ASCII-folded LIKE (C-locale PG semantics)** - used by 23 targets

Reasons (all verified empirically in DuckDB 1.5.6 / PG 17):

* R0: PostgreSQL folds unquoted identifiers to lower case; DuckDB echoes the typed case in result column names (`SELECT x AS Foo`).
* R1: DuckDB mis-decodes `E',\\s*'` (drops the backslash: `,s*`); PG yields `,\s*`. E-strings are decoded with PG rules and re-emitted as standard literals.
* R2: fixed anchor, see Method. `date - interval` / `date_trunc` types agree with PG (both give timestamps).
* R3: PG `string_to_array('', ',')` is `{}`, DuckDB `string_split('', ',')` is `['']` (a macro keeps PG semantics, NULL stays NULL).
* R4: DuckDB has no `to_char`/`to_date`. Supported patterns: YYYY YY MM Mon DD HH24 HH12 MI SS Dy AM/PM and quoted text; anything else raises at build time.
* R5: `FROM unnest(x) AS m` names the *column* in PG; in DuckDB `m` would be the table (a struct), so the column alias is added.
* R6: PG `FLOAT` is float8 (DuckDB `FLOAT` is float4); an unconstrained PG `numeric` cast is `DECIMAL(18,3)` by default in DuckDB which would truncate.
* R8: PG rounds `numeric` half away from zero on the exact decimal; DuckDB `round(double)` works on the binary float. `pg_round` casts to `DECIMAL(38,12)` first. Defensive: an exact .xx5 tie of `ROUND(AVG(growth*0.002),2)` is possible in principle; in the 6 Tax V2 Daily samples tested (2,333 rows, tie-broken) plain `round()` gave identical values, so no measured difference.
* R9 (only in the `duckdb_sql_c_locale` validation variants, count above = targets carrying one): `a [NOT] ILIKE b` -> `ascii_lower(a) [NOT] LIKE ascii_lower(b)`. The shipped default keeps native ILIKE (production C.UTF-8 semantics); see ILIKE and locale in Method. `\` is PG's default LIKE escape, DuckDB has none: irrelevant here (no backslash in any artist/song value).
* Session: `default_null_order=nulls_last_on_asc_first_on_desc` reproduces PG NULL ordering for every ORDER BY / window; `search_path` = dataset schema.
* Not rewritten (checked): `/` is always numeric division in this corpus (no integer division), `DATE(x)`, `::date`, `INTERVAL`, `DISTINCT ON`, `LATERAL`, `VALUES ... AS t(a,b)`, `= ANY(array)`, `ARRAY(subquery)`, `FILTER`, `percentile_cont`, `regexp_split_to_table`, `position(a in b)`, `ILIKE`, `trim(both x from y)`, `CAST(.. AS DATE)`.

### Manual translations

* **explicit window order** (12 targets: `stats2.spotify-dash.77`, `stats2.spotify-dash.163`, `stats2.spotify-dash.53`, `stats2.spotify-dash.46`, `stats2.spotify-dash.47`, `stats2.tax-old.7`, `stats2.tax-old.14`, `stats2.tax-old.39`, `stats.spotify-dash.64`, `stats.spotify-dash.48`, `stats.spotify-dash.45`, `stats.spotify-dash.44`): AVG(stream_diff) OVER (ROWS BETWEEN 6 PRECEDING ...) has no ORDER BY: PG inherits the day order of the preceding CTE, DuckDB gives no such guarantee, so ORDER BY day is made explicit (same rows, same frame)
* **semi-join instead of cross join + = ANY(list)** (3 targets: `stats2.tax-v2.66`, `stats2.tax-v2.67`, `stats2.tax-v2.64`): performance only: `FROM tracks t CROSS JOIN vars v WHERE t.playlist_id = ANY (v.sel_playlists)` evaluates list_contains per row of the 34M-row table (13 s, single threaded); the equivalent `t.playlist_id IN (SELECT unnest(sel_playlists) FROM vars)` is a hash semi-join (0.5 s). Identical rows (checked in validation).

## Nondeterministic panels (ties the SQL does not define)

These originals can legitimately return different rows in different engines (or on re-runs); the translation reproduces the SQL, and equality is proven on the tie-broken variants. `cases` = cases that actually needed the fallback.

| panel | title | rules | cases needing fallback | note |
|---|---|---|---|---|
| `stats2.spotify-dash.94` A | Top Tracks: Total Streams | row_number_ties_created_at | 6 of 196 (unordered 6, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.93` A | Top Tracks: Daily Streams | - | 17 of 196 (unordered 17, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.93` B | Top Tracks: Daily Streams | - | 7 of 196 (unordered 7, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.28` A | Groove Bassment Releases: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.spotify-dash.29` A | Gahara Releases: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.spotify-dash.6` A | Latest Milestones | row_number_ties_created_at | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.17` A | Milestones (Last 1 Day) | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.95` A | Milestones (Last 30 Days) | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.74` A | Releases: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.spotify-dash.54` A | Milestones (Last 7 Days) | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.98` A | Milestones 1M+ (Since Forever) | milestone_rank_ties | 1 of 1 (unordered 0, topn 0, tiebreak 1) | milestone ranking inside an hour: several rows share the same milestone / play_count, the kept row (and its created_at) is arbitrary |
| `stats2.spotify-dash.27` A | Extended: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.spotify-dash.124` A | Latest Milestones | row_number_ties_created_at | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.126` A | Milestones (Last 1 Day) | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.127` A | Milestones (Last 30 Days) | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.128` A | Milestones (Last 7 Days) | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.161` A | Milestones (Last 30 Days) - Only the Highest Miles | milestone_rank_ties | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.129` A | Milestones 1M+ (Since Forever) | milestone_rank_ties | 1 of 1 (unordered 0, topn 0, tiebreak 1) | milestone ranking inside an hour: several rows share the same milestone / play_count, the kept row (and its created_at) is arbitrary |
| `stats2.spotify-dash.162` A | Filter 06/03/2022 | - | 1 of 196 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.spotify-dash.69` A | Tracks Per Artist | rank_ties | 1 of 1 (unordered 0, topn 0, tiebreak 1) | ROW_NUMBER() OVER (ORDER BY COUNT(...) DESC): artists with the same track count get their ranks (and rank labels) in arbitrary order |
| `stats2.tax-v2.15` A | ${person}: Total | - | 5 of 5 (unordered 5, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.spotify-dash.49` A | Database View | limit_without_order | 1 of 1 (unordered 0, topn 0, tiebreak 1) | LIMIT without ORDER BY: which rows are returned is the engine's physical order |
| `stats2.tax-v2.6` A | ${person}: Daily | max_freq_day_ties | 5 of 5 (unordered 0, topn 0, tiebreak 5) | MAX(freq) join returns several rows for a day when hourly totals tie; LAG()/moving average over duplicate days depend on their arbitrary order |
| `stats2.tax-v2.1` A | ${playlist_id}: Total | - | 18 of 23 (unordered 18, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.tax-v2.16` A | ${playlist_id}: Daily | max_freq_day_ties | 18 of 23 (unordered 0, topn 0, tiebreak 18) | MAX(freq) join returns several rows for a day when hourly totals tie; LAG()/moving average over duplicate days depend on their arbitrary order |
| `stats2.tax-v2.34` A | ${playlist_id} Tracks Removed | - | 10 of 23 (unordered 10, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.tax-v2.53` A | ${person}: Total | - | 5 of 5 (unordered 5, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.tax-old.48` A | EmuBands: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.tax-old.44` A | GHR Records RouteNote: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.tax-old.25` A | GB RouteNote: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.tax-old.36` A | Prelude RouteNote: Total | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order |
| `stats2.tax-old.24` A | Comparison: Streams | row_number_ties_created_at | 1 of 1 (unordered 0, topn 0, tiebreak 1) | ROW_NUMBER() OVER (... ORDER BY created_at DESC) keeps one of several rows with an identical created_at (duplicate/colliding track rows) |
| `stats2.tax-v2.60` A | Track Repetition Detection | limit_ties | 1 of 1 (unordered 0, topn 1, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats.spotify-dash.82` A | Treemap | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats.spotify-dash.105` A | Total Streams vs Daily Streams (manually excluding | row_number_ties_created_at | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats.spotify-dash.89` A | Total Streams vs Daily Streams | row_number_ties_created_at | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats.spotify-dash.101` A | Top Artists: Total Streams | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats.tax-v2.20` A | ${person}: Tracks | row_number_ties_created_at | 2 of 5 (unordered 0, topn 0, tiebreak 2) | ROW_NUMBER() OVER (... ORDER BY created_at DESC) keeps one of several rows with an identical created_at (duplicate/colliding track rows) |
| `stats.tax-v2.34` A | ${playlist_id} Tracks Removed | - | 2 of 17 (unordered 2, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.95` A | Least Followed Playlists | row_number_ties_timestamp | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.69` A | Fastest Growing Accounts | row_number_ties_timestamp | 1 of 1 (unordered 0, topn 1, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.77` A | $account - Most Followed Playlists | row_number_ties_timestamp | 13 of 50 (unordered 10, topn 3, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.88` A | $account - Fastest Growing Playlists | row_number_ties_timestamp | 32 of 50 (unordered 13, topn 19, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.97` A | $account - Least Followed Playlists | row_number_ties_timestamp | 5 of 50 (unordered 3, topn 2, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.96` A | $account - Slowest Growing Playlists | row_number_ties_timestamp | 34 of 50 (unordered 16, topn 18, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.90` A | All Playlists | row_number_ties_timestamp | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.1` A | Simple Table | - | 1 of 1 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.102` A | Fastest Growing Playlists (w/o London Grams) | row_number_ties_timestamp | 1 of 1 (unordered 0, topn 1, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.94` A | Slowest Growing Playlists | row_number_ties_timestamp | 1 of 1 (unordered 0, topn 1, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `pf.playlist-followers.67` A | Fastest Growing Playlists | row_number_ties_timestamp | 1 of 1 (unordered 0, topn 1, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.tax-v2.66` A | Top Artists / $person: $month | mode_ties_same_id | 34 of 40 (unordered 32, topn 2, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.tax-v2.67` A | Top Artists / $playlist_id: $month | mode_ties_same_id | 52 of 115 (unordered 49, topn 3, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.tax-v2.64` A | Top Tracks / $person: $month | mode_ties_same_id | 1 of 40 (unordered 1, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats2.tax-v2.65` A | Top Tracks / $playlist_id: Streams In $month | mode_ties_same_id | 6 of 115 (unordered 6, topn 0, tiebreak 0) | ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT) |
| `stats.spotify-dash.106` A | Top Artists: Streams since 1st Sep | mode_ties_same_id | 1 of 1 (unordered 0, topn 0, tiebreak 1) | daily mode per Spotify id: when one id has several (song_name, artist) spellings with the same frequency and play_count on a day, ROW_NUMBER() OVER (PARTITION BY day, spo |

Statically flagged as tie-prone (a rule in `extract_panels.py` matched) but no tie changed the result in any validated sample: `stats2.spotify-dash.2`, `stats2.spotify-dash.96`, `stats2.tax-old.19`, `stats2.tax-old.38`, `stats.spotify-dash.104`, `stats.spotify-dash.103`, `pf.playlist-followers.5`, `pf.playlist-followers.51`, `pf.playlist-followers.66`, `pf.playlist-followers.11`, `pf.playlist-followers.68`, `pf.playlist-followers.2`, `pf.playlist-followers.40`, `pf.playlist-followers.63`, `pf.playlist-followers.53`, `pf.playlist-followers.54`, `pf.playlist-followers.tpl-d1964f69cc`, `pf.playlist-followers.62`, `pf.playlist-followers.tpl-be42e9b7c2`, `pf.playlist-followers.tpl-519ba80f43`, `pf.playlist-followers.45`, `pf.playlist-followers.46`, `pf.playlist-followers.47`, `pf.playlist-followers.48`, `pf.playlist-followers.430`, `pf.playlist-followers.437`, `pf.playlist-followers.296`, `pf.playlist-followers.540`.

## Failures

None.

## Per-panel results

Timings are wall-clock medians (max) per case measured while 12 validation workers x 4 DuckDB threads shared the machine and PostgreSQL, so they are upper bounds, not interactive latencies (e.g. an artist ILIKE scan is ~50 ms alone on DuckDB). The two Top Artists/Top Tracks panels with `= ANY(list)` were 13-30 s before the semi-join patch and ~0.5 s after.

| panel | title | ref | cases | statuses | PG median (max) | DuckDB median (max) | max rows |
|---|---|---|---|---|---|---|---|
| `stats2.spotify-dash.18` | Table: ${artist_name} | A | 196 | pass 195, pass_unicode_oracle 1 | 0.11s (35.0s) | 0.69s (1.3s) | 9 |
| `stats2.spotify-dash.24` | Total Streams: ${artist_name} | A | 196 | pass 195, pass_unicode_oracle 1 | 0.07s (26.5s) | 0.75s (1.5s) | 863 |
| `stats2.spotify-dash.94` | Top Tracks: Total Streams | A | 196 | pass 189, pass_unicode_oracle 1, pass_unordered 6 | 0.01s (0.3s) | 0.01s (0.1s) | 100 |
| `stats2.spotify-dash.25` | Daily Streams: ${artist_name} | A | 196 | pass 195, pass_unicode_oracle 1 | 0.07s (29.7s) | 0.70s (1.2s) | 862 |
| `stats2.spotify-dash.93` | Top Tracks: Daily Streams | A | 196 | pass 178, pass_unicode_oracle 1, pass_unordered 17 | 0.07s (30.3s) | 0.73s (1.4s) | 100 |
| `stats2.spotify-dash.93` | Top Tracks: Daily Streams | B | 196 | pass 188, pass_unicode_oracle 1, pass_unordered 7 | 0.01s (0.3s) | 0.75s (1.5s) | 100 |
| `stats2.spotify-dash.33` | Table: ${artist_name} - ${track_name} | A | 410 | pass 410 | 0.02s (0.2s) | 0.11s (0.3s) | 10 |
| `stats2.spotify-dash.31` | Total Streams: ${artist_name} - ${track_name} | A | 410 | pass 409, pass_unicode_oracle 1 | 0.05s (0.4s) | 0.50s (1.4s) | 861 |
| `stats2.spotify-dash.34` | Daily Streams: ${artist_name} - ${track_name} | A | 410 | pass 410 | 0.03s (0.2s) | 0.13s (0.3s) | 861 |
| `stats2.spotify-dash.41` | Groove Bassment Releases: Daily | A | 1 | pass 1 | 1.17s (1.2s) | 0.08s (0.1s) | 849 |
| `stats2.spotify-dash.28` | Groove Bassment Releases: Total | A | 1 | pass_unordered 1 | 1.23s (1.2s) | 0.14s (0.1s) | 916 |
| `stats2.spotify-dash.29` | Gahara Releases: Total | A | 1 | pass_unordered 1 | 1.53s (1.5s) | 0.09s (0.1s) | 942 |
| `stats2.spotify-dash.42` | Gahara Releases: Daily | A | 1 | pass 1 | 1.46s (1.5s) | 0.16s (0.2s) | 846 |
| `stats2.spotify-dash.6` | Latest Milestones | A | 1 | pass_unordered 1 | 0.01s (0.0s) | 0.00s (0.0s) | 14 |
| `stats2.spotify-dash.17` | Milestones (Last 1 Day) | A | 1 | pass_unordered 1 | 0.02s (0.0s) | 0.01s (0.0s) | 14 |
| `stats2.spotify-dash.95` | Milestones (Last 30 Days) | A | 1 | pass_unordered 1 | 0.02s (0.0s) | 0.02s (0.0s) | 448 |
| `stats2.spotify-dash.74` | Releases: Total | A | 1 | pass_unordered 1 | 1.72s (1.7s) | 0.18s (0.2s) | 950 |
| `stats2.spotify-dash.54` | Milestones (Last 7 Days) | A | 1 | pass_unordered 1 | 0.03s (0.0s) | 0.02s (0.0s) | 104 |
| `stats2.spotify-dash.78` | Releases: Daily | A | 1 | pass 1 | 1.62s (1.6s) | 0.25s (0.2s) | 845 |
| `stats2.spotify-dash.10` | Tracks Per Milestone | A | 1 | pass 1 | 0.04s (0.0s) | 0.01s (0.0s) | 42 |
| `stats2.spotify-dash.163` | Releases: Avg Daily | A | 1 | pass 1 | 1.68s (1.7s) | 0.24s (0.2s) | 846 |
| `stats2.spotify-dash.98` | Milestones 1M+ (Since Forever) | A | 1 | pass_tiebreak 1 | 0.03s (0.0s) | 0.03s (0.0s) | 12843 |
| `stats2.spotify-dash.27` | Extended: Total | A | 1 | pass_unordered 1 | 2.21s (2.2s) | 0.13s (0.1s) | 941 |
| `stats2.spotify-dash.2` | Top Tracks: Total Streams | A | 1 | pass 1 | 0.03s (0.0s) | 0.02s (0.0s) | 100 |
| `stats2.spotify-dash.46` | Groove Bassment Releases: Avg Daily | A | 1 | pass 1 | 0.97s (1.0s) | 0.17s (0.2s) | 850 |
| `stats2.spotify-dash.124` | Latest Milestones | A | 1 | pass_unordered 1 | 0.02s (0.0s) | 0.00s (0.0s) | 14 |
| `stats2.spotify-dash.40` | Extended: Daily | A | 1 | pass 1 | 2.15s (2.1s) | 0.22s (0.2s) | 844 |
| `stats2.spotify-dash.126` | Milestones (Last 1 Day) | A | 1 | pass_unordered 1 | 0.04s (0.0s) | 0.04s (0.0s) | 14 |
| `stats2.spotify-dash.127` | Milestones (Last 30 Days) | A | 1 | pass_unordered 1 | 0.04s (0.0s) | 0.05s (0.0s) | 392 |
| `stats2.spotify-dash.75` | Releases + Extended: Total | A | 1 | pass 1 | 2.44s (2.4s) | 0.50s (0.5s) | 850 |
| `stats2.spotify-dash.128` | Milestones (Last 7 Days) | A | 1 | pass_unordered 1 | 0.03s (0.0s) | 0.05s (0.1s) | 96 |
| `stats2.spotify-dash.47` | Gahara Releases: Avg Daily | A | 1 | pass 1 | 1.11s (1.1s) | 0.22s (0.2s) | 847 |
| `stats2.spotify-dash.76` | Releases + Extended: Daily | A | 1 | pass 1 | 2.44s (2.4s) | 0.66s (0.7s) | 850 |
| `stats2.spotify-dash.161` | Milestones (Last 30 Days) - Only the Highest Mil | A | 1 | pass_unordered 1 | 0.06s (0.1s) | 0.05s (0.1s) | 292 |
| `stats2.spotify-dash.77` | Releases + Extended: Avg Daily | A | 1 | pass 1 | 2.44s (2.4s) | 0.83s (0.8s) | 850 |
| `stats2.spotify-dash.129` | Milestones 1M+ (Since Forever) | A | 1 | pass_tiebreak 1 | 0.04s (0.0s) | 0.06s (0.1s) | 10398 |
| `stats2.spotify-dash.53` | Extended: Avg Daily | A | 1 | pass 1 | 1.93s (1.9s) | 0.13s (0.1s) | 845 |
| `stats2.spotify-dash.85` | Releases | A | 1 | pass 1 | 0.83s (0.8s) | 0.16s (0.2s) | 26 |
| `stats2.spotify-dash.162` | Filter 06/03/2022 | A | 196 | pass 195, pass_unordered 1 | 0.18s (3.8s) | 0.16s (0.4s) | 4 |
| `stats2.spotify-dash.86` | Extended | A | 1 | pass 1 | 0.86s (0.9s) | 0.17s (0.2s) | 26 |
| `stats2.spotify-dash.87` | Groove Bassment Releases | A | 1 | pass 1 | 1.12s (1.1s) | 0.13s (0.1s) | 28 |
| `stats2.spotify-dash.88` | Gahara Releases | A | 1 | pass 1 | 1.45s (1.5s) | 0.16s (0.2s) | 27 |
| `stats2.spotify-dash.83` | Releases + Extended | A | 1 | pass 1 | 1.83s (1.8s) | 0.51s (0.5s) | 26 |
| `stats2.spotify-dash.92` | No. of In-House Tracks | A | 1 | pass 1 | 11.24s (11.2s) | 1.15s (1.2s) | 1 |
| `stats2.spotify-dash.80` | Top Tracks: Daily Streams | A | 1 | pass 1 | 19.57s (19.6s) | 2.40s (2.4s) | 100 |
| `stats2.spotify-dash.61` | Test | A | 1 | pass 1 | 0.19s (0.2s) | 0.12s (0.1s) | 13466 |
| `stats2.spotify-dash.111` | Total Streams: ${artist_name} | A | 196 | pass 195, pass_unicode_oracle 1 | 0.13s (22.7s) | 0.76s (3.9s) | 90045 |
| `stats2.spotify-dash.58` | Groove Bassment Releases | A | 1 | pass 1 | 4.70s (4.7s) | 1.17s (1.2s) | 12003 |
| `stats2.spotify-dash.59` | Gahara Releases | A | 1 | pass 1 | 6.30s (6.3s) | 0.56s (0.6s) | 11487 |
| `stats2.spotify-dash.90` | No. of Artists | A | 1 | pass 1 | 29.42s (29.4s) | 1.49s (1.5s) | 1 |
| `stats2.spotify-dash.55` | Releases | A | 1 | pass 1 | 10.90s (10.9s) | 1.39s (1.4s) | 10347 |
| `stats2.spotify-dash.57` | Extended | A | 1 | pass 1 | 11.59s (11.6s) | 2.98s (3.0s) | 10214 |
| `stats2.spotify-dash.91` | No. of Tracks | A | 1 | pass 1 | 37.40s (37.4s) | 1.06s (1.1s) | 1 |
| `stats2.spotify-dash.108` | Total Streams: ${artist_name} - ${track_name} | A | 410 | pass 409, pass_unicode_oracle 1 | 0.09s (0.5s) | 0.57s (2.6s) | 37261 |
| `stats2.spotify-dash.96` | Filter 06/09/2023 | A | 1 | pass 1 | 82.79s (82.8s) | 6.30s (6.3s) | 182 |
| `stats2.spotify-dash.69` | Tracks Per Artist | A | 1 | pass_tiebreak 1 | 64.79s (64.8s) | 3.18s (3.2s) | 1357 |
| `stats2.tax-v2.15` | ${person}: Total | A | 5 | pass_unordered 5 | 0.57s (1.0s) | 0.72s (1.4s) | 3768 |
| `stats2.spotify-dash.49` | Database View | A | 1 | pass_tiebreak 1 | 0.14s (0.1s) | 0.21s (0.2s) | 100000 |
| `stats2.tax-v2.6` | ${person}: Daily | A | 5 | pass_tiebreak 5 | 0.23s (0.5s) | 0.34s (1.1s) | 757 |
| `stats2.tax-v2.17` | ${person}: In | A | 5 | pass 5 | 1.47s (3.4s) | 0.28s (0.3s) | 20 |
| `stats2.tax-v2.22` | ${person}: No. of Tracks | A | 5 | pass 5 | 2.51s (5.3s) | 0.24s (0.5s) | 1 |
| `stats2.tax-v2.33` | ${person}: No. of Playlists | A | 5 | pass 5 | 0.14s (0.3s) | 0.08s (0.2s) | 1 |
| `stats2.tax-v2.18` | ${person}: Since | A | 5 | pass 5 | 1.48s (3.3s) | 0.28s (0.4s) | 20 |
| `stats2.tax-v2.19` | ${person}: In (Graph) | A | 5 | pass 5 | 1.55s (3.1s) | 0.30s (0.4s) | 20 |
| `stats2.tax-v2.21` | ${person}: No. of Tracks | A | 5 | pass 5 | 0.64s (1.4s) | 0.18s (0.4s) | 85 |
| `stats2.tax-v2.20` | ${person}: Tracks | A | 5 | pass 5 | 3.69s (8.1s) | 1.07s (1.4s) | 2240 |
| `stats2.tax-v2.1` | ${playlist_id}: Total | A | 23 | pass 5, pass_unordered 18 | 0.02s (0.3s) | 0.03s (0.1s) | 623 |
| `stats2.tax-v2.16` | ${playlist_id}: Daily | A | 23 | pass 5, pass_tiebreak 18 | 0.02s (0.2s) | 0.07s (0.1s) | 623 |
| `stats2.tax-v2.2` | ${playlist_id}: In | A | 23 | pass 23 | 0.05s (1.5s) | 0.05s (0.3s) | 19 |
| `stats2.tax-v2.4` | ${playlist_id}: Since | A | 23 | pass 23 | 0.06s (1.5s) | 0.06s (0.2s) | 19 |
| `stats2.tax-v2.5` | ${playlist_id}: In (Graph) | A | 23 | pass 23 | 0.05s (1.5s) | 0.07s (0.3s) | 19 |
| `stats2.tax-v2.9` | ${playlist_id} Tracks | A | 23 | pass 23 | 0.13s (3.1s) | 0.10s (0.9s) | 1674 |
| `stats2.tax-v2.10` | ${playlist_id}: No. of Tracks | A | 23 | pass 23 | 0.02s (0.6s) | 0.05s (0.3s) | 41 |
| `stats2.tax-v2.34` | ${playlist_id} Tracks Removed | A | 23 | pass 13, pass_unordered 10 | 0.04s (1.1s) | 0.10s (0.3s) | 1672 |
| `stats2.tax-v2.46` | Releese: In (Graph) | A | 1 | pass 1 | 0.01s (0.0s) | 0.04s (0.0s) | 9 |
| `stats2.tax-v2.45` | Releese: In | A | 1 | pass 1 | 0.01s (0.0s) | 0.04s (0.0s) | 9 |
| `stats2.tax-v2.49` | TuneCore: In | A | 1 | pass 1 | 0.01s (0.0s) | 0.05s (0.0s) | 10 |
| `stats2.tax-v2.50` | TuneCore: In (Graph) | A | 1 | pass 1 | 0.01s (0.0s) | 0.04s (0.0s) | 10 |
| `stats2.tax-v2.36` | Horus: In (Graph) | A | 1 | pass 1 | 0.02s (0.0s) | 0.10s (0.1s) | 10 |
| `stats2.tax-v2.35` | Horus: In | A | 1 | pass 1 | 0.02s (0.0s) | 0.10s (0.1s) | 10 |
| `stats2.tax-v2.48` | Sonomo: In (Graph) | A | 1 | pass 1 | 0.05s (0.1s) | 0.12s (0.1s) | 14 |
| `stats2.tax-v2.47` | Sonomo: In | A | 1 | pass 1 | 0.05s (0.1s) | 0.13s (0.1s) | 14 |
| `stats2.tax-v2.43` | P RouteNote: In | A | 1 | pass 1 | 0.33s (0.3s) | 0.21s (0.2s) | 11 |
| `stats2.tax-v2.44` | P RouteNote: In (Graph) | A | 1 | pass 1 | 0.36s (0.4s) | 0.23s (0.2s) | 11 |
| `stats2.tax-v2.27` | DL Amuse: In (Graph) | A | 1 | pass 1 | 0.10s (0.1s) | 0.10s (0.1s) | 15 |
| `stats2.tax-v2.28` | EmuBands: In | A | 1 | pass 1 | 0.03s (0.0s) | 0.11s (0.1s) | 14 |
| `stats2.tax-v2.29` | EmuBands: In (Graph) | A | 1 | pass 1 | 0.02s (0.0s) | 0.09s (0.1s) | 14 |
| `stats2.tax-v2.12` | DL Amuse: In | A | 1 | pass 1 | 0.11s (0.1s) | 0.19s (0.2s) | 15 |
| `stats2.tax-v2.37` | JV Amuse: In | A | 1 | pass 1 | 0.01s (0.0s) | 0.06s (0.1s) | 4 |
| `stats2.tax-v2.38` | JV Amuse: In (Graph) | A | 1 | pass 1 | 0.01s (0.0s) | 0.05s (0.0s) | 4 |
| `stats2.tax-v2.24` | GHR Records RouteNote: In | A | 1 | pass 1 | 0.09s (0.1s) | 0.09s (0.1s) | 10 |
| `stats2.tax-v2.39` | LT Amuse: In | A | 1 | pass 1 | 0.00s (0.0s) | 0.05s (0.1s) | 0 |
| `stats2.tax-v2.40` | LT Amuse: In (Graph) | A | 1 | pass 1 | 0.00s (0.0s) | 0.08s (0.1s) | 0 |
| `stats2.tax-v2.41` | Masafi Amuse: In | A | 1 | pass 1 | 0.04s (0.0s) | 0.08s (0.1s) | 13 |
| `stats2.tax-v2.42` | Masafi Amuse: In (Graph) | A | 1 | pass 1 | 0.03s (0.0s) | 0.05s (0.1s) | 13 |
| `stats2.tax-v2.25` | GHR Amuse: In (Graph) | A | 1 | pass 1 | 1.43s (1.4s) | 0.45s (0.5s) | 7 |
| `stats2.tax-v2.30` | GHR Amuse: In | A | 1 | pass 1 | 1.45s (1.4s) | 0.53s (0.5s) | 7 |
| `stats2.tax-v2.26` | GB RouteNote: In | A | 1 | pass 1 | 0.95s (0.9s) | 0.64s (0.6s) | 19 |
| `stats2.tax-v2.13` | GB RouteNote: In (Graph) | A | 1 | pass 1 | 0.93s (0.9s) | 0.70s (0.7s) | 19 |
| `stats2.tax-v2.31` | GHR Records RouteNote: In (Graph) | A | 1 | pass 1 | 1.05s (1.1s) | 0.57s (0.6s) | 19 |
| `stats2.spotify-dash.117` | Alert | A | 1 | pass 1 | 24.23s (24.2s) | 6.18s (6.2s) | 1692728 |
| `stats2.tax-v2.57` | Oldest Entry | A | 1 | pass 1 | 0.00s (0.0s) | 0.00s (0.0s) | 1 |
| `stats2.tax-v2.58` | Newest Entry | A | 1 | pass 1 | 0.00s (0.0s) | 0.00s (0.0s) | 1 |
| `stats2.tax-v2.53` | ${person}: Total | A | 5 | pass_unordered 5 | 0.37s (0.8s) | 0.14s (0.2s) | 757 |
| `stats2.tax-old.48` | EmuBands: Total | A | 1 | pass_unordered 1 | 0.01s (0.0s) | 0.06s (0.1s) | 438 |
| `stats2.tax-old.47` | EmuBands: Since | A | 1 | pass 1 | 0.03s (0.0s) | 0.10s (0.1s) | 7 |
| `stats2.tax-old.46` | EmuBands: In | A | 1 | pass 1 | 0.03s (0.0s) | 0.10s (0.1s) | 8 |
| `stats2.tax-old.20` | DL Amuse: No. of Tracks | A | 1 | pass 1 | 0.08s (0.1s) | 0.04s (0.0s) | 23 |
| `stats2.tax-old.16` | DL Amuse: In | A | 1 | pass 1 | 0.14s (0.1s) | 0.10s (0.1s) | 6 |
| `stats2.tax-old.17` | DL Amuse: Since | A | 1 | pass 1 | 0.13s (0.1s) | 0.12s (0.1s) | 6 |
| `stats2.tax-old.23` | DL Amuse: Bar Graph | A | 1 | pass 1 | 0.12s (0.1s) | 0.14s (0.1s) | 6 |
| `stats2.tax-old.3` | DL Amuse: Total | A | 1 | pass 1 | 0.05s (0.0s) | 0.04s (0.0s) | 414 |
| `stats2.tax-old.7` | DL Amuse: Avg Daily | A | 1 | pass 1 | 0.05s (0.0s) | 0.07s (0.1s) | 411 |
| `stats2.tax-old.5` | DL Amuse: Daily | A | 1 | pass 1 | 0.05s (0.0s) | 0.10s (0.1s) | 410 |
| `stats2.tax-old.12` | LT Amuse: Total | A | 1 | pass 1 | 0.07s (0.1s) | 0.04s (0.0s) | 232 |
| `stats2.tax-old.13` | LT Amuse: Daily | A | 1 | pass 1 | 0.08s (0.1s) | 0.04s (0.0s) | 231 |
| `stats2.tax-old.14` | LT Amuse: Avg Daily | A | 1 | pass 1 | 0.07s (0.1s) | 0.06s (0.1s) | 232 |
| `stats2.tax-old.11` | LT Amuse | A | 1 | pass 1 | 0.20s (0.2s) | 0.08s (0.1s) | 12 |
| `stats2.tax-old.42` | GHR Records RouteNote: In | A | 1 | pass 1 | 0.12s (0.1s) | 0.07s (0.1s) | 8 |
| `stats2.tax-old.19` | DL Amuse Tracks | A | 1 | pass 1 | 0.39s (0.4s) | 0.14s (0.1s) | 54 |
| `stats2.tax-old.44` | GHR Records RouteNote: Total | A | 1 | pass_unordered 1 | 0.03s (0.0s) | 0.02s (0.0s) | 334 |
| `stats2.tax-old.43` | GHR Records RouteNote: Since | A | 1 | pass 1 | 0.10s (0.1s) | 0.04s (0.0s) | 7 |
| `stats2.tax-old.25` | GB RouteNote: Total | A | 1 | pass_unordered 1 | 0.36s (0.4s) | 0.05s (0.1s) | 623 |
| `stats2.tax-old.34` | Prelude RouteNote: Bar Graph | A | 1 | pass_both_error 1 | - | - | None |
| `stats2.tax-v2.61` | Rows Added Over Time | A | 1 | pass 1 | 1.48s (1.5s) | 0.04s (0.0s) | 863 |
| `stats2.tax-old.33` | Prelude RouteNote: No. of Tracks | A | 1 | pass 1 | 0.11s (0.1s) | 0.04s (0.0s) | 41 |
| `stats2.tax-old.37` | Prelude RouteNote: Daily | A | 1 | pass 1 | 0.07s (0.1s) | 0.02s (0.0s) | 336 |
| `stats2.tax-v2.55` | No. of Rows | A | 1 | pass 1 | 1.49s (1.5s) | 0.00s (0.0s) | 1 |
| `stats2.tax-old.36` | Prelude RouteNote: Total | A | 1 | pass_unordered 1 | 0.07s (0.1s) | 0.02s (0.0s) | 399 |
| `stats2.tax-old.39` | Prelude RouteNote: Avg Daily | A | 1 | pass 1 | 0.06s (0.1s) | 0.03s (0.0s) | 337 |
| `stats2.tax-old.31` | Prelude RouteNote: In | A | 1 | pass 1 | 0.56s (0.6s) | 0.02s (0.0s) | 2 |
| `stats2.tax-old.32` | Prelude RouteNote: Since | A | 1 | pass 1 | 0.56s (0.6s) | 0.02s (0.0s) | 2 |
| `stats2.tax-old.27` | GB RouteNote: In | A | 1 | pass 1 | 1.20s (1.2s) | 0.10s (0.1s) | 8 |
| `stats2.tax-old.28` | GB RouteNote: Since | A | 1 | pass 1 | 1.23s (1.2s) | 0.13s (0.1s) | 7 |
| `stats2.tax-old.38` | Prelude RouteNote Tracks | A | 1 | pass 1 | 0.69s (0.7s) | 0.18s (0.2s) | 529 |
| `stats.spotify-dash.33` | Table: ${artist_name} - ${track_name} | A | 86 | pass 86 | 4.34s (7.0s) | 0.18s (2.4s) | 598 |
| `stats2.tax-old.24` | Comparison: Streams | A | 1 | pass_tiebreak 1 | 7.10s (7.1s) | 0.55s (0.6s) | 12 |
| `stats2.tax-v2.56` | No. of Duplicate Rows | A | 1 | pass 1 | 32.35s (32.3s) | 9.21s (9.2s) | 1 |
| `stats2.tax-v2.60` | Track Repetition Detection | A | 1 | pass_topn_ties 1 | 46.44s (46.4s) | 1.85s (1.8s) | 50 |
| `stats2.tax-v2.59` | Playlist Row Distribution | A | 1 | pass 1 | 37.67s (37.7s) | 13.83s (13.8s) | 0 |
| `stats.spotify-dash.102` | Top Artists (Streams since 1st Sep) | A | 71 | pass 71 | 4.89s (13.7s) | 0.60s (3.0s) | 26 |
| `stats.spotify-dash.82` | Treemap | A | 1 | pass_unordered 1 | 5.10s (5.1s) | 0.04s (0.0s) | 1328 |
| `stats.spotify-dash.63` | Groove Bassment Releases: Change | A | 1 | pass 1 | 4.22s (4.2s) | 0.59s (0.6s) | 586 |
| `stats.spotify-dash.65` | Total Streams: ${artist_name} | A | 71 | pass 71 | 4.89s (5.4s) | 0.39s (1.1s) | 590 |
| `stats.spotify-dash.62` | Extended | A | 1 | pass 1 | 5.31s (5.3s) | 1.58s (1.6s) | 582 |
| `stats.spotify-dash.104` | Total Streams vs Daily Streams (only Outliers) | A | 1 | pass 1 | 32.02s (32.0s) | 1.99s (2.0s) | 90 |
| `stats.spotify-dash.30` | Test | A | 1 | pass 1 | 1.09s (1.1s) | 0.15s (0.1s) | 590 |
| `stats.spotify-dash.11` | Test | A | 1 | pass 1 | 1.54s (1.5s) | 0.15s (0.1s) | 590 |
| `stats.spotify-dash.43` | Test: Change | A | 1 | pass 1 | 1.57s (1.6s) | 0.15s (0.2s) | 589 |
| `stats.spotify-dash.48` | Test: Avg Daily Change | A | 1 | pass 1 | 1.54s (1.5s) | 0.16s (0.2s) | 8 |
| `stats.spotify-dash.64` | Extended + Releases: Avg Daily Change | A | 1 | pass 1 | 7.96s (8.0s) | 2.61s (2.6s) | 8 |
| `stats.spotify-dash.67` | Artist Specific Data: ${artist_name} | A | 71 | pass 71 | 6.33s (6.9s) | 0.43s (2.4s) | 593 |
| `stats.spotify-dash.36` | Extended | A | 1 | pass 1 | 5.52s (5.5s) | 2.82s (2.8s) | 582 |
| `stats.spotify-dash.103` | Total Streams vs Daily Streams (w/o Outliers) | A | 1 | pass 1 | 80.54s (80.5s) | 1.77s (1.8s) | 100 |
| `stats.spotify-dash.66` | Daily Streams: ${artist_name} | A | 71 | pass 71 | 5.29s (7.5s) | 0.39s (1.3s) | 589 |
| `stats.spotify-dash.105` | Total Streams vs Daily Streams (manually excludi | A | 1 | pass_unordered 1 | 147.20s (147.2s) | 2.22s (2.2s) | 100 |
| `stats.spotify-dash.81` | Tracks Per Milestone | A | 1 | pass 1 | 0.03s (0.0s) | 0.01s (0.0s) | 42 |
| `stats.spotify-dash.89` | Total Streams vs Daily Streams | A | 1 | pass_unordered 1 | 151.14s (151.1s) | 3.33s (3.3s) | 100 |
| `stats.spotify-dash.101` | Top Artists: Total Streams | A | 1 | pass_unordered 1 | 1.43s (1.4s) | 2.67s (2.7s) | 100 |
| `stats.spotify-dash.26` | Releases: Total | A | 1 | pass 1 | 6.03s (6.0s) | 3.39s (3.4s) | 583 |
| `stats.spotify-dash.72` | Groove Bassment Releases: Stat Panel | A | 1 | pass 1 | 4.69s (4.7s) | 1.56s (1.6s) | 587 |
| `stats.spotify-dash.73` | Gahara Releases: Stat Panel | A | 1 | pass 1 | 4.67s (4.7s) | 1.62s (1.6s) | 587 |
| `stats.spotify-dash.12` | Releases: Stat Panel | A | 1 | pass 1 | 5.43s (5.4s) | 2.91s (2.9s) | 583 |
| `stats.spotify-dash.71` | Extended: Stat Panel | A | 1 | pass 1 | 5.45s (5.4s) | 3.98s (4.0s) | 582 |
| `stats.spotify-dash.37` | Releases: Daily | A | 1 | pass 1 | 6.49s (6.5s) | 5.64s (5.6s) | 582 |
| `stats.spotify-dash.99` | Streams Since 1st Jan 2024 | A | 1 | pass 1 | 3.65s (3.6s) | 4.57s (4.6s) | 1 |
| `stats.spotify-dash.121` | All Lofi Tracks: Total Streams in Sep 2023 | A | 1 | pass 1 | 1.51s (1.5s) | 1.09s (1.1s) | 1 |
| `stats.spotify-dash.100` | Estimated Revenue Since 1st Jan 2024 | A | 1 | pass 1 | 4.36s (4.4s) | 5.94s (5.9s) | 1 |
| `stats.spotify-dash.44` | Releases: Avg Daily | A | 1 | pass 1 | 6.77s (6.8s) | 10.54s (10.5s) | 583 |
| `stats.spotify-dash.118` | Top Lofi Tracks: Total Streams in Sep 2023 | A | 1 | pass 1 | 4.49s (4.5s) | 1.62s (1.6s) | 100 |
| `stats.spotify-dash.16` | Releases + Extended: Total | A | 1 | pass 1 | 10.52s (10.5s) | 14.67s (14.7s) | 587 |
| `stats.tax-v2.20` | ${person}: Tracks | A | 5 | pass 3, pass_tiebreak 2 | 2.21s (3.2s) | 6.62s (10.5s) | 2063 |
| `stats.spotify-dash.114` | Total All-time Streams | A | 1 | pass 1 | 7.94s (7.9s) | 10.61s (10.6s) | 1 |
| `stats.tax-v2.9` | ${playlist_id} Tracks | A | 17 | pass 17 | 1.64s (5.8s) | 1.03s (5.7s) | 1558 |
| `stats.spotify-dash.70` | Releases + Extended: Daily | A | 1 | pass 1 | 10.91s (10.9s) | 19.88s (19.9s) | 587 |
| `stats.spotify-dash.45` | Releases + Extended: Avg Daily | A | 1 | pass 1 | 10.69s (10.7s) | 22.12s (22.1s) | 587 |
| `stats.spotify-dash.123` | Total All-time Streams for Gahara Releases | A | 1 | pass 1 | 7.26s (7.3s) | 8.97s (9.0s) | 1 |
| `stats.spotify-dash.115` | Total Estimated Revenue  | A | 1 | pass 1 | 8.02s (8.0s) | 22.45s (22.4s) | 1 |
| `stats.spotify-dash.120` | All Lofi Tracks: Total Streams since 1st Sep 202 | A | 1 | pass 1 | 18.58s (18.6s) | 3.71s (3.7s) | 1 |
| `stats.tax-v2.34` | ${playlist_id} Tracks Removed | A | 17 | pass 15, pass_unordered 2 | 10.32s (19.6s) | 0.26s (2.2s) | 122 |
| `stats.spotify-dash.119` | Top Lofi Tracks: Total Streams since 1st Sep 202 | A | 1 | pass 1 | 27.87s (27.9s) | 8.68s (8.7s) | 28 |
| `stats.tax-v2.54` | SpaceMedia: In (Graph) | A | 1 | pass 1 | 2.03s (2.0s) | 0.05s (0.0s) | 0 |
| `stats.tax-v2.60` | Rows With NULLs | A | 1 | pass 1 | 2.01s (2.0s) | 0.00s (0.0s) | 1 |
| `pf.playlist-followers.3` | All Playlists | A | 1 | pass 1 | 1.09s (1.1s) | 0.07s (0.1s) | 878 |
| `stats.tax-v2.53` | SpaceMedia: In | A | 1 | pass 1 | 5.06s (5.1s) | 0.08s (0.1s) | 0 |
| `pf.playlist-followers.92` | Zero | A | 1 | pass 1 | 0.33s (0.3s) | 0.06s (0.1s) | 1 |
| `pf.playlist-followers.57` | 100+ | A | 1 | pass 1 | 0.33s (0.3s) | 0.06s (0.1s) | 1 |
| `pf.playlist-followers.58` | 1K+ | A | 1 | pass 1 | 0.48s (0.5s) | 0.06s (0.1s) | 1 |
| `pf.playlist-followers.70` | No. of Accounts | A | 1 | pass 1 | 1.00s (1.0s) | 0.04s (0.0s) | 1 |
| `pf.playlist-followers.93` | 100K+ | A | 1 | pass 1 | 0.32s (0.3s) | 0.13s (0.1s) | 1 |
| `pf.playlist-followers.5` | All Playlists - Daily Change | A | 1 | pass 1 | 3.99s (4.0s) | 0.86s (0.9s) | 878 |
| `pf.playlist-followers.13` | $playlist - Total Followers (Hourly View) | A | 207 | pass 207 | 0.18s (0.3s) | 0.01s (0.1s) | 3388 |
| `pf.playlist-followers.59` | 10K+ | A | 1 | pass 1 | 0.90s (0.9s) | 0.59s (0.6s) | 1 |
| `pf.playlist-followers.51` | Most Followed Accounts | A | 1 | pass 1 | 2.92s (2.9s) | 1.45s (1.5s) | 43 |
| `pf.playlist-followers.56` | All | A | 1 | pass 1 | 3.69s (3.7s) | 0.11s (0.1s) | 1 |
| `pf.playlist-followers.66` | All Accounts | A | 1 | pass 1 | 4.60s (4.6s) | 1.33s (1.3s) | 34336 |
| `pf.playlist-followers.11` | Most Followed Playlists | A | 1 | pass 1 | 3.22s (3.2s) | 0.85s (0.9s) | 50 |
| `pf.playlist-followers.95` | Least Followed Playlists | A | 1 | pass_unordered 1 | 3.13s (3.1s) | 1.22s (1.2s) | 50 |
| `pf.playlist-followers.68` | All Accounts - Daily Change | A | 1 | pass 1 | 9.56s (9.6s) | 0.90s (0.9s) | 34296 |
| `pf.playlist-followers.2` | $playlist - Total Followers (Daily View) | A | 207 | pass 207 | 0.19s (0.3s) | 0.02s (0.1s) | 878 |
| `pf.playlist-followers.40` | $playlist - Daily Change | A | 207 | pass 207 | 0.18s (0.3s) | 0.02s (0.1s) | 878 |
| `pf.playlist-followers.84` | Playlist ID of $playlist | A | 207 | pass 207 | 0.06s (0.2s) | 0.00s (0.0s) | 1 |
| `pf.playlist-followers.85` | Account of $playlist | A | 207 | pass 207 | 0.08s (0.2s) | 0.00s (0.0s) | 1 |
| `pf.playlist-followers.69` | Fastest Growing Accounts | A | 1 | pass_topn_ties 1 | 20.17s (20.2s) | 0.82s (0.8s) | 25 |
| `pf.playlist-followers.438` | Title of $playlist | A | 207 | pass 207 | 0.07s (0.2s) | 0.00s (0.0s) | 1 |
| `pf.playlist-followers.63` | $account (Hourly View) | A | 50 | pass 49, pass_both_error 1 | 0.20s (1.7s) | 0.05s (0.2s) | 3314 |
| `pf.playlist-followers.53` | $account (Daily View) | A | 50 | pass 49, pass_both_error 1 | 0.18s (1.2s) | 0.03s (0.2s) | 878 |
| `pf.playlist-followers.54` | $account - Daily Change | A | 50 | pass 49, pass_both_error 1 | 0.20s (1.3s) | 0.04s (0.2s) | 878 |
| `pf.playlist-followers.77` | $account - Most Followed Playlists | A | 50 | pass 36, pass_both_error 1, pass_topn_ties 3, pass_unordered 10 | 0.18s (0.9s) | 0.03s (0.1s) | 25 |
| `pf.playlist-followers.79` | All | A | 50 | pass 49, pass_both_error 1 | 0.18s (1.0s) | 0.01s (0.0s) | 1 |
| `pf.playlist-followers.80` | 100+ | A | 50 | pass 49, pass_both_error 1 | 0.17s (0.4s) | 0.01s (0.0s) | 1 |
| `pf.playlist-followers.88` | $account - Fastest Growing Playlists | A | 50 | pass 17, pass_both_error 1, pass_topn_ties 19, pass_unordered 13 | 0.24s (25.9s) | 0.03s (0.3s) | 10 |
| `pf.playlist-followers.81` | 1K+ | A | 50 | pass 49, pass_both_error 1 | 0.15s (0.3s) | 0.01s (0.0s) | 1 |
| `pf.playlist-followers.82` | 10K+ | A | 50 | pass 49, pass_both_error 1 | 0.17s (0.4s) | 0.01s (0.0s) | 1 |
| `pf.playlist-followers.83` | User ID of $account | A | 50 | pass 49, pass_both_error 1 | 0.00s (0.1s) | 0.00s (0.0s) | 1 |
| `pf.playlist-followers.97` | $account - Least Followed Playlists | A | 50 | pass 44, pass_both_error 1, pass_topn_ties 2, pass_unordered 3 | 0.17s (0.8s) | 0.02s (0.1s) | 25 |
| `pf.playlist-followers.96` | $account - Slowest Growing Playlists | A | 50 | pass 15, pass_both_error 1, pass_topn_ties 18, pass_unordered 16 | 0.21s (25.0s) | 0.03s (0.2s) | 10 |
| `pf.playlist-followers.tpl-d1964f69cc` | per-playlist stamp: hourly | A | 155 | pass 155 | 0.13s (0.2s) | 0.02s (0.0s) | 3303 |
| `pf.playlist-followers.62` | Table | A | 1 | pass 1 | 0.37s (0.4s) | 0.04s (0.0s) | 13 |
| `pf.playlist-followers.tpl-be42e9b7c2` | per-playlist stamp: daily view | A | 150 | pass 150 | 0.16s (0.2s) | 0.02s (0.1s) | 878 |
| `pf.playlist-followers.tpl-519ba80f43` | per-playlist stamp: daily change | A | 155 | pass 155 | 0.16s (0.2s) | 0.02s (0.0s) | 878 |
| `pf.playlist-followers.45` | MÚSICA PARA TIENDAS 2025 | A | 1 | pass 1 | 0.13s (0.1s) | 0.02s (0.0s) | 1107 |
| `pf.playlist-followers.46` | MÚSICA PARA TIENDAS 2025 - Daily Change | A | 1 | pass 1 | 0.14s (0.1s) | 0.01s (0.0s) | 368 |
| `pf.playlist-followers.47` | [SAT] Só as Tops Internacional 2024 | A | 1 | pass 1 | 0.20s (0.2s) | 0.02s (0.0s) | 3278 |
| `pf.playlist-followers.48` | Só as Tops Internacional 2024 - Daily Change | A | 1 | pass 1 | 0.25s (0.2s) | 0.02s (0.0s) | 879 |
| `pf.playlist-followers.429` | [RV] RELAXING VIBES 🍹🌞🌴 | A | 1 | pass 1 | 0.15s (0.1s) | 0.02s (0.0s) | 1368 |
| `pf.playlist-followers.430` | RELAXING VIBES 🍹🌞🌴 (Daily View) | A | 1 | pass 1 | 0.14s (0.1s) | 0.02s (0.0s) | 458 |
| `pf.playlist-followers.437` | RELAXING VIBES 🍹🌞🌴 - Daily Change | A | 1 | pass 1 | 0.26s (0.3s) | 0.01s (0.0s) | 458 |
| `pf.playlist-followers.tpl-1ea8b61f4f` | per-playlist stamp: daily change | A | 1 | pass 1 | 0.13s (0.1s) | 0.01s (0.0s) | 3014 |
| `pf.playlist-followers.296` | Table | A | 1 | pass 1 | 0.36s (0.4s) | 0.03s (0.0s) | 10 |
| `pf.playlist-followers.540` | Table | A | 1 | pass 1 | 0.33s (0.3s) | 0.01s (0.0s) | 4 |
| `pf.playlist-followers.90` | All Playlists | A | 1 | pass_unordered 1 | 3.47s (3.5s) | 0.78s (0.8s) | 905 |
| `pf.playlist-followers.1` | Simple Table | A | 1 | pass_unordered 1 | 3.33s (3.3s) | 4.48s (4.5s) | 2710108 |
| `pf.playlist-followers.102` | Fastest Growing Playlists (w/o London Grams) | A | 1 | pass_topn_ties 1 | 352.37s (352.4s) | 0.67s (0.7s) | 50 |
| `pf.playlist-followers.94` | Slowest Growing Playlists | A | 1 | pass_topn_ties 1 | 498.51s (498.5s) | 0.68s (0.7s) | 50 |
| `pf.playlist-followers.67` | Fastest Growing Playlists | A | 1 | pass_topn_ties 1 | 515.65s (515.7s) | 0.60s (0.6s) | 50 |
| `stats2.tax-v2.66` | Top Artists / $person: $month | A | 40 | pass 6, pass_topn_ties 2, pass_unordered 32 | 1.86s (3.9s) | 0.52s (2.5s) | 100 |
| `stats2.tax-v2.67` | Top Artists / $playlist_id: $month | A | 115 | pass 63, pass_topn_ties 3, pass_unordered 49 | 0.07s (1.9s) | 0.51s (2.8s) | 100 |
| `stats2.tax-v2.64` | Top Tracks / $person: $month | A | 40 | pass 39, pass_unordered 1 | 1.75s (4.2s) | 0.68s (3.1s) | 100 |
| `stats2.tax-v2.65` | Top Tracks / $playlist_id: Streams In $month | A | 115 | pass 109, pass_unordered 6 | 0.06s (2.0s) | 0.33s (1.6s) | 100 |
| `stats.spotify-dash.106` | Top Artists: Streams since 1st Sep | A | 1 | pass_tiebreak 1 | 11.80s (11.8s) | 5.54s (5.5s) | 100 |

## Variable queries (dropdown options)

| dashboard | variable | samples | statuses |
|---|---|---|---|
| stats2.spotify-dash | artist_name | 1 | pass 1 |
| stats2.spotify-dash | track_name | 25 | pass 25 |
| stats2.tax-v2 | month | 1 | pass 1 |
| stats.spotify-dash | artist_name | 1 | pass 1 |
| stats.spotify-dash | track_name | 25 | pass 25 |
| pf.playlist-followers | account | 1 | pass 1 |
| pf.playlist-followers | playlist | 49 | pass 49 |

## run_panel smoke test (SQL + transformations)

`grafana_compat.run_panel` executed for 239 implemented panels with representative variables: 239 succeeded, 0 raised.

Panels with transformations (frames: columns x rows before -> after):

* `stats2.spotify-dash.34` Daily Streams: ${artist_name} - ${track_ ['calculateField', 'filterByValue']: [[3, 851]] -> [[4, 850]]
* `stats2.spotify-dash.77` Releases + Extended: Avg Daily ['calculateField', 'filterByValue']: [[2, 850]] -> [[3, 843]]
* `stats2.spotify-dash.163` Releases: Avg Daily ['calculateField', 'filterByValue']: [[2, 846]] -> [[3, 839]]
* `stats2.spotify-dash.53` Extended: Avg Daily ['calculateField', 'filterByValue']: [[2, 845]] -> [[3, 838]]
* `stats2.spotify-dash.46` Groove Bassment Releases: Avg Daily ['calculateField', 'filterByValue']: [[2, 850]] -> [[3, 843]]
* `stats2.spotify-dash.47` Gahara Releases: Avg Daily ['calculateField', 'filterByValue']: [[2, 847]] -> [[3, 840]]
* `stats2.spotify-dash.83` Releases + Extended ['calculateField', 'filterByValue']: [[2, 26]] -> [[3, 25]]
* `stats2.spotify-dash.85` Releases ['calculateField', 'filterByValue']: [[2, 26]] -> [[3, 25]]
* `stats2.spotify-dash.86` Extended ['calculateField', 'filterByValue']: [[2, 26]] -> [[3, 25]]
* `stats2.spotify-dash.87` Groove Bassment Releases ['calculateField', 'filterByValue']: [[2, 28]] -> [[3, 27]]
* `stats2.spotify-dash.88` Gahara Releases ['calculateField', 'filterByValue']: [[2, 27]] -> [[3, 26]]
* `stats2.tax-v2.15` ${person}: Total ['labelsToFields']: 10 frames of 2 cols x ~414 rows -> [[11, 568]]
* `stats2.tax-v2.64` Top Tracks | $person: $month ['joinByField', 'calculateField']: [[3, 100]] -> [[3, 100]]
* `stats2.tax-v2.53` ${person}: Total ['groupBy']: [[2, 757]] -> [[2, 757]]
* `stats2.tax-old.20` DL Amuse: No. of Tracks ['calculateField', 'filterByValue']: [[2, 23]] -> [[3, 16]]
* `stats2.tax-old.23` DL Amuse: Bar Graph ['organize']: [[3, 6]] -> [[3, 6]]
* `stats2.tax-old.24` Comparison: Streams ['organize']: [[4, 12]] -> [[4, 12]]
* `stats2.tax-old.7` DL Amuse: Avg Daily ['calculateField', 'filterByValue']: [[2, 411]] -> [[3, 404]]
* `stats2.tax-old.14` LT Amuse: Avg Daily ['calculateField', 'filterByValue']: [[2, 232]] -> [[3, 225]]
* `stats2.tax-old.33` Prelude RouteNote: No. of Tracks ['calculateField', 'filterByValue']: [[2, 41]] -> [[3, 34]]
* `stats2.tax-old.39` Prelude RouteNote: Avg Daily ['calculateField', 'filterByValue']: [[2, 337]] -> [[3, 330]]
* `stats.spotify-dash.45` Releases + Extended: Avg Daily ['calculateField', 'filterByValue']: [[2, 587]] -> [[3, 579]]
* `stats.spotify-dash.44` Releases: Avg Daily ['calculateField', 'filterByValue']: [[2, 583]] -> [[3, 575]]
* `stats.spotify-dash.123` Total All-time Streams for Gahara Releas ['filterByValue']: [[1, 1]] -> [[1, 1]]
* `pf.playlist-followers.66` All Accounts ['prepareTimeSeries']: [[3, 34336]] -> 50 frames of 2 cols x ~878 rows
* `pf.playlist-followers.68` All Accounts - Daily Change ['prepareTimeSeries']: [[3, 34296]] -> 50 frames of 2 cols x ~877 rows

## Quirk measurements

Raw measurements and sampled results are private build outputs and are omitted from this software backup.

## Known limits of the proof

* The oracle is the restored cluster (C locale). Original servers ran `C.UTF-8` (stats server postgresql.conf; stats2 assumed identical: same provider and OS image). ORDER BY text order is therefore codepoint order in both (== DuckDB's), while ILIKE on non-ASCII letters is Unicode-aware in production (== DuckDB) but ASCII-only in the restored cluster. The ICU-collation oracle emulates glibc's Unicode folding; special letters whose simple case mapping differs between ICU and glibc (e.g. Turkish dotted I) are not exercised by the data.
* `LIKE`/`ILIKE` escape: PG treats `\` as escape, DuckDB does not. No `tracks.artist`, `song_name` or `songs_by_artist` value contains a backslash (checked), so the translations agree.
* Grafana quoting of single-value variables (`'` -> `''`) follows Grafana 11 `@grafana/sql`; Playlist Followers ran on Grafana 10.4.1 (same behaviour assumed). Both engines receive identical text, so this cannot change an equality verdict, only whether an apostrophe artist works in the viewer as it did (or did not) in Grafana.
* `NOW()` / `CURRENT_DATE` panels are validated at the dataset anchor only.
* Heavy PG panels (Playlist Followers 'Fastest/Slowest Growing', milestone window functions) take minutes in PG; the DuckDB timings above are the viewer's.