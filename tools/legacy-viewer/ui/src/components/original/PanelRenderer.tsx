import { useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { DataTable, type Sort } from '../ui/DataTable';
import { Histogram, PieChart } from '../charts';
import { useThemeColors } from '../charts/useThemeColors';
import { chartObservations, fieldConfig, formatField, reduceValues, thresholdColor, utcMillis, type Field, type Frame, type Panel } from '../../lib/original';
import { SafeText } from './SafeText';

export function FrameTable({ frame, panel, anchor }: { frame: Frame; panel: Panel; anchor?: string }) {
  const initial = panel.options?.sortBy?.[0];
  const [page, setPage] = useState(0), [sort, setSort] = useState<Sort>({ key: initial?.displayName ?? '', direction: initial?.desc ? 'desc' : 'asc' });
  const index = frame.columns.findIndex(c => c.name === sort.key);
  const all = frame.rows.map((row, i) => ({ row, i }));
  if (index >= 0) all.sort((a, b) => {
    const x = a.row[index], y = b.row[index];
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * (sort.direction === 'asc' ? 1 : -1);
  });
  return <DataTable<{ row: unknown[]; i: number }> label={panel.title} rows={all.slice(page * 50, page * 50 + 50)} rowKey={r => String(r.i)} dense emptyMessage="No data"
    columns={frame.columns.map((c, i) => ({ key: c.name, label: fieldConfig(panel, c.name).displayName ?? c.name, numeric: c.type === 'number', sortable: true,
      render: r => <span data-original-value={JSON.stringify(r.row[i])}>{formatField(r.row[i], fieldConfig(panel, c.name), anchor)}</span> }))}
    sort={sort} onSort={s => { setSort(s); setPage(0); }} pagination={{ page, pageSize: 50, total: all.length, onPageChange: setPage }} />;
}
type Reduced = { name: string; value: unknown; field: Field };
export function reducedFields(panel: Panel, frames: Frame[]): Reduced[] {
  const options = panel.options?.reduceOptions;
  return frames.flatMap(frame => {
    let indexes = frame.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'number');
    if (options?.fields) { try { const re = new RegExp(options.fields.replace(/^\/(.*)\/$/, '$1')); indexes = frame.columns.map((c, i) => ({ c, i })).filter(({ c }) => re.test(c.name)); } catch { /* keep default */ } }
    if (!indexes.length) indexes = frame.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'time');
    const labelIndex = frame.columns.findIndex(c => c.type === 'string');
    return indexes.flatMap(({ c, i }) => {
      const field = fieldConfig(panel, c.name), name = field.displayName ?? (Object.values(c.labels ?? {}).join(' ') || c.name);
      if (options?.values) return frame.rows.map(row => ({ name: labelIndex >= 0 ? String(row[labelIndex] ?? name) : name, value: row[i], field }));
      return (options?.calcs ?? ['lastNotNull']).map(calc => ({ name, value: reduceValues(frame.rows.map(row => row[i]), calc), field }));
    });
  });
}

function OriginalSeries({ panel, frames, range, height }: { panel: Panel; frames: Frame[]; range: { from: string; to: string }; height: number }) {
  const { ref, colors } = useThemeColors();
  const series = frames.flatMap((f, fi) => f.columns.flatMap((c, ci) => c.type === 'number' ? [{ key: `f${fi}c${ci}`, fi, ci, c, config: fieldConfig(panel, c.name) }] : []));
  const palette = [colors.info, colors.positive, colors.revenue, colors.tracks, colors.warning];
  const data: Record<string, unknown>[] = [];
  // Keep duplicate timestamps as duplicate observations, as in Grafana. Across frames,
  // merge the nth occurrence of a timestamp so no tied daily-mode row is discarded.
  const merged = new Map<string, Record<string, unknown>>();
  frames.forEach((f, fi) => {
    const ti = f.columns.findIndex(c => c.type === 'time'), occurrences = new Map<number, number>();
    if (ti < 0) return;
    f.rows.forEach(row => {
      const t = utcMillis(row[ti]);
      if (!Number.isFinite(t)) return;
      const nth = occurrences.get(t) ?? 0; occurrences.set(t, nth + 1);
      const key = `${t}:${nth}`, record = merged.get(key) ?? { time: t };
      series.filter(s => s.fi === fi).forEach(s => record[s.key] = row[s.ci]);
      merged.set(key, record);
    });
  });
  data.push(...[...merged.values()].sort((a, b) => Number(a.time) - Number(b.time)));
  const from = utcMillis(range.from), to = utcMillis(range.to);
  const visible = data.filter(r => Number(r.time) >= from && Number(r.time) <= to);
  const before = data.filter(r => Number(r.time) < from).at(-1), after = data.find(r => Number(r.time) > to);
  const clipped = [...(before ? [before] : []), ...visible, ...(after ? [after] : [])];
  const plotted = chartObservations(clipped, series.map(s => s.key));
  const revenue = series.some(s => s.config.unit === 'currencyUSD');
  return <div ref={ref} style={{ height, minWidth: 0 }} className="original-chart">
    {plotted !== clipped && <p className="muted small">Chart sampled to {plotted.length.toLocaleString()} observations, preserving extrema and gaps. CSV retains full data.</p>}
    {!visible.length && !(before && after) ? <p className="original-no-data">No data</p> : <ResponsiveContainer width="100%" height={plotted !== clipped ? '90%' : '100%'}><ComposedChart data={plotted} accessibilityLayer margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
      <CartesianGrid stroke={colors.border} vertical={false} />
      <XAxis dataKey="time" type="number" scale="linear" domain={[from, to]} ticks={Array.from({ length: 7 }, (_, i) => from + (to - from) * i / 6)} allowDataOverflow tick={{ fill: colors.muted, fontSize: 11 }} tickFormatter={t => new Date(Number(t)).toISOString().slice(0, 10)} minTickGap={55} />
      <YAxis yAxisId="main" width={65} tick={{ fill: colors.muted, fontSize: 11 }} tickFormatter={n => formatField(n, { unit: 'short' })} />
      {revenue && <YAxis yAxisId="revenue" orientation="right" width={65} tick={{ fill: colors.muted, fontSize: 11 }} tickFormatter={n => formatField(n, { unit: 'currencyUSD', decimals: 0 })} />}
      <Tooltip labelFormatter={t => new Date(Number(t)).toISOString().replace('T', ' ')} formatter={(v, _name, item) => formatField(v, series.find(s => s.key === item.dataKey)?.config)} />
      {panel.options?.legend?.showLegend !== false && <Legend />}
      {series.filter(s => !s.config.custom?.hideFrom?.viz).map((s, i) => {
        const custom = s.config.custom, color = s.config.color?.mode === 'fixed' ? thresholdColor(null, s.config) : palette[i % palette.length];
        const common = { dataKey: s.key, name: s.config.displayName ?? (Object.values(s.c.labels ?? {}).join(' ') || s.c.name),
          yAxisId: s.config.unit === 'currencyUSD' ? 'revenue' : 'main', stroke: color, fill: color,
          isAnimationActive: false, connectNulls: false, stackId: custom?.stacking?.mode !== 'none' && custom?.stacking?.mode ? custom.stacking.group ?? 'stack' : undefined };
        if (custom?.drawStyle === 'bars') return <Bar key={s.key} {...common} fillOpacity={(custom.fillOpacity ?? 100) / 100} />;
        if (custom?.drawStyle === 'points') return <Line key={s.key} {...common} strokeWidth={0} dot={{ r: (custom.pointSize ?? 4) / 2 }} />;
        if ((custom?.fillOpacity ?? 0) > 0) return <Area key={s.key} {...common} type="linear" fillOpacity={(custom?.fillOpacity ?? 0) / 100} strokeWidth={custom?.lineWidth ?? 1} dot={custom?.showPoints === 'always'} />;
        return <Line key={s.key} {...common} type="linear" strokeWidth={custom?.lineWidth ?? 1} dot={custom?.showPoints === 'always'} />;
      })}
    </ComposedChart></ResponsiveContainer>}
  </div>;
}
function OriginalBars({ panel, frames, height }: { panel: Panel; frames: Frame[]; height: number }) {
  const { ref, colors } = useThemeColors(), f = frames[0];
  const xi = f.columns.findIndex(c => c.name === panel.options?.xField || c.type === 'string' || c.type === 'time');
  const numbers = f.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'number');
  const data = f.rows.map(r => Object.fromEntries([['label', String(r[xi >= 0 ? xi : 0] ?? '')], ...numbers.map(({ i }) => [`c${i}`, r[i]])]));
  const horizontal = panel.options?.orientation === 'horizontal';
  return <div ref={ref} style={{ height }}><ResponsiveContainer><ComposedChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} accessibilityLayer>
    <CartesianGrid stroke={colors.border} />
    <XAxis type={horizontal ? 'number' : 'category'} dataKey={horizontal ? undefined : 'label'} tick={{ fill: colors.muted, fontSize: 10 }} />
    <YAxis type={horizontal ? 'category' : 'number'} dataKey={horizontal ? 'label' : undefined} width={horizontal ? 125 : 65} tick={{ fill: colors.muted, fontSize: 10 }} />
    <Tooltip formatter={(v, _name, item) => formatField(v, fieldConfig(panel, numbers.find(n => `c${n.i}` === item.dataKey)?.c.name ?? ''))} />
    {panel.options?.legend?.showLegend !== false && <Legend />}
    {numbers.map(({ c, i }, j) => <Bar key={i} dataKey={`c${i}`} name={fieldConfig(panel, c.name).displayName ?? c.name} fill={[colors.info, colors.positive, colors.revenue, colors.tracks][j % 4]} isAnimationActive={false} />)}
  </ComposedChart></ResponsiveContainer></div>;
}
function OriginalScatter({ panel, frames, height }: { panel: Panel; frames: Frame[]; height: number }) {
  const { ref, colors } = useThemeColors(), f = frames[0], numbers = f.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'number');
  const x = numbers.find(n => n.c.name === panel.options?.dims?.x) ?? numbers[0], y = numbers.find(n => n.c.name === panel.options?.dims?.y) ?? numbers.find(n => n !== x);
  if (!x || !y) return <FrameTable frame={f} panel={panel} />;
  const data = f.rows.filter(r => r[x.i] != null && r[y.i] != null).map(r => ({ x: r[x.i], y: r[y.i] }));
  return <div ref={ref} style={{ height }}><ResponsiveContainer><ScatterChart accessibilityLayer><CartesianGrid stroke={colors.border} />
    <XAxis dataKey="x" type="number" name={x.c.name} tick={{ fill: colors.muted }} /><YAxis dataKey="y" type="number" name={y.c.name} tick={{ fill: colors.muted }} /><Tooltip cursor={{ strokeDasharray: '3 3' }} /><Scatter data={data} fill={colors.info} isAnimationActive={false} />
  </ScatterChart></ResponsiveContainer></div>;
}
export function PanelRenderer({ panel, frames, range, anchor }: { panel: Panel; frames: Frame[]; range: { from: string; to: string }; anchor?: string }) {
  if (panel.type === 'text') return <SafeText content={panel.options?.content ?? ''} mode={panel.options?.mode} />;
  if (!frames.some(f => f.rows.length)) return <p className="original-no-data">No data</p>;
  const height = Math.max(200, Math.min(600, (panel.gridPos?.h ?? 10) * 30 - 110));
  if (panel.type === 'table') return <>{frames.map((f, i) => <FrameTable key={i} frame={f} panel={panel} anchor={anchor ?? range.to} />)}</>;
  if (panel.type === 'timeseries') return <OriginalSeries panel={panel} frames={frames} range={range} height={height} />;
  if (panel.type === 'barchart') return <OriginalBars panel={panel} frames={frames} height={height} />;
  if (panel.type === 'xychart') return <OriginalScatter panel={panel} frames={frames} height={height} />;
  if (panel.type === 'histogram') return <Histogram title="Distribution" values={frames.flatMap(f => f.rows.flatMap(r => r.filter((v): v is number => typeof v === 'number')))} height={height} />;
  const values = reducedFields(panel, frames);
  if (panel.type === 'piechart') return <PieChart title="Distribution" height={height} data={values.map(v => ({ name: v.name, value: typeof v.value === 'number' ? v.value : null }))} />;
  if (panel.type === 'stat') return <div className="original-stats">{values.map((v, i) => <div key={i}><strong data-original-value={JSON.stringify(v.value)} style={{ color: thresholdColor(v.value, v.field) }}>{formatField(v.value, v.field, anchor)}</strong><span>{v.name}</span></div>)}</div>;
  if (panel.type === 'bargauge' || panel.type === 'marcusolsson-treemap-panel') {
    const max = Math.max(1, ...values.map(v => typeof v.value === 'number' ? Math.abs(v.value) : 0));
    const vertical = panel.options?.orientation === 'vertical';
    return <>{panel.type === 'marcusolsson-treemap-panel' && <p className="muted small">treemap rendered as bars</p>}<div className={`original-gauges ${panel.options?.orientation === 'vertical' ? 'vertical' : ''}`}>
      {values.map((v, i) => { const size = `${typeof v.value === 'number' ? Math.min(100, Math.abs(v.value) / (v.field.max ?? max) * 100) : 0}%`; return <div className="original-gauge" key={i}><div className="row spread"><span>{v.name}</span><strong data-original-value={JSON.stringify(v.value)}>{formatField(v.value, v.field)}</strong></div><div className="original-gauge-track"><i style={{ width: vertical ? '100%' : size, height: vertical ? size : '100%', background: thresholdColor(v.value, v.field) }} /></div></div>; })}
    </div></>;
  }
  return <><p className="muted small">{panel.type} rendered as a table</p>{frames.map((f, i) => <FrameTable key={i} frame={f} panel={panel} />)}</>;
}
