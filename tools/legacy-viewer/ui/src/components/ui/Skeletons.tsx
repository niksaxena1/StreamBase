import type { ReactNode } from "react";
import { Card, Skeleton } from "./index";

/** Content-shaped loading placeholders: same blocks and proportions as the loaded pages. */
function Busy({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className} aria-busy="true">
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  );
}
const bar = (w: number | string, h = 14) => <Skeleton style={{ width: w, height: h }} />;

export function TableSkeleton({ rows = 8, columns = 6, label = "Loading rows…" }: { rows?: number; columns?: number; label?: string }) {
  return (
    <Busy label={label} className="skeleton-table">
      <Card className="table-card dense">
        <div className="skeleton-row skeleton-head">
          {Array.from({ length: columns }, (_, i) => (
            <span key={i}>{bar("60%", 12)}</span>
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div className="skeleton-row" key={r}>
            {Array.from({ length: columns }, (_, c) => (
              <span key={c} className={c === 0 ? "skeleton-cell-art" : undefined}>
                {c === 0 && <Skeleton style={{ width: 24, height: 24, borderRadius: 4 }} />}
                {bar(c === 0 ? "70%" : `${45 + ((r * 7 + c * 13) % 35)}%`)}
              </span>
            ))}
          </div>
        ))}
      </Card>
    </Busy>
  );
}

/** Same grid items as the loaded Track lookup (hero, calculator, monthly table, charts) so nothing jumps. */
export function LookupSkeleton() {
  return (
    <>
      <span role="status" className="sr-only lookup-skeleton">
        Loading track…
      </span>
      <div className="lookup-hero-slot" aria-hidden="true">
        <Card className="lookup-hero">
          <Skeleton style={{ width: 72, height: 72, borderRadius: 6 }} />
          <div className="hero-main">
            {bar(240, 24)}
            <div style={{ height: 8 }} />
            {bar(140)}
            <div style={{ height: 10 }} />
            {bar(260, 12)}
          </div>
          <div className="hero-stat">
            {bar(90, 12)}
            {bar(150, 24)}
          </div>
        </Card>
      </div>
      <Card className="lookup-calculator" aria-hidden="true">
        <div className="row" style={{ gap: 12 }}>
          {bar(150, 36)}
          {bar(150, 36)}
          {bar(90, 34)}
          {bar(90, 34)}
          {bar(110, 34)}
        </div>
        <div className="lookup-tiles skeleton-tiles">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              {bar("50%", 12)}
              {bar("80%", 30)}
              {bar("40%", 10)}
            </div>
          ))}
        </div>
      </Card>
      <section className="lookup-months" aria-hidden="true">
        {bar(180, 18)}
        <div style={{ height: 10 }} />
        <TableSkeleton rows={4} columns={4} label="Loading months…" />
      </section>
      <div className="lookup-charts" aria-hidden="true">
        <Card>
          {bar(160, 16)}
          <div style={{ height: 12 }} />
          <Skeleton style={{ width: "100%", height: 300 }} />
        </Card>
        <Card>
          {bar(150, 16)}
          <div style={{ height: 12 }} />
          <Skeleton style={{ width: "100%", height: 110 }} />
        </Card>
      </div>
    </>
  );
}

export function ArtistReportSkeleton() {
  return (
    <Busy label="Building the artist report…" className="report-skeleton">
      <div className="report-summary">
        <Card>{bar("40%", 12)}<div style={{ height: 10 }} />{bar("70%", 30)}</Card>
        <Card>{bar("40%", 12)}<div style={{ height: 10 }} />{bar("55%", 30)}</Card>
        <Card>{bar("40%", 12)}<div style={{ height: 10 }} />{bar("45%", 30)}</Card>
      </div>
      <TableSkeleton rows={10} columns={6} label="Loading tracks…" />
    </Busy>
  );
}

export function OverviewSkeleton() {
  return (
    <Busy label="Loading overview…" className="overview-skeleton">
      <div className="explorer-stats">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="stat-card">
            {bar("55%", 12)}
            <div style={{ height: 12 }} />
            {bar("70%", 32)}
            <div style={{ height: 12 }} />
            {bar("45%", 12)}
          </Card>
        ))}
      </div>
      <div style={{ height: 16 }} />
      <Card>
        {bar(180, 16)}
        <div style={{ height: 12 }} />
        <Skeleton style={{ width: "100%", height: 260 }} />
      </Card>
      <div style={{ height: 16 }} />
      <Card>
        {bar(120, 16)}
        <div style={{ height: 12 }} />
        <Skeleton style={{ width: "100%", height: 180 }} />
      </Card>
    </Busy>
  );
}

/** "Top tracks in range" cards: 72px cover, title, artist, three stats. */
export function TopCardsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <Busy label="Loading top tracks…" className="top-cards-skeleton">
      <ul className="top-cards" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li className="top-card" key={i}>
            <Skeleton style={{ width: 72, height: 72, borderRadius: 6 }} />
            <div className="top-card-body">
              {bar("70%", 16)}
              <div style={{ height: 6 }} />
              {bar("45%", 12)}
              <div style={{ height: 10 }} />
              {bar("85%", 12)}
            </div>
          </li>
        ))}
      </ul>
    </Busy>
  );
}

/** Coverage heatmap card. */
export function HeatmapSkeleton() {
  return (
    <Busy label="Loading coverage…" className="heatmap-skeleton">
      <Card>
        {bar(170, 16)}
        <div style={{ height: 12 }} />
        <Skeleton style={{ width: "100%", height: 150 }} />
      </Card>
    </Busy>
  );
}
