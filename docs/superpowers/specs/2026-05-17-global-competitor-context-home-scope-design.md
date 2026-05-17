# Global Competitor Context + Home Scope Design

## Goal
Make Competitor Mode behave like a coherent app-wide universe with one globally selected competitor label, while preserving the existing Home page layout and panels wherever those metrics are semantically valid.

## Product rule
Competitor Mode should not get a separate simplified homepage. It should reuse the existing Home experience and swap the analytical scope from the own catalog to the selected competitor.

## Core model
- `dataset_mode`: `own` or `competitor`
- `competitor_label_key`: globally selected competitor when `dataset_mode = competitor`
- `competitor.labels`: one competitor identity
- `competitor.playlists.label_key`: one competitor may own multiple playlists

## UX
- When Competitor Mode is active, show a compact global competitor selector in the shell/header.
- Persist the selected competitor in user settings so it follows the user across pages and sessions.
- Default to the first active competitor label if the saved label is missing or inactive.

## Page behavior
### Home
Reuse the existing Home panels where the underlying metric makes sense, but scope all data to the selected competitor label by aggregating across all active competitor playlists for that label.

Expected panels to preserve when data exists:
- headline totals
- stream concentration
- tracks total vs daily scatter
- milestone distribution
- tracks per daily-stream bucket
- recent history

Own-catalog-only panels that depend on concepts not yet modeled for competitors should hide gracefully rather than showing misleading data.

### Playlists
Show only playlists belonging to the selected competitor by default. A competitor can have multiple playlists; the current selected playlist remains page-local, but the available playlist universe is label-scoped.

### Catalog/Search
Show only tracks and artists that belong to the selected competitor’s playlist universe.

### Playlist config
Competitor playlist assignment should remain driven by `label_key`, allowing future competitors to own multiple playlists without changing the model.

## Data strategy
- Build label-scoped competitor analytics from competitor playlist membership and daily stream tables.
- Prefer reusing existing Home components and panel contracts.
- Add competitor-specific RPCs only where the current own-catalog RPC assumes `all_catalog` or public-schema-only semantics.

## Safety / correctness
- Do not mix competitor and own-catalog rows.
- Do not fake unsupported panels with own-catalog data.
- Competitor scope must be explicit in cache keys and server-side data loaders.

## Testing
- User setting tests for saved global competitor selection.
- Data-loader tests proving own vs competitor scopes return different sources.
- UI tests for selector visibility and label scoping.
- Manual verification with Paraíso as the first competitor.
