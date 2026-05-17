export type DatasetMode = "own" | "competitor";

export function normalizeDatasetMode(value: unknown): DatasetMode {
  return value === "competitor" ? "competitor" : "own";
}
