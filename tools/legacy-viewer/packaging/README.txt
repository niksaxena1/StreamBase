STREAMBASE LEGACY ARCHIVE VIEWER
================================

A private, offline Windows app for browsing everything that used to live on the
DigitalOcean servers (<streams-older-source>, <streams-current-source> and
Playlist followers): Spotify stream counts 2023-07-08 -> 2025-12-22, the Tax
dashboards, milestones, and playlist-follower history 2024-04-07 -> 2026-09-01.


START / STOP
------------
Start:  double-click "StreamBase Legacy Viewer.exe" (or "Open Legacy Viewer.cmd").
        It opens in its own window (Microsoft Edge app mode, or your default
        browser). Starting it again just brings the window back.
Stop:   click "Quit" in the top bar, or double-click "Stop Legacy Viewer.cmd".

Nothing needs to be installed. No internet connection is needed or used: the app
runs a private server on 127.0.0.1 (this PC only) and never sends data anywhere.
The archive database is opened read-only, so nothing you do can change it.


WHAT'S INSIDE
-------------
Explorer pages (StreamBase look):
  Track lookup (start page), Overview, Tracks (+ track detail with every raw reading), Artists, Playlists
  (+ comparison), Milestones, Tax, Followers, Data quality, Archive.
Original dashboards:
  Every useful panel of the old Grafana dashboards -- stats2 "Spotify Dash" (v419),
  "Tax V2" (v64), "Tax (Old)", the older stats-server versions, and "Playlist
  Followers" (v563) -- re-run offline with the same variables. Each one was
  proven to give exactly the same result as the original SQL on the original
  database (6,641 checks, 0 failures; spot-checked against live Grafana too).

Handy keys (Track lookup): Ctrl+K jumps to any track or artist from anywhere; "?" lists the rest
(/ and T focus the pickers, [ ] and Shift+[ ] move the From and To dates, C copies the result).

Data sets (switch in the top bar):
  Streams - complete (stats2)  34,325,689 readings, 2023-07-08 -> 2025-12-22.
  Streams - stats server       the older server's 27,198,862 readings
                               (2023-07-08 -> 2025-03-10). Every one of them is
                               also in stats2, identical -- nothing is counted twice.
  Playlist followers           2,710,108 readings, 905 playlists.


HOW THE NUMBERS ARE COMPUTED (short version)
--------------------------------------------
* Track lookup: choose an artist and track, then From and To UTC dates. Difference
  = To counter minus From counter (From-day streams are excluded). Copy result
  puts both readings and their difference on the clipboard. Dates and track are
  saved in the page link, and recent tracks stay on this PC.
* Lookup uses the latest earlier reading if a date was missed, or the first
  reading if the track was not tracked yet. Warnings show the actual dates,
  counter resets, and days without readings. A range with no readings is empty.
* Lookup's monthly table subtracts the previous month-end counter from this
  month-end counter; the first and last tracked months may be partial. Click a
  month to compare its first/last dates in the calculator. Monthly and daily
  readings can be exported to CSV. Tax keeps its original monthly calculation.
* The collector read each playlist several times a day and some readings were
  wrong, so the value for a day is the MOST COMMON reading that day (ties -> the
  higher value) -- the same rule the old dashboards used.
* A "day" is a UTC calendar day (exactly as Grafana's SQL did).
* Missing days are shown as gaps, never as zero. Nothing is interpolated.
* Tracks are identified by ISRC. When several Spotify IDs share an ISRC their
  counters are almost always identical, so the Explorer takes the highest one
  instead of adding them (the old track panels added them; Original dashboards
  still shows that).
* Explorer playlist totals add up each member track's daily value; this ignores
  the occasional double scrape that inflated the old hourly-total method.
* Followers: Explorer uses the most common reading per day; the old dashboard
  used the daily maximum, which was fooled by mislabelled readings on 2025-01-09.
* "Est. Revenue" in Tax views = streams x 0.002, the hard-coded rate of the old
  dashboard. It is an estimate, not accounting data.
The Data quality page explains every rule, gap and correction in detail.


SECURITY & PRIVACY
------------------
This folder contains private business data. Keep it on your own drives and
don't put it on a shared or public location. It deliberately does NOT contain
any passwords, keys, Grafana/database credentials, TLS certificates or server
configuration from the old servers.


THE ORIGINAL BACKUP
-------------------
This app is built from, and does not replace, the verified backup at:
  <archive-root>
(PostgreSQL dumps, Grafana databases, dashboard JSON, server configuration and
full filesystem image; 63/63 files SHA-256 verified on 2026-10-04). Keep that
backup -- ideally with a second encrypted copy on another device. The app's
Archive page lists every file in it and what is / isn't shown in the app.

Restoration limits: the app shows the data, not the old servers. To bring a
server back you'd restore the PostgreSQL dumps (pg_restore) and Grafana
database from the backup; the app does not need them to run.


INTEGRITY
---------
SHA256SUMS.txt lists a checksum for every file in this folder.
Rebuild instructions (for developers): <repo-root>\tools\legacy-viewer\docs\
