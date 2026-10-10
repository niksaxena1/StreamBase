import { useQuery } from "../lib/api";
import { humanBytes, numberValue, textValue, type Row } from "../lib/explorer";
import { CopyableText, Tabs } from "../components/ui";
import { RawBrowser } from '../components/original/RawBrowser';
import { useUrlState } from '../app/useUrlState';
import { Card, Chip, col, Metrics, Notes, Rows, Status, Title } from "./shared";
function ArchiveInventory() {
  const q = useQuery<{ rows: Row[]; notes: string[] }>("/api/archive");
  return (
    <>
      <Title description="Backup provenance and the boundary of this viewer.">
        Archive
      </Title>
      <Status query={q}>
        {(d) => (
          <>
            <Notes notes={d.notes} />
            {[...new Set(d.rows.map((r) => String(r.server)))].map((server) => {
              const rows = d.rows.filter((r) => r.server === server);
              return (
                <section className="archive-server" key={server}>
                  <h2>{server}</h2>
                  <Metrics
                    items={[
                      { label: "Artifacts", value: rows.length },
                      {
                        label: "Total preserved size",
                        value: humanBytes(
                          rows.reduce(
                            (s, r) => s + (numberValue(r.size_bytes) ?? 0),
                            0,
                          ),
                        ),
                      },
                      {
                        label: "Visualized",
                        value: rows.filter(
                          (r) => r.in_viewer !== "preserved only",
                        ).length,
                      },
                    ]}
                  />
                  <Rows
                    label={`${server} inventory`}
                    rows={rows}
                    columns={[
                      col("relative_path", "Path"),
                      col("kind", "Kind"),
                      {
                        key: "size_bytes",
                        label: "Size",
                        mono: true,
                        render: (r) => humanBytes(r.size_bytes),
                      },
                      {
                        key: "sha256",
                        label: "SHA-256",
                        render: (r) =>
                          r.sha256 ? (
                            <span className="row">
                              <span className="mono">
                                {String(r.sha256).slice(0, 12)}…
                              </span>
                              <details>
                                <summary>Copy checksum</summary>
                                <CopyableText
                                  text={String(r.sha256)}
                                  label="SHA-256"
                                />
                              </details>
                            </span>
                          ) : (
                            "—"
                          ),
                      },
                      col("description", "Description"),
                      {
                        key: "in_viewer",
                        label: "In viewer",
                        render: (r) => (
                          <Chip
                            variant={
                              r.in_viewer !== "preserved only"
                                ? "accent"
                                : "neutral"
                            }
                          >
                            {r.in_viewer !== "preserved only"
                              ? "Visualized"
                              : "Preserved only"}
                          </Chip>
                        ),
                      },
                    ]}
                  />
                </section>
              );
            })}
            <Card className="explorer-notes">
              <h2>What remains in the original backup</h2>
              <p>
                Raw PostgreSQL clusters, application files, operating-system
                archives, Grafana configuration, and other preserved artifacts
                are not interactive pages in this app. Source data and checksums
                remain in the backup.
              </p>
              <p className="mono backup-path">
                {textValue(
                  "Archive location is configured at build time",
                )}
              </p>
              <p>
                Config and secret files are deliberately not reproduced. The
                viewer shows their inventory metadata only.
              </p>
            </Card>
          </>
        )}
      </Status>
    </>
  );
}
export default function ArchivePage() {
  const [state, setState] = useUrlState();
  return <><Title>Archive</Title><Tabs label="Archive views" value={state.params.tab || 'inventory'} onChange={tab => setState({ params: { ...state.params, tab } })}
    items={[{ value: 'inventory', label: 'Provenance', content: state.params.tab !== 'raw' ? <ArchiveInventory /> : null }, { value: 'raw', label: 'Raw observations', content: state.params.tab === 'raw' ? <RawBrowser /> : null }]} /></>;
}
