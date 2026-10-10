import { expect, it } from 'vitest';
import { chartObservations, formatField, layoutPanels, reduceValues, utcMillis, type Panel } from './original';
it('formats integral USD amounts without conflicting Intl precision bounds', () => {
  expect(formatField(100, { unit: 'currencyUSD' })).toBe('$100.00');
  expect(formatField(100.2, { unit: 'currencyUSD', decimals: 0 })).toBe('$100');
  expect(formatField(null, { unit: 'currencyUSD' })).toBe('—');
  expect(formatField(12.5, { unit: 'percent' })).toBe('12.5%');
});
it('keeps null gaps, distinguishes last from lastNotNull, and reduces the requested data', () => {
  expect(reduceValues([1, null, 3, null], 'last')).toBe(null);
  expect(reduceValues([1, null, 3, null], 'lastNotNull')).toBe(3);
  expect(reduceValues([1, null, 3], 'mean')).toBe(2);
  expect(reduceValues([1, null, 3], 'sum')).toBe(4);
  expect(reduceValues([1, null, 3], 'count')).toBe(3);
  expect(reduceValues([null], 'max')).toBe(null);
});
it('parses archive wall-clock timestamps as UTC and anchors relative date units', () => {
  expect(utcMillis('2025-12-22 12:31:38')).toBe(Date.parse('2025-12-22T12:31:38Z'));
  expect(formatField('2025-12-21 12:00:00', { unit: 'dateTimeFromNow' }, '2025-12-22T12:00:00Z')).toBe('yesterday');
});
it('compacts stale collapsed-row y offsets while retaining nested vertical positions', () => {
  const panel = (id: string, x: number, y: number, h: number, w: number): Panel => ({ id, title: id, type: 'timeseries', status: 'implemented', panel_id: 1, quirks: [], gridPos: { x, y, h, w } });
  const result = layoutPanels([panel('a', 0, 1, 8, 5), panel('b', 5, 1, 8, 19), panel('c', 0, 366, 4, 5), panel('d', 5, 366, 8, 19), panel('e', 0, 370, 4, 5)]);
  expect(result[0].gridPos?.y).toBe(0);
  expect(result[2].gridPos?.y).toBe(10);
  expect(result[2].gridPos?.h).toBe(10);
  expect(result[4].gridPos?.y).toBe(20);
  expect(result[3].gridPos?.h).toBe(20);
});
it('bounds large chart work while preserving spikes and every null boundary', () => {
  const data = Array.from({ length: 50000 }, (_, time) => ({ time, value: time === 12001 ? 999999 : time === 12003 || time === 12005 ? null : 1 }));
  const sampled = chartObservations(data, ['value']);
  expect(sampled.length).toBeLessThan(2501);
  for (const index of [0, 12001, 12002, 12003, 12004, 12005, 12006, 49999]) expect(sampled).toContain(data[index]);
  expect(chartObservations(data.slice(0, 10), ['value'])).toEqual(data.slice(0, 10));
});
