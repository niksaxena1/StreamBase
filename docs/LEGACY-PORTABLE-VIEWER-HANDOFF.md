# StreamBase Legacy Archive Viewer handoff

This is the public software backup of the offline Windows viewer for retired PostgreSQL/Grafana analytics services. Source lives in `tools/legacy-viewer/`; start with its [README](../tools/legacy-viewer/README.md) and [architecture](../tools/legacy-viewer/docs/ARCHITECTURE.md).

The application combines a StreamBase-style Explorer, track lookup and artist reports with an Original dashboards mode that translates the historical Grafana panel SQL to DuckDB. A local Python HTTP server serves a Vite/React UI on `127.0.0.1`; PyInstaller can package it for Windows. Normal viewing uses only local files.

## Private inputs and configuration

Archive data is not part of this repository. Keep dumps, Grafana databases, reconciled extracts, artwork, generated registries, validation samples and packaged applications on private drives. Historical server addresses, resource identifiers, credentials, personal paths and infrastructure operations notes are intentionally omitted from this public handoff.

Supply build paths through the environment variables listed in the viewer README. Source startup requires `--db`; packaging requires explicit Python, database and destination paths. A private registry generated from the archive can be supplied with `LEGACY_REGISTRY` or stored beside the viewer database. The public registry retains SQL, titles and layout definitions but omits cached query results, private infrastructure instructions and saved query selections.

## Data correctness

Preserve original PostgreSQL panel semantics in compatibility mode, including variable interpolation, UTC calendar days, nulls, grouping, mode ties and archive-anchored relative dates. Explorer intentionally flags gaps, resets and ambiguous identities; document any change in meaning. Tax panels use their original estimated-revenue formula, not accounting data. Do not commit tax/revenue results or other sampled archive records.

Rebuild and validation commands are in the viewer README. Archive-dependent integration tests and PostgreSQL-versus-DuckDB validation need privately supplied data. Historical verification reports describe earlier runs; they do not certify a fresh rebuild.

## StreamBase boundaries

Follow the repository's `AGENTS.md`. Own catalog in `public` and competitors in `competitor` remain separate universes; this archive viewer is a standalone local application. `tracks.isrc` remains the stable track identity. Do not change production analytics, schema exposure or hot paths as part of viewer maintenance.

## Maintenance expectations

Keep all runtime assets local, preserve a read-only database during viewing, bind only to loopback and retain explicit empty/error states. Keep panel coverage and translation documentation with the source. Regenerate private build outputs outside tracked source and inspect the staged tree before any public commit. Software preservation does not authorize changes to cloud resources.
