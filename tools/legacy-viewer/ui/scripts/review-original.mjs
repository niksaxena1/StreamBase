// Browser assertions through the Playwright CLI, against the review server only.
// PWCLI_JS points to the installed @playwright/cli/playwright-cli.js.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = `http://127.0.0.1:${process.env.LEGACY_API_PORT || 8772}`;
const cli = process.env.PWCLI_JS;
assert.ok(cli, 'Set PWCLI_JS to the Playwright CLI script');
mkdirSync('output/playwright', { recursive: true });
function run(code) {
  writeFileSync('output/playwright/review-step.js', code);
  const output = execFileSync(process.execPath, [cli, '-s=legacy-original', 'run-code', '--filename=output/playwright/review-step.js'], { encoding: 'utf8', timeout: 180000 });
  if (output.includes('### Error')) throw new Error(output);
  const match = /### Result\s*([\s\S]*?)(?:\n###|$)/.exec(output);
  return match ? JSON.parse(match[1]) : null;
}
const { dashboards } = await (await fetch(base + '/api/original/dashboards')).json();
const report = process.env.RESUME ? JSON.parse(readFileSync('output/playwright/original-review.json', 'utf8')) : { dashboards: [], panels: [], numbers: [], errors: [], slowest: [] };
for (const dashboard of dashboards) {
  if (process.env.EXTRA_PF && dashboard.server !== 'pf') continue;
  if (!process.env.EXTRA_PF && report.dashboards.includes(dashboard.key)) continue;
  run(`async page => {
    await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('legacy-original-row:')).forEach(k => localStorage.removeItem(k)));
    await page.goto(${JSON.stringify(base + '/?review=' + Date.now() + dashboard.key + '#/original?dash=' + dashboard.key)});
    await page.locator('.original-dashboard h1').waitFor();
    await page.waitForFunction(() => !document.querySelector('.original-variable-bar .loading-state'));
    return { title: await page.locator('.original-dashboard h1').innerText() };
  }`);
  const rows = process.env.EXTRA_PF ? dashboard.rows.filter(r => ['Ads Running (Usual)', 'Ads Stopped (JB)', 'K Request'].includes(r.title)) : dashboard.key.startsWith('stats2.spotify') || dashboard.key === 'stats2.tax-v2' ? dashboard.rows : dashboard.server === 'pf' ? dashboard.rows.slice(0, 3) : dashboard.rows.filter(r => r.panels.length);
  for (const row of rows) {
    const result = run(`async page => {
      const errors = [];
      const onError = e => errors.push(e.message);
      const onConsole = m => { if (m.type() === 'error') errors.push(m.text()); };
      page.on('pageerror', onError); page.on('console', onConsole);
      const section = page.locator('.original-dashboard details.collapsible').filter({ has: page.locator('summary', { hasText: ${JSON.stringify(row.title + ' —')} }) }).first();
      if (!(await section.getAttribute('open')) && await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
      const timings = [];
      for (const definition of ${JSON.stringify(row.panels)}) {
        const card = section.locator('[data-panel-id="' + definition.id + '"]' + (definition.instance ? '[data-instance="' + definition.instance + '"]' : '')).first();
        const start = Date.now();
        await card.scrollIntoViewIfNeeded();
        if (definition.status === 'implemented') await card.locator('[data-panel-ready]').waitFor({ timeout: 120000 });
        const text = await card.innerText();
        if (/\\bNaN\\b|\\bundefined\\b|Internal query error|Couldn.t load/.test(text)) throw new Error(definition.id + ': ' + text.slice(0,1000));
        if (await card.locator('[role="alert"]').count()) throw new Error('Panel alert: ' + definition.id);
        const url = await page.evaluate(({ id, instance }) => performance.getEntriesByType('resource').map(e => e.name).filter(name => {
          const u = new URL(name); return u.pathname === '/api/original/panel' && u.searchParams.get('id') === id && (!instance || u.searchParams.get('instance') === instance);
        }).at(-1), { id: definition.id, instance: definition.instance });
        timings.push({ id: definition.id, instance: definition.instance, title: definition.title, status: definition.status, url, load_ms: Date.now()-start, query_ms: Number(await card.locator('[data-panel-ms]').getAttribute('data-panel-ms').catch(() => 0)) });
      }
      page.off('pageerror', onError); page.off('console', onConsole);
      await section.locator(':scope > summary').click();
      await section.locator(':scope > summary').click();
      for (const timing of timings) {
        const card = section.locator('[data-panel-id="' + timing.id + '"]' + (timing.instance ? '[data-instance="' + timing.instance + '"]' : '')).first();
        const start = Date.now(); await card.scrollIntoViewIfNeeded();
        if (timing.status === 'implemented') await card.locator('[data-panel-ready]').waitFor({ timeout: 120000 });
        timing.warm_load_ms = Date.now()-start;
      }
      await section.locator(':scope > summary').click();
      return { timings, errors };
    }`);
    for (const timing of result.timings) {
      if (timing.url) { const start = performance.now(); const get = () => fetch(timing.url, { headers: { Connection: 'close' } }); const r = await get().catch(get); assert.equal(r.status, 200); await r.arrayBuffer(); timing.warm_ms = Math.round(performance.now()-start); }
    }
    report.panels.push(...result.timings); report.errors.push(...result.errors);
    writeFileSync('output/playwright/original-review.json', JSON.stringify(report, null, 2));
    console.log(dashboard.key, row.title, result.timings.length, 'panels', result.errors.length, 'errors');
  }
  if (!report.dashboards.includes(dashboard.key)) report.dashboards.push(dashboard.key);
  writeFileSync('output/playwright/original-review.json', JSON.stringify(report, null, 2));
}
report.slowest = [...report.panels].sort((a, b) => (b.warm_load_ms ?? 0) - (a.warm_load_ms ?? 0)).slice(0, 5);
writeFileSync('output/playwright/original-review.json', JSON.stringify(report, null, 2));
assert.equal(report.errors.length, 0, report.errors.join('\n'));
console.log(JSON.stringify({ dashboards: report.dashboards.length, panels: report.panels.length, slowest: report.slowest }, null, 2));
