import { describe, it, expect } from "vitest";
import { exportFilterAsJson, importFilterFromJson } from "./filterStorage";
import type { FilterConfig } from "./filterTypes";

// Note: CRUD functions (loadSavedFilters, saveFilter, deleteFilter) hit the
// server and are tested via integration tests.  Here we only test the pure
// client-side helpers that don't require network access.

// ============================================================================
// exportFilterAsJson
// ============================================================================

describe("exportFilterAsJson", () => {
  it("serializes a filter to pretty JSON", () => {
    const filter: FilterConfig = {
      id: "test-123",
      name: "My Filter",
      entityType: "tracks",
      groups: [
        {
          id: "g1",
          logic: "AND",
          conditions: [
            { id: "c1", field: "total_streams", operator: "gt", value: 1000, enabled: true },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const json = exportFilterAsJson(filter);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe("test-123");
    expect(parsed.name).toBe("My Filter");
    expect(parsed.entityType).toBe("tracks");
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].conditions[0].value).toBe(1000);
  });

  it("produces valid JSON that can be re-imported", () => {
    const filter: FilterConfig = {
      id: "round-trip",
      name: "Round Trip Test",
      entityType: "artists",
      groups: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const json = exportFilterAsJson(filter);
    const imported = importFilterFromJson(json);
    expect(imported).not.toBeNull();
    expect(imported!.name).toBe("Round Trip Test");
    expect(imported!.entityType).toBe("artists");
  });
});

// ============================================================================
// importFilterFromJson
// ============================================================================

describe("importFilterFromJson", () => {
  it("imports valid filter JSON", () => {
    const json = JSON.stringify({
      id: "old-id",
      name: "Imported",
      entityType: "tracks",
      groups: [{ id: "g1", logic: "AND", conditions: [] }],
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    });

    const result = importFilterFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Imported");
    expect(result!.entityType).toBe("tracks");
    // id is blank so the server generates a new one on save
    expect(result!.id).toBe("");
  });

  it("assigns default name for unnamed filters", () => {
    const json = JSON.stringify({
      entityType: "tracks",
      groups: [],
    });
    const result = importFilterFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Imported Filter");
  });

  it("returns null for invalid JSON", () => {
    expect(importFilterFromJson("not json")).toBeNull();
    expect(importFilterFromJson("{broken}")).toBeNull();
    expect(importFilterFromJson("")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    // Missing entityType
    expect(importFilterFromJson(JSON.stringify({ groups: [] }))).toBeNull();
    // Missing groups
    expect(importFilterFromJson(JSON.stringify({ entityType: "tracks" }))).toBeNull();
    // Not an object
    expect(importFilterFromJson('"just a string"')).toBeNull();
    expect(importFilterFromJson("42")).toBeNull();
  });

  it("returns null for null value", () => {
    expect(importFilterFromJson(JSON.stringify(null))).toBeNull();
  });
});
