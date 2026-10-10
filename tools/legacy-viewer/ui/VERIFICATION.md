# Foundation verification

Verified locally with Node 24 and Microsoft Edge, 2026-10-04.

- `npm install`, typecheck, ESLint, Vitest and production build pass.
- 22 unit tests cover formatting, UTC in Asia/Dubai, ISO week starts/month labels,
  null/zero separation, missing-day bands, explicit gaps, seven-day MA, histogram
  bin edges, archive presets, URL state, API JSON/errors/aborts and CSV escaping.
- Original root and dark token blocks match the source verbatim.
- Production asset URLs are relative. All three font families have emitted WOFF2
  files. The literal HTTP(S) scan has no hits outside bundled license comments.
  Font and React/Scheduler license notices ship as a comment-only CSS file.
  The development gallery is absent
  from production assets and its production route shows “View not found”.
- Gallery visually checked in simultaneous light/dark themes: multi-series
  area/line/bar, MA breaks, two gap bands, reset dot, axes and tooltip styling.
  Actual rendered SVG paths contain separate move commands at missing dates.
- Async combobox searched and selected with ArrowDown/Enter. PNG copying worked
  using the browser clipboard. CSV formatting is verified by unit tests.
- All ten production routes render their own title and “Not wired yet”. Browser
  back/forward retains hash state. Archive-relative range and grain update the
  hash; dataset changes clear dependent filters.
- Theme selection persists across reload. System preference follows until a
  manual preference is selected; storage access is guarded.
- Native date dialog traps keyboard focus, Escape closes it, and focus returns
  to its trigger. Mobile navigation opens/closes at 390px with no horizontal
  overflow. Skip navigation targets the focusable content area.
- Axe WCAG A/AA checks report zero violations for gallery content (both themes)
  and the production shell in both stable themes. Theme changes now update
  foreground/background together, avoiding temporary contrast loss.
- No external requests or application exceptions during the production route
  walkthrough. Browser screenshots are local ignored artifacts under
  `output/playwright/`.
- Shutdown verified with browser-only intercepted responses: GET session, POST
  with the exact token header, readable error on failure, and the stopped screen
  after an empty 204 response. No actual Python process was stopped.

The API integration and page export remain intentionally unwired; the backend is
a later task. No commits were created.
