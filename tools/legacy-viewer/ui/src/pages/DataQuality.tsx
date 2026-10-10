import { useQuery } from "../lib/api";
import {
  numberValue,
  textValue,
  type Quality,
  type Row,
} from "../lib/explorer";
import { BarChart, CalendarHeatmap } from "../components/charts";
import {
  Card,
  Chip,
  col,
  FilterBar,
  Method,
  Metrics,
  Notes,
  Rows,
  Select,
  Status,
  Title,
  useExplorer,
} from "./shared";
function Verification({ value, path = "" }: { value: unknown; path?: string }) {
  if (Array.isArray(value))
    return (
      <>
        {value.map((v, i) => (
          <Verification key={i} path={`${path} ${i + 1}`} value={v} />
        ))}
      </>
    );
  if (value && typeof value === "object" && "passed" in value) {
    const check = value as Row;
    return (
      <div className="row spread verification-row">
        <span>
          {textValue(check.name)}
          <small className="muted">
            {check.note ? ` · ${textValue(check.note)}` : ""}
          </small>
        </span>
        <Chip variant={check.info ? "info" : check.passed ? "accent" : "error"}>
          {check.info ? "Info" : check.passed ? "Pass" : "Fail"}
        </Chip>
      </div>
    );
  }
  if (value && typeof value === "object" && !Array.isArray(value))
    return (
      <>
        {Object.entries(value as Row).map(([k, v]) => (
          <Verification key={k} path={path ? `${path} / ${k}` : k} value={v} />
        ))}
      </>
    );
  const pass =
    typeof value === "boolean"
      ? value
      : path.includes("failed") && Array.isArray(value)
        ? value.length === 0
        : undefined;
  return (
    <div className="row spread verification-row">
      <span>{path.replaceAll("_", " ")}</span>
      <Chip
        variant={
          pass === true ? "accent" : pass === false ? "error" : "neutral"
        }
      >
        {pass === true ? "Pass" : pass === false ? "Fail" : textValue(value)}
      </Chip>
    </div>
  );
}
export default function DataQualityPage() {
  const e = useExplorer(),
    q = useQuery<Quality>("/api/quality", e.params),
    metric = e.state.params.metric || "observations";
  return (
    <>
      <Title description="Coverage and confidence summaries cover the dataset archive; resets follow the selected date range.">
        Data quality
      </Title>
      <Status query={q}>
        {(d) => (
          <>
            <FilterBar>
              <label className="row">
                Coverage metric
                <Select
                  value={metric}
                  onChange={(ev) => e.filter({ metric: ev.target.value })}
                >
                  <option value="observations">Observations</option>
                  <option value="tracks">Tracks</option>
                </Select>
              </label>
            </FilterBar>
            <CalendarHeatmap
              title="UTC collection coverage"
              actions={
                <Method method="Raw observation counts across every linked ID; missing dates are absent, never zero" />
              }
              bounds={{
                from: e.state.from || String(d.coverage[0]?.day),
                to: e.state.to || String(d.coverage.at(-1)?.day),
              }}
              data={d.coverage.map((r) => ({
                date: String(r.day),
                value: numberValue(r[metric]),
              }))}
            />
            <h2>Collection gaps</h2>
            <Rows
              label="Collection gaps"
              rows={d.calendar_gaps.filter(
                (r) =>
                  (!e.state.from || r.to >= e.state.from) &&
                  (!e.state.to || r.from <= e.state.to),
              )}
              columns={[
                col("from", "Start"),
                col("to", "End"),
                col("days", "Length (days)", true),
              ]}
            />
            <h2>Counter resets</h2>
            <Rows
              label="Counter resets"
              rows={d.resets}
              columns={[
                col("day", "Date"),
                col("song_name", "Track"),
                col("artist", "Artist"),
                col("delta", "Raw delta", true),
                col("streams", "Counter", true),
              ]}
              onRowClick={(r) => e.go("track", { isrc: String(r.isrc) })}
            />
            <BarChart
              title="Low-confidence track-days by month"
              description="Mode confidence below 50%; archive-wide counts."
              actions={
                <Method method="Selected ISRC mode frequency / observation count below 0.5" />
              }
              data={d.low_confidence.map((r) => ({
                name: String(r.month).slice(0, 7),
                value: numberValue(r.count),
              }))}
            />
            <Metrics
              items={[
                {
                  label: "Linked-ID disagreement days",
                  value: d.linked_id_disagreements.count,
                },
              ]}
            />
            <Rows
              label="Largest linked-ID disagreements"
              rows={d.linked_id_disagreements.top}
              onRowClick={(r) => e.go("track", { isrc: String(r.isrc) })}
            />
            <h2>Build verification checklist</h2>
            <Card>
              <Verification
                value={{
                  ...d.verification,
                  verification: e.meta.data?.build.verification,
                  derive_verification: e.meta.data?.build.derive_verification,
                  build_failed_checks: e.meta.data?.build.build_failed_checks,
                }}
              />
            </Card>
            <h2>How numbers are computed</h2>
            <Notes notes={d.notes} />
          </>
        )}
      </Status>
    </>
  );
}
