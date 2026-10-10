/**
 * SVG path for a sparkline. `null` breaks the line (missing data is never drawn as zero).
 * `area` closes only the single longest continuous run to the baseline, for a soft fill.
 */
export function sparklinePath(
  values: (number | null)[],
  width: number,
  height: number,
  pad = 2,
): { line: string; area: string } {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!known.length) return { line: "", area: "" };
  const min = Math.min(...known),
    max = Math.max(...known),
    range = max - min || 1;
  const x = (i: number) =>
    values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / range) * (height - pad * 2));
  const runs: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length) runs.push(current);
      current = [];
    } else current.push({ i, v });
  });
  if (current.length) runs.push(current);
  const f = (n: number) => Number(n.toFixed(1));
  const line = runs
    .map((run) =>
      run.length === 1
        ? `M${f(x(run[0].i))},${f(y(run[0].v))} L${f(x(run[0].i) + 0.01)},${f(y(run[0].v))}`
        : run.map((p, k) => `${k ? "L" : "M"}${f(x(p.i))},${f(y(p.v))}`).join(" "),
    )
    .join(" ");
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a), runs[0]);
  const area =
    longest.length > 1
      ? `${longest.map((p, k) => `${k ? "L" : "M"}${f(x(p.i))},${f(y(p.v))}`).join(" ")} L${f(x(longest[longest.length - 1].i))},${height} L${f(x(longest[0].i))},${height} Z`
      : "";
  return { line, area };
}
