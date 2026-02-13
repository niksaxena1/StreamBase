import { describe, it, expect } from "vitest";
import {
  createEmptyCondition,
  createEmptyGroup,
  createEmptyFilter,
} from "./filterTypes";

// ============================================================================
// createEmptyCondition
// ============================================================================

describe("createEmptyCondition", () => {
  it("returns a valid condition with defaults", () => {
    const cond = createEmptyCondition();
    expect(cond.id).toBeTruthy();
    expect(typeof cond.id).toBe("string");
    expect(cond.field).toBe("");
    expect(cond.operator).toBe("eq");
    expect(cond.value).toBeNull();
    expect(cond.enabled).toBe(true);
  });

  it("generates unique IDs", () => {
    const a = createEmptyCondition();
    const b = createEmptyCondition();
    expect(a.id).not.toBe(b.id);
  });
});

// ============================================================================
// createEmptyGroup
// ============================================================================

describe("createEmptyGroup", () => {
  it("returns a group with default AND logic", () => {
    const group = createEmptyGroup();
    expect(group.id).toBeTruthy();
    expect(group.logic).toBe("AND");
    expect(group.conditions).toHaveLength(1);
    expect(group.conditions[0].field).toBe("");
  });

  it("accepts OR logic", () => {
    const group = createEmptyGroup("OR");
    expect(group.logic).toBe("OR");
  });

  it("generates unique IDs", () => {
    const a = createEmptyGroup();
    const b = createEmptyGroup();
    expect(a.id).not.toBe(b.id);
  });
});

// ============================================================================
// createEmptyFilter
// ============================================================================

describe("createEmptyFilter", () => {
  it("returns a filter with default tracks entity", () => {
    const filter = createEmptyFilter();
    expect(filter.id).toBeTruthy();
    expect(filter.name).toBe("");
    expect(filter.entityType).toBe("tracks");
    expect(filter.groups).toHaveLength(1);
    expect(filter.createdAt).toBeTruthy();
    expect(filter.updatedAt).toBeTruthy();
  });

  it("accepts entity type override", () => {
    const filter = createEmptyFilter("artists");
    expect(filter.entityType).toBe("artists");

    const filter2 = createEmptyFilter("playlists");
    expect(filter2.entityType).toBe("playlists");
  });

  it("generates unique IDs", () => {
    const a = createEmptyFilter();
    const b = createEmptyFilter();
    expect(a.id).not.toBe(b.id);
  });

  it("timestamps are valid ISO strings", () => {
    const filter = createEmptyFilter();
    expect(() => new Date(filter.createdAt)).not.toThrow();
    expect(new Date(filter.createdAt).getTime()).toBeGreaterThan(0);
  });
});
