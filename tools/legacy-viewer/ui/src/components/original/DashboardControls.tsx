import { useEffect, useState } from 'react';
import { useUrlState } from '../../app/useUrlState';
import { getJSON } from '../../lib/api';
import { valuesFromUrl, type Dashboard, type Variables, type Variable } from '../../lib/original';
import { Combobox, ErrorState, LoadingState, Select } from '../ui';

type Options = { options: { text: string; value: string }[]; includeAll: boolean; multi: boolean };
export function useDashboardVariables(d: Dashboard) {
  const [state, setState] = useUrlState(), [resolved, setResolved] = useState<{ key: string; options: Record<string, Options>; values: Variables }>(), [error, setError] = useState('');
  const values = valuesFromUrl(d, state.params), key = JSON.stringify([d.key, values]);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    const initial: Variables = JSON.parse(key)[1];
    async function resolve() {
      const options: Record<string, Options> = {}, next: Variables = { ...initial };
      // Hidden, unused variables keep their archived current value. In the older
      // Spotify dashboard allTracks is an unused 34M-row query, not a control.
      const remaining = new Set(Object.keys(d.variables).filter(n => d.variables[n].hide !== 2));
      let added = true;
      while (added) {
        added = false;
        for (const name of [...remaining]) for (const dep of d.variables[name].depends_on ?? []) {
          if (!remaining.has(dep)) { remaining.add(dep); added = true; }
        }
      }
      while (remaining.size) {
        const name = [...remaining].find(n => (d.variables[n].depends_on ?? []).every(dep => !remaining.has(dep)));
        if (!name) throw new Error('Variable dependency cycle');
        const v = d.variables[name];
        options[name] = await getJSON<Options>('/api/original/variable-options', { dashboard: d.key, name, vars: JSON.stringify(next) }, controller.signal);
        const choices = options[name].options;
        const value = next[name];
        if (choices.length && (value == null || !Array.isArray(value) && value !== '$__all' && !choices.some(o => o.value === value))) next[name] = v.multi ? [choices[0].value] : choices[0].value;
        remaining.delete(name);
      }
      if (!controller.signal.aborted) setResolved({ key, options, values: next });
    }
    void resolve().catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load variables'); });
    return () => controller.abort();
  }, [d, key]);
  function change(name: string, value: string | string[]) {
    const params = { ...state.params, [`var-${name}`]: Array.isArray(value) ? JSON.stringify(value) : value };
    const reset = new Set([name]);
    let changed = true;
    while (changed) {
      changed = false;
      Object.entries(d.variables).forEach(([n, v]) => {
        if (!reset.has(n) && v.depends_on?.some(dep => reset.has(dep))) { reset.add(n); delete params[`var-${n}`]; changed = true; }
      });
    }
    setState({ params });
  }
  return { values: resolved?.key === key ? resolved.values : values, options: resolved?.options ?? {}, loading: resolved?.key !== key, error, change };
}
export function VariableSelect({ variable, value, options, onChange }: { variable: Variable; value?: string | string[]; options?: Options; onChange: (value: string | string[]) => void }) {
  const [search, setSearch] = useState('');
  const label = variable.label ?? variable.name, choices = [...(options?.includeAll ? [{ text: 'All', value: '$__all' }] : []), ...(options?.options ?? variable.options)];
  return <div className="original-variable"><span>{label}</span>{variable.multi ? <details><summary>{Array.isArray(value) ? `${value.length} selected` : value || 'Select'}</summary><div className="popover original-multi">
    <input aria-label={`Search ${label}`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search options" />
    {choices.filter(o => o.text.toLowerCase().includes(search.toLowerCase())).map(o => <label key={o.value}><input type="checkbox" checked={Array.isArray(value) && value.includes(o.value)} onChange={e => onChange(e.target.checked ? [...(Array.isArray(value) ? value : []), o.value] : (Array.isArray(value) ? value : []).filter(v => v !== o.value))} />{o.text}</label>)}
  </div></details> : <Combobox label={label} value={typeof value === 'string' ? value : null} options={choices.map(o => ({ value: o.value, label: o.text }))} onChange={onChange} />}</div>;
}
export function VariableBar({ dashboard, controls }: { dashboard: Dashboard; controls: ReturnType<typeof useDashboardVariables> }) {
  return <div className="filter-bar original-variable-bar">{Object.values(dashboard.variables).filter(v => v.hide !== 2).map(v => <VariableSelect key={v.name} variable={v} value={controls.values[v.name]} options={controls.options[v.name]} onChange={value => controls.change(v.name, value)} />)}
    {controls.loading && <LoadingState message="Loading variable options…" />}{controls.error && <ErrorState message={controls.error} />}
  </div>;
}
export function OriginalTimePicker({ dashboard }: { dashboard: Dashboard }) {
  const [state, setState] = useUrlState();
  const from = state.from || dashboard.time.from, to = state.to || dashboard.time.to;
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => setDraft({ from, to }), [from, to]);
  const update = (a: string, b: string) => setState({ from: a, to: b });
  return <div className="filter-bar original-time"><label>Time range <Select aria-label="Original time range" value={from.startsWith('now-') ? from : 'custom'} onChange={e => { if (e.target.value !== 'custom') update(e.target.value, 'now'); }}>
    {['7d', '14d', '30d', '90d', '6M', '1y', '2y'].map(p => <option key={p} value={`now-${p}`}>Last {p === '1y' ? '1 year' : p === '2y' ? '2 years' : p === '6M' ? '6 months' : `${p.slice(0, -1)} days`} of archive</option>)}<option value="custom">Custom UTC range</option>
  </Select></label><label>From (UTC)<input aria-label="Original from" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label><label>To (UTC)<input aria-label="Original to" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label><button className="button" type="button" onClick={() => update(draft.from, draft.to)}>Apply range</button><span className="muted small">now = {dashboard.anchor} UTC</span></div>;
}
