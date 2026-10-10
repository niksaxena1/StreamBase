import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  CollapsibleSection,
  Combobox,
  ConfidenceMeter,
  CopyableText,
  Drawer,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  KeyValueList,
  LoadingState,
  Modal,
  SectionHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  Tabs,
  Tooltip,
  type Option,
} from "../../components/ui";
import {
  DateRangePicker,
  GranularitySelect,
} from "../../components/ui/DateRangePicker";
import { DataTable, type Sort } from "../../components/ui/DataTable";
import {
  BarChart,
  BarGauge,
  CalendarHeatmap,
  Histogram,
  PieChart,
  StatPanel,
  TimeSeriesChart,
} from "../../components/charts";
import type { Grain } from "../../app/useUrlState";
import { DAY_MS, fullNumber } from "../../lib/format";
import "./gallery.css";
const bounds = { from: "2023-07-08", to: "2025-12-22" };
const options = [
  { value: "a", label: "Synthetic artist A" },
  { value: "b", label: "Synthetic artist B" },
  { value: "c", label: "Synthetic artist C" },
];
async function search(query: string, signal: AbortSignal): Promise<Option[]> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 220);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
  return options.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
}
const timeline = Array.from({ length: 28 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 2, 1) + i * DAY_MS).toISOString(),
  streams: i === 12 ? null : 1200 + i * 60 + Math.sin(i) * 150,
  tracks: i === 12 ? null : 1000 + i * 15,
  bars: i === 12 ? null : 500 + i * 20,
  observations: i === 12 ? null : 3,
  confidence: i === 12 ? null : 0.875,
})).filter((_, i) => i !== 8 && i !== 9);
const rankings = [
  { name: "Track A", value: 1800000 },
  { name: "Track B", value: 1100000 },
  { name: "Track C", value: 600000 },
  { name: "Zero", value: 0 },
  { name: "Missing", value: null },
];
const coverage = Array.from({ length: 70 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 2, 1) + i * DAY_MS).toISOString(),
  value: i % 9 === 0 ? null : i % 7 === 0 ? 0 : (i % 4) + 1,
}));
function GalleryTheme({ theme }: { theme: "light" | "dark" }) {
  const [range, setRange] = useState(bounds),
    [grain, setGrain] = useState<Grain>("daily"),
    [artist, setArtist] = useState<string | null>(null),
    [mode, setMode] = useState("daily"),
    [tab, setTab] = useState("first"),
    [modal, setModal] = useState(false),
    [drawer, setDrawer] = useState(false),
    [sort, setSort] = useState<Sort>({ key: "value", direction: "desc" }),
    [page, setPage] = useState(0),
    [clicked, setClicked] = useState("");
  const sorted = [...rankings].sort(
    (a, b) =>
      (sort.key === "name"
        ? a.name.localeCompare(b.name)
        : (a.value ?? -Infinity) - (b.value ?? -Infinity)) *
      (sort.direction === "asc" ? 1 : -1),
  );
  return (
    <section
      className="gallery-theme"
      data-gallery-theme={theme}
      aria-label={`${theme} theme examples`}
    >
      <SectionHeader
        title={`${theme === "light" ? "Light" : "Dark"} theme`}
        description="Synthetic examples for visual and keyboard checks"
      />
      <Card>
        <SectionHeader title="Actions and badges" />
        <div className="row section-content">
          {(["primary", "secondary", "ghost", "danger", "accent"] as const).map(
            (variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ),
          )}
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
          <IconButton aria-label="Example icon button">＋</IconButton>
        </div>
        <div className="row section-content">
          {(["neutral", "accent", "warning", "error", "info"] as const).map(
            (variant) => (
              <Chip key={variant} variant={variant}>
                {variant}
              </Chip>
            ),
          )}
          <Badge>Badge</Badge>
          <Tooltip text="Keyboard focus and Escape work here">
            Tooltip example
          </Tooltip>
        </div>
      </Card>
      <div className="gallery-stats">
        <StatCard
          label="Synthetic streams"
          value={3400000}
          sublabel="Consecutive observations"
          delta={12800}
          sparkline={[1, 2, null, 3, 5, 4, 8]}
        />
        <StatCard label="Counter reset" value={1200} delta={-420} />
        <StatCard label="Loading statistic" value={null} loading />
      </div>
      <Card>
        <SectionHeader title="Filters" />
        <FilterBar>
          <SegmentedControl
            label="Example resolution"
            value={mode}
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ]}
            onChange={setMode}
          />
          <Select aria-label="Example select">
            <option>All tracks</option>
            <option>With observations</option>
          </Select>
          <Combobox
            label="Artists"
            value={artist}
            options={options}
            search={search}
            onChange={setArtist}
          />
          <DateRangePicker bounds={bounds} value={range} onChange={setRange} />
          <GranularitySelect value={grain} onChange={setGrain} />
        </FilterBar>
      </Card>
      <Card>
        <Tabs
          label="Example tabs"
          value={tab}
          onChange={setTab}
          items={[
            {
              value: "first",
              label: "Metadata",
              content: (
                <>
                  <KeyValueList
                    items={[
                      {
                        label: "ISRC",
                        value: (
                          <CopyableText text="GBABC2400001" label="ISRC" />
                        ),
                      },
                      {
                        label: "Spotify ID",
                        value: (
                          <CopyableText
                            text="4syntheticTrackIdentifier"
                            label="Spotify ID"
                          />
                        ),
                      },
                      { label: "UTC day", value: "5 Mar 2024" },
                    ]}
                  />
                  <ConfidenceMeter value={0.875} />
                  <ConfidenceMeter value={null} />
                </>
              ),
            },
            {
              value: "second",
              label: "Actions",
              content: (
                <div className="row">
                  <Button onClick={() => setModal(true)}>Open modal</Button>
                  <Button onClick={() => setDrawer(true)}>Open drawer</Button>
                </div>
              ),
            },
          ]}
        />
        <Modal
          open={modal}
          title="Example modal"
          onClose={() => setModal(false)}
        >
          <p>
            Tab stays inside this dialog. Escape closes it and restores focus.
          </p>
          <Button onClick={() => setModal(false)}>Close</Button>
        </Modal>
        <Drawer
          open={drawer}
          title="Example drawer"
          onClose={() => setDrawer(false)}
        >
          <CopyableText text="GBABC2400001" />
          <Button onClick={() => setDrawer(false)}>Close</Button>
        </Drawer>
      </Card>
      <CollapsibleSection
        title="Table row"
        description="Expandable dashboard section"
        defaultOpen
      >
        <DataTable
          label="Synthetic track ranking"
          rows={sorted.slice(page * 3, (page + 1) * 3)}
          columns={[
            {
              key: "name",
              label: "Track",
              sortable: true,
              render: (row) => row.name,
            },
            {
              key: "value",
              label: "Streams",
              sortable: true,
              numeric: true,
              render: (row) => fullNumber(row.value),
            },
          ]}
          rowKey={(row) => row.name}
          sort={sort}
          onSort={setSort}
          pagination={{
            page,
            pageSize: 3,
            total: rankings.length,
            onPageChange: setPage,
          }}
          onRowClick={(row) => setClicked(row.name)}
        />
        <p role="status" className="small">
          {clicked && `Selected ${clicked}`}
        </p>
      </CollapsibleSection>
      <CollapsibleSection title="Empty, loading and error states">
        <EmptyState description="Nothing matches this range." />
        <ErrorState
          message="Synthetic failure for visual checking."
          retry={() => setClicked("Retry clicked")}
        />
        <LoadingState />
        <Skeleton style={{ width: 180, height: 20 }} />
        <DataTable
          label="Empty table"
          columns={[
            {
              key: "name",
              label: "Name",
              render: (row: (typeof rankings)[number]) => row.name,
            },
          ]}
          rows={[]}
          rowKey={(row) => row.name}
          dense
        />
        <DataTable
          label="Loading table"
          columns={[
            {
              key: "name",
              label: "Name",
              render: (row: (typeof rankings)[number]) => row.name,
            },
          ]}
          rows={[]}
          rowKey={(row) => row.name}
          loading
        />
        <DataTable
          label="Error table"
          columns={[
            {
              key: "name",
              label: "Name",
              render: (row: (typeof rankings)[number]) => row.name,
            },
          ]}
          rows={[]}
          rowKey={(row) => row.name}
          error="Synthetic error"
        />
      </CollapsibleSection>
      <TimeSeriesChart
        title="Streams, tracks and observations"
        description="A missing interval, an explicit null and a reset. No interpolation."
        data={timeline}
        series={[
          {
            key: "streams",
            label: "Streams",
            type: "area",
            movingAverage: true,
          },
          { key: "tracks", label: "Tracks", type: "line" },
          { key: "bars", label: "Bar series", type: "bar" },
        ]}
        extraFields={[
          { key: "observations", label: "Observations" },
          { key: "confidence", label: "Confidence" },
        ]}
        events={[
          {
            date: "2024-03-18",
            text: "Reset detected · synthetic event",
            seriesKey: "streams",
          },
        ]}
        brush
      />
      <BarChart title="Vertical ranking" data={rankings} />
      <BarChart title="Horizontal ranking" data={rankings} horizontal />
      <BarGauge
        title="Top tracks"
        description="Top three, sorted by streams"
        data={rankings}
        topN={3}
      />
      <StatPanel
        title="Archived observations"
        value={34000000}
        sublabel="Synthetic statistic"
      />
      <PieChart title="Distribution" data={rankings} />
      <Histogram
        title="Confidence distribution"
        values={[0.1, 0.2, 0.3, 0.3, 0.4, 0.5, 0.7, 0.8, 0.8, 0.9, 0.9, 1]}
        bins={5}
      />
      <CalendarHeatmap
        title="Daily coverage"
        description="Striped = missing. Pale solid = observed zero."
        data={coverage}
      />
      <CollapsibleSection title="Empty chart cases" defaultOpen>
        <TimeSeriesChart
          title="No observations"
          data={[]}
          series={[{ key: "streams", label: "Streams" }]}
        />
        <TimeSeriesChart
          title="Only null observations"
          data={[{ date: "2024-03-05", streams: null }]}
          series={[{ key: "streams", label: "Streams" }]}
        />
        <TimeSeriesChart
          title="No series selected"
          data={timeline}
          series={[]}
        />
        <BarChart title="Empty bars" data={[]} />
        <PieChart
          title="Zero distribution"
          data={[{ name: "Zero", value: 0 }]}
        />
        <CalendarHeatmap title="Empty calendar" data={[]} />
      </CollapsibleSection>
    </section>
  );
}
export default function Gallery() {
  return (
    <>
      <header className="page-header">
        <h1>Component gallery</h1>
        <p className="muted">
          Development only. All examples below use synthetic data.
        </p>
      </header>
      <div className="gallery-grid">
        <GalleryTheme theme="light" />
        <GalleryTheme theme="dark" />
      </div>
    </>
  );
}
