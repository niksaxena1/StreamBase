# SpotiBase Technical Demo Video Design

Date: 2026-05-18

## Goal
Create a silent, 60-second autoplay demo video for technical evaluators that demonstrates:
1. what SpotiBase does,
2. how the user-facing product behaves,
3. how the backend and data model are structured,
4. and how multiple tools can be combined into a polished production workflow.

## Audience
Primary audience: technical evaluators.
Secondary purpose: demonstrate the agent's ability to combine live product inspection, live database understanding, motion design, browser capture, and optional generative media into a coherent artifact.

## Creative direction
Hybrid treatment:
- first half feels like a polished product film,
- second half becomes a concise engineering explainer.

Tone: precise, modern, confident, not salesy.
Format: 16:9, 1920x1080, 60 seconds, silent autoplay with music, captions, and motion only.

## Core message
SpotiBase turns daily Spotify-related exports into a durable analytics system: live product surfaces on top, disciplined data pipelines and schema isolation underneath.

## Narrative structure
### 0-08s — Problem and promise
- Open on real app UI.
- Copy: "Daily Spotify snapshots -> long-term catalog intelligence"
- Show the dashboard as the immediate payoff.

### 08-22s — Product surfaces
- Real captures from Home, Playlists, Catalog, and Competitors.
- Quick labels explain what each surface answers:
  - "What is growing?"
  - "What changed?"
  - "What needs attention?"

### 22-38s — Backend architecture
- Animated data path:
  `GitHub Actions -> SpotOnTrack exports -> ingestion/enrichment -> Supabase -> Next.js UI`
- Use simplified but accurate labels, not exhaustive implementation detail.

### 38-50s — Data model
- Visualize the two analytics universes:
  - `public` schema = own catalog
  - `competitor` schema = isolated competitor analytics
- Emphasize `tracks.isrc` as stable identity.
- Show `dataset_mode + competitor_label_key` choosing the active universe.

### 50-60s — Why the design matters
- Close on the app with compact claims:
  - "historical analytics"
  - "operational visibility"
  - "isolated competitor mode"
- End card: "SpotiBase — analytics with memory"

## Visual system
- Use the real product UI as the dominant source material.
- Palette should inherit the app's dark UI and Spotify-adjacent green accents.
- Motion language: restrained, data-like, precise.
- No generic stock-tech b-roll.
- Higgsfield may be used only for one optional bridge asset if it adds meaning, such as an abstract data pulse between product and backend sections.

## Tooling plan
- Supabase plugin: inspect live schema and migrations so the backend section is faithful to production reality.
- Browser plugin: capture real app UI and page transitions from the live local app.
- Remotion: primary composition, timing, typography, transitions, overlays, and final render.
- Higgsfield CLI: optional generative visual accent only if it improves the result without reducing technical honesty.

## Asset plan
- Browser captures of:
  - Home
  - Playlists
  - Catalog
  - Competitors
- Schema diagram generated from the live database plus repo knowledge.
- Data-flow diagram built as vector/motion graphics inside Remotion.
- Optional abstract transition clip if Higgsfield materially improves the bridge between sections.

## Editorial rules
- Every shot must answer one question.
- Captions must be short enough to read without pausing playback.
- Prefer direct causality over feature inventory.
- Show real UI before architecture so the viewer knows what the machinery is for.
- Do not imply competitor history depth that the system does not yet have.

## Verification
- Confirm live schema labels and counts before final export.
- Verify the app pages shown match current product behavior.
- Render test stills and a draft MP4 before final output.
- Review timing against a 60-second ceiling.

## Out of scope
- Voiceover
- Founder-story framing
- Marketing testimonials
- Full tutorial coverage
- Overclaiming future competitor analytics beyond current history depth
