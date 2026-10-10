import { expect, it } from "vitest";
import { csvText } from "./ChartFrame";
it("exports null as a blank and zero as zero, escaping quotes and CSV formula strings", () => {
  expect(
    csvText([
      { date: "2024-03-05", streams: null },
      { date: "2024-03-06", streams: 0 },
    ]),
  ).toContain('"2024-03-05",""\r\n"2024-03-06","0"');
  expect(csvText([{ name: '=HYPERLINK("bad")', value: -12 }])).toContain(
    '"\'=HYPERLINK(""bad"")","-12"',
  );
});
