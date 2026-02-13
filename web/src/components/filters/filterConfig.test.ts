import { describe, it, expect } from "vitest";
import {
  getOperatorLabel,
  getFieldsForEntity,
  getFieldDefinition,
  getDefaultOperator,
  parseNumberValue,
  formatNumberValue,
  ENTITY_CONFIGS,
  MONTH_OPTIONS,
} from "./filterConfig";

// ============================================================================
// getOperatorLabel
// ============================================================================

describe("getOperatorLabel", () => {
  it("returns labels for number operators", () => {
    expect(getOperatorLabel("gt", "number")).toBe("greater than");
    expect(getOperatorLabel("gte", "number")).toBe("at least");
    expect(getOperatorLabel("lt", "number")).toBe("less than");
    expect(getOperatorLabel("lte", "number")).toBe("at most");
    expect(getOperatorLabel("eq", "number")).toBe("equals");
    expect(getOperatorLabel("between", "number")).toBe("between");
  });

  it("returns labels for date operators", () => {
    expect(getOperatorLabel("before", "date")).toBe("before");
    expect(getOperatorLabel("after", "date")).toBe("after");
    expect(getOperatorLabel("month_is", "date")).toBe("month is");
    expect(getOperatorLabel("year_is", "date")).toBe("year is");
  });

  it("returns labels for text operators", () => {
    expect(getOperatorLabel("contains", "text")).toBe("contains");
    expect(getOperatorLabel("starts_with", "text")).toBe("starts with");
    expect(getOperatorLabel("ends_with", "text")).toBe("ends with");
    expect(getOperatorLabel("not_contains", "text")).toBe("does not contain");
  });

  it("returns labels for select operators", () => {
    expect(getOperatorLabel("in", "select")).toBe("is any of");
    expect(getOperatorLabel("not_in", "multi-select")).toBe("is none of");
  });

  it("returns labels for boolean operators", () => {
    expect(getOperatorLabel("eq", "boolean")).toBe("is");
  });

  it("falls back to operator name for unknown", () => {
    expect(getOperatorLabel("xyz", "number")).toBe("xyz");
    expect(getOperatorLabel("eq", "unknown")).toBe("eq");
  });
});

// ============================================================================
// getFieldsForEntity
// ============================================================================

describe("getFieldsForEntity", () => {
  it("returns track fields", () => {
    const fields = getFieldsForEntity("tracks");
    expect(fields.length).toBeGreaterThan(0);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("total_streams");
    expect(keys).toContain("daily_streams");
    expect(keys).toContain("release_date");
    expect(keys).toContain("track_name");
    expect(keys).toContain("artist");
  });

  it("returns artist fields", () => {
    const fields = getFieldsForEntity("artists");
    expect(fields.length).toBeGreaterThan(0);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("total_streams");
    expect(keys).toContain("track_count");
    expect(keys).toContain("artist_name");
  });

  it("returns playlist fields", () => {
    const fields = getFieldsForEntity("playlists");
    expect(fields.length).toBeGreaterThan(0);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("track_count");
    expect(keys).toContain("display_name");
    expect(keys).toContain("is_catalog");
    expect(keys).toContain("collector");
  });

  it("returns empty for unknown entity", () => {
    expect(getFieldsForEntity("unknown")).toEqual([]);
  });
});

// ============================================================================
// getFieldDefinition
// ============================================================================

describe("getFieldDefinition", () => {
  it("finds a field by key", () => {
    const field = getFieldDefinition("tracks", "total_streams");
    expect(field).toBeDefined();
    expect(field!.label).toBe("Total Streams");
    expect(field!.type).toBe("number");
  });

  it("returns undefined for missing field", () => {
    expect(getFieldDefinition("tracks", "nonexistent")).toBeUndefined();
  });
});

// ============================================================================
// getDefaultOperator
// ============================================================================

describe("getDefaultOperator", () => {
  it("returns first operator from field definition", () => {
    const field = getFieldDefinition("tracks", "total_streams")!;
    expect(getDefaultOperator(field)).toBe("gt");
  });

  it("falls back to eq for empty operators", () => {
    const field = { key: "test", label: "Test", type: "number" as const, operators: [] };
    expect(getDefaultOperator(field as any)).toBe("eq");
  });
});

// ============================================================================
// parseNumberValue
// ============================================================================

describe("parseNumberValue", () => {
  it("parses plain numbers", () => {
    expect(parseNumberValue("1000")).toBe(1000);
    expect(parseNumberValue("0")).toBe(0);
    expect(parseNumberValue("3.14")).toBe(3.14);
  });

  it("parses K suffix", () => {
    expect(parseNumberValue("100k")).toBe(100_000);
    expect(parseNumberValue("100K")).toBe(100_000);
    expect(parseNumberValue("1.5k")).toBe(1_500);
  });

  it("parses M suffix", () => {
    expect(parseNumberValue("5m")).toBe(5_000_000);
    expect(parseNumberValue("5M")).toBe(5_000_000);
    expect(parseNumberValue("2.5M")).toBe(2_500_000);
  });

  it("parses B suffix", () => {
    expect(parseNumberValue("1b")).toBe(1_000_000_000);
    expect(parseNumberValue("1B")).toBe(1_000_000_000);
  });

  it("handles commas and underscores", () => {
    expect(parseNumberValue("1,000,000")).toBe(1_000_000);
    expect(parseNumberValue("1_000_000")).toBe(1_000_000);
  });

  it("returns null for empty/invalid input", () => {
    expect(parseNumberValue("")).toBeNull();
    expect(parseNumberValue("abc")).toBeNull();
    expect(parseNumberValue(null as any)).toBeNull();
  });
});

// ============================================================================
// formatNumberValue
// ============================================================================

describe("formatNumberValue", () => {
  it("formats billions", () => {
    expect(formatNumberValue(1_000_000_000)).toBe("1B");
    expect(formatNumberValue(2_500_000_000)).toBe("2.5B");
  });

  it("formats millions", () => {
    expect(formatNumberValue(1_000_000)).toBe("1M");
    expect(formatNumberValue(5_500_000)).toBe("5.5M");
  });

  it("formats thousands", () => {
    expect(formatNumberValue(1_000)).toBe("1K");
    expect(formatNumberValue(100_000)).toBe("100K");
  });

  it("formats small numbers as-is", () => {
    expect(formatNumberValue(500)).toBe("500");
    expect(formatNumberValue(0)).toBe("0");
  });

  it("returns empty for non-finite", () => {
    expect(formatNumberValue(NaN)).toBe("");
    expect(formatNumberValue(Infinity)).toBe("");
  });
});

// ============================================================================
// ENTITY_CONFIGS
// ============================================================================

describe("ENTITY_CONFIGS", () => {
  it("has tracks, artists, playlists", () => {
    expect(Object.keys(ENTITY_CONFIGS)).toContain("tracks");
    expect(Object.keys(ENTITY_CONFIGS)).toContain("artists");
    expect(Object.keys(ENTITY_CONFIGS)).toContain("playlists");
  });

  it("each entity has required fields", () => {
    for (const key of Object.keys(ENTITY_CONFIGS)) {
      const config = ENTITY_CONFIGS[key];
      expect(config.entityType).toBe(key);
      expect(config.label).toBeTruthy();
      expect(config.fields.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// MONTH_OPTIONS
// ============================================================================

describe("MONTH_OPTIONS", () => {
  it("has 12 months", () => {
    expect(MONTH_OPTIONS).toHaveLength(12);
  });

  it("starts with January and ends with December", () => {
    expect(MONTH_OPTIONS[0].label).toBe("January");
    expect(MONTH_OPTIONS[11].label).toBe("December");
  });

  it("has correct values 1-12", () => {
    for (let i = 0; i < 12; i++) {
      expect(MONTH_OPTIONS[i].value).toBe(String(i + 1));
    }
  });
});
