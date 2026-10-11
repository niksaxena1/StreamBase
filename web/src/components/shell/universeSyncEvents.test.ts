import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastUniverseChange, sameUniverse, settingsRequireUniverseRefresh, UNIVERSE_CHANNEL, UNIVERSE_STORAGE_KEY } from "./universeSyncEvents";

afterEach(() => vi.unstubAllGlobals());
describe("universe synchronization", () => {
  it("ignores dormant competitor selection while viewing own catalog", () => {
    expect(sameUniverse({ datasetMode: "own", competitorLabelKey: "a" }, { datasetMode: "own", competitorLabelKey: "b" })).toBe(true);
    expect(settingsRequireUniverseRefresh({ datasetMode: "own" }, { dataset_mode: "own", competitor_label_key: "b" })).toBe(false);
  });
  it("refreshes for a changed dataset or selected competitor, including all competitors", () => {
    expect(settingsRequireUniverseRefresh({ datasetMode: "own" }, { dataset_mode: "competitor", competitor_label_key: "a" })).toBe(true);
    expect(settingsRequireUniverseRefresh({ datasetMode: "competitor", competitorLabelKey: "a" }, { dataset_mode: "own" })).toBe(true);
    expect(settingsRequireUniverseRefresh({ datasetMode: "competitor", competitorLabelKey: "a" }, { dataset_mode: "competitor", competitor_label_key: "b" })).toBe(true);
    expect(settingsRequireUniverseRefresh({ datasetMode: "competitor", competitorLabelKey: "a" }, { dataset_mode: "competitor", competitor_label_key: null })).toBe(true);
  });
  it("treats active same-mode/label selections as no-ops and normalizes all competitors", () => {
    expect(sameUniverse({ datasetMode: "competitor", competitorLabelKey: "a" }, { datasetMode: "competitor", competitorLabelKey: "a" })).toBe(true);
    expect(sameUniverse({ datasetMode: "competitor", competitorLabelKey: null }, { datasetMode: "competitor", competitorLabelKey: "__all__" })).toBe(true);
    expect(settingsRequireUniverseRefresh({ datasetMode: "competitor", competitorLabelKey: "a" }, { dataset_mode: "competitor", competitor_label_key: "a" })).toBe(false);
  });
  it("ignores incomplete, unavailable, and malformed settings responses", () => {
    for (const row of [null, {}, { configured: false }, { dataset_mode: "invalid" }]) {
      expect(settingsRequireUniverseRefresh({ datasetMode: "own" }, row)).toBe(false);
    }
  });
  it("broadcasts successful changes and closes its sender channel", () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("BroadcastChannel", class { constructor(name: string) { expect(name).toBe(UNIVERSE_CHANNEL); } postMessage = postMessage; close = close; });
    broadcastUniverseChange();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: UNIVERSE_CHANNEL });
    expect(close).toHaveBeenCalledOnce();
  });
  it("falls back to storage events when channels are unavailable or blocked", () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { setItem });
    vi.stubGlobal("BroadcastChannel", undefined);
    broadcastUniverseChange();
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("blocked"); } });
    broadcastUniverseChange();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(setItem.mock.calls.every(([key]) => key === UNIVERSE_STORAGE_KEY)).toBe(true);
    expect(setItem.mock.calls[0][1]).not.toBe(setItem.mock.calls[1][1]);
  });
});
