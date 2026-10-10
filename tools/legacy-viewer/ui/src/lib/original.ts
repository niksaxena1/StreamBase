import type { Params } from './api';
export type VariableValue = string | string[];
export type Variables = Record<string, VariableValue>;
export type Variable = {
  name: string; label?: string; type: string; multi?: boolean; includeAll?: boolean;
  hide?: number; current?: { value: VariableValue; text?: VariableValue };
  depends_on?: string[]; options: { text: string; value: string }[];
};
export type Field = {
  unit?: string; decimals?: number; displayName?: string; min?: number; max?: number;
  color?: { mode?: string; fixedColor?: string };
  thresholds?: { mode?: string; steps: { value?: number | null; color: string }[] };
  custom?: { drawStyle?: string; fillOpacity?: number; showPoints?: string; pointSize?: number;
    lineWidth?: number; lineInterpolation?: string; stacking?: { mode: string; group?: string };
    hideFrom?: { viz?: boolean; legend?: boolean; tooltip?: boolean }; axisPlacement?: string };
};
export type Panel = {
  id: string; instance?: string; panel_id: number; title: string; type: string; row?: string;
  gridPos?: { x: number; y: number; w: number; h: number }; collapsed?: boolean;
  status: string; status_reason?: string; quirks: string[]; playlist_ids?: string[];
  fieldConfig?: { defaults?: Field; overrides?: { matcher: { id: string; options: string }; properties: { id: string; value: unknown }[] }[] };
  options?: { content?: string; mode?: string; orientation?: string; displayMode?: string;
    reduceOptions?: { calcs?: string[]; values?: boolean; fields?: string }; legend?: { showLegend?: boolean };
    dims?: { x?: string; y?: string }; xField?: string; sortBy?: { displayName: string; desc?: boolean }[] };
};
export type DashboardRow = { id: string | number; title: string; collapsed: boolean; panels: Panel[] };
export type Dashboard = { key: string; title: string; server: string; version: number; grafana_version: string;
  dataset: string; time: { from: string; to: string }; default_time_range: { from: string; to: string };
  anchor: string; starred: boolean; variables: Record<string, Variable>; rows: DashboardRow[]; identical_panel_ids: number[] };
export type Frame = { refId: string; name?: string; columns: { name: string; type: string; labels?: Record<string, string> }[]; rows: unknown[][] };
export type Validation = { cases_run: number; cases_passed: number; outcomes: Record<string, number>; notes: string[] };
export type PanelResult = { frames: Frame[]; truncated: boolean; ms: number; status: string; quirks: string[];
  validation: Validation; time_range: { from: string; to: string } };

export function valuesFromUrl(d: Dashboard, params: Record<string, string>): Variables {
  const values: Variables = {};
  Object.entries(d.variables).forEach(([name, v]) => {
    const raw = params[`var-${name}`];
    if (raw !== undefined) {
      try { const parsed: unknown = v.multi ? JSON.parse(raw) : raw; values[name] = Array.isArray(parsed) && parsed.every(v => typeof v === 'string') ? parsed : raw; } catch { values[name] = v.multi ? [raw] : raw; }
    } else if (v.current && !(v.current.value === '$__all' && !v.includeAll)) values[name] = v.current.value;
  });
  return values;
}
export function titleText(title: string, values: Variables, d: Dashboard): string {
  return title.replace(/\$\{(\w+)(?::\w+)?\}|\$(\w+)|\[\[(\w+)\]\]/g, (_, a, b, c) => {
    const name: string = a || b || c, value = values[name];
    const label = (v: string) => d.variables[name]?.options.find(o => o.value === v)?.text ?? v;
    return Array.isArray(value) ? value.map(label).join(', ') : value === '$__all' ? 'All' : value == null ? '' : label(value);
  });
}
export function panelParams(p: Panel, values: Variables, range: { from?: string; to?: string }): Params {
  return { id: p.id, instance: p.instance, vars: JSON.stringify(values), from: range.from || undefined, to: range.to || undefined };
}
export function fieldConfig(p: Panel, name: string): Field {
  const field: Field = { ...p.fieldConfig?.defaults, custom: { ...p.fieldConfig?.defaults?.custom } };
  p.fieldConfig?.overrides?.forEach(o => {
    let match = o.matcher.id === 'byName' && o.matcher.options === name;
    if (o.matcher.id === 'byRegexp') { try { match = new RegExp(o.matcher.options).test(name); } catch { /* invalid original pattern */ } }
    if (!match) return;
    o.properties.forEach(({ id, value }) => {
      if (id.startsWith('custom.')) field.custom = { ...field.custom, [id.slice(7)]: value };
      else Object.assign(field, { [id]: value });
    });
  });
  return field;
}
export function formatField(value: unknown, config: Field = {}, anchor?: string): string {
  if (value == null || typeof value === 'number' && !Number.isFinite(value)) return '—';
  if (config.unit?.startsWith('dateTime')) {
    const time = utcMillis(value);
    if (config.unit === 'dateTimeFromNow' && anchor && Number.isFinite(time)) {
      const seconds = (time - utcMillis(anchor)) / 1000;
      const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
      const [unit, divisor] = units.find(([, n]) => Math.abs(seconds) >= n) ?? units.at(-1)!;
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
    }
    return Number.isFinite(time) ? new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : String(value);
  }
  if (typeof value !== 'number') return String(value);
  const decimals = Math.min(20, Math.max(0, config.decimals ?? (config.unit === 'currencyUSD' ? 2 : Number.isInteger(value) ? 0 : 2)));
  const opts: Intl.NumberFormatOptions = { maximumFractionDigits: decimals, minimumFractionDigits: config.decimals ?? 0 };
  if (config.unit === 'currencyUSD') return new Intl.NumberFormat('en-US', { ...opts, style: 'currency', currency: 'USD', minimumFractionDigits: config.decimals == null ? 2 : decimals }).format(value);
  if (config.unit === 'short') opts.notation = 'compact';
  return new Intl.NumberFormat('en-US', opts).format(value) + (config.unit === 'percent' ? '%' : '');
}
export function utcMillis(value: unknown): number {
  if (typeof value === 'number') return value;
  let text = String(value).replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00Z';
  else if (!/Z$|[+-]\d{2}:\d{2}$/.test(text)) text += 'Z';
  return Date.parse(text);
}

// Bound SVG work only; API frames, reducers, tables and exports remain untouched.
// Keep extrema and null boundaries so spikes and gaps survive chart sampling.
export function chartObservations(data: Record<string, unknown>[], fields: string[], limit = 2500) {
  if (data.length <= limit) return data;
  const chunkSize = Math.ceil(data.length / Math.max(1, Math.floor(limit / (2 + fields.length * 4))));
  const indexes = new Set<number>();
  for (let start = 0; start < data.length; start += chunkSize) {
    const end = Math.min(data.length, start + chunkSize);
    indexes.add(start); indexes.add(end - 1);
    for (const field of fields) {
      let min = -1, max = -1;
      for (let i = start; i < end; i++) {
        const value = data[i][field];
        if (i > 0 && (value == null) !== (data[i - 1][field] == null)) { indexes.add(i - 1); indexes.add(i); }
        if (value == null) continue;
        if (typeof value !== 'number') continue;
        if (min < 0 || value < Number(data[min][field])) min = i;
        if (max < 0 || value > Number(data[max][field])) max = i;
      }
      for (const i of [min, max]) if (i >= 0) indexes.add(i);
    }
  }
  return [...indexes].sort((a, b) => a - b).map(i => data[i]);
}
export function reduceValues(values: unknown[], calc = 'lastNotNull'): unknown {
  const valid = values.filter(v => v != null);
  if (calc === 'last') return values.at(-1) ?? null;
  if (calc === 'first') return values[0] ?? null;
  if (calc === 'lastNotNull') return valid.at(-1) ?? null;
  if (calc === 'count') return values.length;
  const nums = valid.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  if (calc === 'sum' || calc === 'mean') return nums.reduce((a, b) => a + b, 0) / (calc === 'mean' ? nums.length : 1);
  if (calc === 'max') return nums.reduce((a, b) => Math.max(a, b));
  if (calc === 'min') return nums.reduce((a, b) => Math.min(a, b));
  return valid.at(-1) ?? null;
}
export function thresholdColor(value: unknown, field: Field): string {
  const palette: Record<string, string> = { green: 'var(--sb-positive)', red: 'var(--sb-error)', blue: 'var(--sb-info)', yellow: 'var(--sb-warning)', orange: '#ff9830' };
  let color = field.color?.fixedColor || 'var(--sb-accent)';
  if (field.color?.mode === 'thresholds') field.thresholds?.steps.forEach(s => {
    const n = field.thresholds?.mode === 'percentage' && typeof value === 'number' ? (value - (field.min ?? 0)) / ((field.max ?? 100) - (field.min ?? 0)) * 100 : value;
    if (s.value == null || typeof n === 'number' && n >= s.value) color = s.color;
  });
  return palette[color] || (color.startsWith('#') || color.startsWith('var(') ? color : 'var(--sb-accent)');
}
export function originalHref(dashboard: string, row?: string, vars: Variables = {}): string {
  const query = new URLSearchParams({ dash: dashboard, dataset: dashboard.startsWith('pf.') ? 'followers' : dashboard.startsWith('stats.') ? 'stats' : 'stats2' });
  if (row) query.set('row', row);
  Object.entries(vars).forEach(([k, v]) => query.set(`var-${k}`, Array.isArray(v) ? JSON.stringify(v) : v));
  return `#/original?${query}`;
}

/** Grafana saves stale y offsets in collapsed rows. Compress only empty vertical
 * spans, then preserve occupied spans and extend tiny cells to readable heights. */
export function layoutPanels(panels: Panel[]): Panel[] {
  const chartTypes = new Set(['timeseries', 'barchart', 'piechart', 'histogram', 'xychart']);
  const intervals = panels.map(p => ({ p, start: p.gridPos?.y ?? 0, end: (p.gridPos?.y ?? 0) + (p.gridPos?.h ?? 8), min: p.type === 'stat' ? 5 : chartTypes.has(p.type) ? 10 : 8 }));
  const coords = [...new Set(intervals.flatMap(i => [i.start, i.end]))].sort((a, b) => a - b);
  const mapped = new Map<number, number>();
  coords.forEach((y, index) => {
    const prev = coords[index - 1];
    const occupied = index > 0 && intervals.some(i => i.start <= prev && i.end >= y);
    let value = index ? (mapped.get(prev) ?? 0) + (occupied ? y - prev : 0) : 0;
    intervals.filter(i => i.end === y).forEach(i => value = Math.max(value, (mapped.get(i.start) ?? 0) + Math.max(i.end - i.start, i.min)));
    mapped.set(y, value);
  });
  return intervals.map(({ p, start, end }) => ({ ...p, gridPos: { x: p.gridPos?.x ?? 0, w: p.gridPos?.w ?? 24, y: mapped.get(start) ?? 0, h: (mapped.get(end) ?? 8) - (mapped.get(start) ?? 0) } }));
}
