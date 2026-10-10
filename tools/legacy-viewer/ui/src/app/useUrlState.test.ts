import { expect, it } from "vitest";
import { parseHash, serializeState } from "./useUrlState";
it("opens lookup by default and round-trips its bookmark", () => {
  expect(parseHash("").page).toBe("lookup");
  const state = parseHash(
    "#/lookup?isrc=SE6QE2204745&from=2025-03-01&to=2025-03-31",
  );
  expect(parseHash(serializeState(state))).toEqual(state);
});
it("round-trips dataset, date range, grain and page parameters", () => {
  const state = parseHash(
    "#/tracks?dataset=stats&from=2024-03-05&to=2024-04-01&grain=weekly&isrc=GBABC2400001&page=2",
  );
  expect(parseHash(serializeState(state))).toEqual(state);
  expect(state.params.isrc).toBe("GBABC2400001");
});
it("defaults unsupported dataset and grain values", () => {
  expect(parseHash("#/overview?dataset=public&grain=hourly")).toMatchObject({
    dataset: "stats2",
    grain: "daily",
  });
});
it("round-trips original relative ranges, UTC timestamps and multi-variable values", () => {
  const state = parseHash(
    "#/original?dash=stats2.tax-v2&from=now-6M&to=2025-12-22T12:31:38Z&var-month=%5B%222025-01-01%22%5D",
  );
  expect(state.from).toBe("now-6M");
  expect(state.to).toBe("2025-12-22T12:31:38Z");
  expect(parseHash(serializeState(state))).toEqual(state);
});
it("rejects invalid and inverted calendar dates without crashing the shell", () => {
  expect(parseHash("#/tracks?from=2024-02-31&to=garbage")).toMatchObject({
    from: "",
    to: "",
  });
  expect(parseHash("#/tracks?from=2024-03-10&to=2024-03-05")).toMatchObject({
    from: "",
    to: "",
  });
});
