import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const cli = process.env.PWCLI_JS, base = 'http://127.0.0.1:8772';
assert.ok(cli);
function run(code) {
  writeFileSync('output/playwright/followup-step.js', code);
  const out = execFileSync(process.execPath, [cli, '-s=legacy-original', 'run-code', '--filename=output/playwright/followup-step.js'], { encoding: 'utf8', timeout: 180000 });
  if (out.includes('### Error')) throw new Error(out);
  return JSON.parse(/### Result\s*([\s\S]*?)(?:\n###|$)/.exec(out)[1]);
}
const { dashboards } = await (await fetch(base + '/api/original/dashboards')).json();
const report = process.env.RESUME ? JSON.parse(readFileSync('output/playwright/original-followups.json','utf8')) : { numbers: [], cascade: null, curated: [], raw: [], actions: null, errors: [] };
const save = () => writeFileSync('output/playwright/original-followups.json', JSON.stringify(report, null, 2));
report.numbers = report.numbers.filter(p=>p.expected.length);
for (const id of ['stats2.spotify-dash.90', 'stats2.spotify-dash.91', 'stats2.spotify-dash.33', 'stats2.tax-v2.22', 'stats2.tax-v2.33']) {
  if(report.numbers.some(p=>p.id===id)) continue;
  const d = dashboards.find(d => d.rows.some(r => r.panels.some(p => p.id === id)));
  const p = d.rows.flatMap(r => r.panels).find(p => p.id === id);
  const result = run(`async page => {
    await page.goto(${JSON.stringify(base + '/?numbers=' + id + '#/original?dash=' + d.key + '&row=' + encodeURIComponent(p.row))});
    const card = page.locator('[data-panel-id="${id}"]').first();
    await card.waitFor(); await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor({ timeout: 120000 });
    const url = await page.evaluate(id => performance.getEntriesByType('resource').map(e => e.name).filter(n => { const u = new URL(n); return u.pathname === '/api/original/panel' && u.searchParams.get('id') === id; }).at(-1), ${JSON.stringify(id)});
    const response = await page.request.get(url); const frames = (await response.json()).frames;
    const expected = frames.flatMap(f => ${p.type === 'table' ? `f.rows.slice(0,50).flatMap(r => r.filter(v => typeof v === 'number'))` : `f.columns.flatMap((c,i) => c.type === 'number' ? [f.rows.map(r => r[i]).filter(v => v != null).at(-1)] : [])`});
    const displayed = await card.locator(${JSON.stringify(p.type === 'table' ? 'td.numeric [data-original-value]' : '.original-stats strong[data-original-value]')}).allTextContents();
    const actual = displayed.map(v => Number(v.replace(/[$,%\\s]/g, '')));
    if (!expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('DOM/API mismatch '+JSON.stringify({expected,actual,displayed}));
    return { id: ${JSON.stringify(id)}, expected, displayed, passed: true };
  }`);
  report.numbers.push(result); save(); console.log('DOM values', id, 'passed');
}
if(!report.cascade) report.cascade = run(`async page => {
  await page.goto('${base}/?cascade=1#/original?dash=stats2.spotify-dash&row=Track%20Specific');
  const initialCard = page.locator('[data-panel-id="stats2.spotify-dash.33"]');
  await initialCard.waitFor(); await initialCard.scrollIntoViewIfNeeded(); await initialCard.locator('[data-panel-ready]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.original-variable-bar .loading-state'));
  const initial = await page.getByRole('combobox', { name: 'Track Name', exact: true }).inputValue();
  const artist = page.getByRole('combobox', { name: 'Artist Name', exact: true });
  await artist.fill('Joongle'); await page.getByRole('option', {name:'Joongle',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('.original-variable-bar .loading-state'));
  const card = page.locator('[data-panel-id="stats2.spotify-dash.33"]');
  await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor();
  const selected = await page.getByRole('combobox', { name: 'Track Name', exact: true }).inputValue();
  const opts = await (await page.request.get('${base}/api/original/variable-options?dashboard=stats2.spotify-dash&name=track_name&vars='+encodeURIComponent(JSON.stringify({artist_name:'Joongle'})))).json();
  const oldOpts = await (await page.request.get('${base}/api/original/variable-options?dashboard=stats2.spotify-dash&name=track_name&vars='+encodeURIComponent(JSON.stringify({artist_name:${JSON.stringify(process.env.LEGACY_SAMPLE_ARTIST)}})))).json();
  if (!opts.options.length || JSON.stringify(opts.options)===JSON.stringify(oldOpts.options)) throw new Error('Artist did not cascade');
  const next = opts.options.find(o=>o.value!==selected); if (!next) throw new Error('Need another track');
  await page.getByRole('combobox', { name: 'Track Name', exact: true }).fill(next.text);
  await page.getByRole('option', { name: next.text, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.original-variable-bar .loading-state'));
  await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor();
  const vars = await page.evaluate(() => performance.getEntriesByType('resource').map(e=>new URL(e.name)).filter(u=>u.pathname==='/api/original/panel' && u.searchParams.get('id')==='stats2.spotify-dash.33').map(u=>JSON.parse(u.searchParams.get('vars'))));
  if (!vars.some(v=>v.artist_name==='Joongle' && v.track_name===next.value)) throw new Error('Track panels did not reload');
  return { initial, artist:'Joongle', firstTrack:selected, changedTrack:next.value, reloads:vars.length, passed:true };
}`); save(); console.log('Artist/track cascade passed');
for (const view of ['person', 'playlist']) {
  if(report.curated.some(v=>v.view===view)) continue;
  const result = run(`async page => {
    const errors=[]; const listener=e=>errors.push(e.message); page.on('pageerror',listener);
    await page.goto('${base}/?tax-review=${view}#/tax?dataset=stats2&view=${view}');
    await page.locator('.tax-grid .original-panel').first().waitFor();
    const cards=page.locator('.tax-grid .original-panel'), count=await cards.count();
    for(let i=0;i<count;i++) { const card=cards.nth(i); await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor({timeout:120000}); if(await card.locator('[role="alert"]').count()) throw new Error(await card.innerText()); }
    if(!await page.getByText('Est. Revenue = streams × 0.002', {exact:false}).count()) throw new Error('Missing accounting note');
    page.off('pageerror',listener); if(errors.length) throw new Error(errors.join('; '));
    await page.screenshot({path:'output/playwright/tax-${view}.png',fullPage:true});
    return { view:${JSON.stringify(view)}, panels:count, errors };
  }`);
  report.curated.push(result); save(); console.log('Curated Tax', view, result.panels, 'passed');
}
for (const followers of [false,true]) {
  if(report.raw.some(v=>v.followers===followers)) continue;
  report.raw.push(run(`async page => {
    await page.goto('${base}/?raw-review=${followers}#/${followers ? 'followers?dataset=followers' : 'archive?dataset=stats2'}&tab=raw');
    const raw=page.locator('.raw-browser'); await raw.waitFor();
    await page.waitForFunction(()=>document.querySelector('.raw-browser table')?.getAttribute('aria-busy')==='false');
    const text=await raw.innerText(); if(await raw.locator('[role="alert"]').count() || !text.includes('rows · Page')) throw new Error(text);
    const count=await raw.locator('tbody tr').count(); if(count!==100) throw new Error('Expected 100 readings');
    await raw.getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForFunction(()=>location.hash.includes('raw-offset=100') && document.querySelector('.raw-browser table')?.getAttribute('aria-busy')==='false');
    const request=page.waitForEvent('download'); await raw.getByRole('button',{name:'Export raw CSV'}).click(); const download=await request;
    if(await download.failure()) throw new Error(await download.failure());
    return { followers:${followers}, rows:count, pagination:true, csv:download.suggestedFilename(), passed:true };
  }`)); save(); console.log('Raw browser', followers, 'passed');
}
if(!report.actions) report.actions = run(`async page => {
  await page.goto('${base}/?actions-review=${Date.now()}#/original?dash=stats2.spotify-dash&row=Track%20Specific');
  const card=page.locator('[data-panel-id="stats2.spotify-dash.33"]'); await card.waitFor(); await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor();
  await card.locator('.original-actions > summary').click(); await card.getByRole('button',{name:'Show query'}).click();
  const drawer=page.getByRole('dialog'); await drawer.getByRole('heading',{name:'Original SQL',exact:true}).first().waitFor();
  if(!(await drawer.innerText()).includes('validation cases passed against PostgreSQL')) throw new Error('Missing proof counts');
  await drawer.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']); await card.getByRole('button',{name:'Copy PNG'}).click();
  await card.getByText('PNG copied',{exact:true}).waitFor({timeout:60000});
  const downloadEvent=page.waitForEvent('download'); await card.getByRole('button',{name:'Download CSV'}).click(); const csv=await downloadEvent; if(await csv.failure()) throw new Error(await csv.failure());
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/original-mobile.png',fullPage:true});
  const columns=await page.locator('.original-positioned-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns);
  await page.setViewportSize({width:1920,height:1080});
  return { queryDrawer:true, png:true, csv:csv.suggestedFilename(), mobileColumns:columns };
}`); save();
if(!report.textSafety) report.textSafety = run(`async page => {
  const remote=[]; const onRequest=r=>{ if(new URL(r.url()).hostname!=='127.0.0.1') remote.push(r.url()); };
  page.on('request',onRequest);
  await page.route('**/api/original/dashboards', async route=>{
    const response=await route.fetch(), data=await response.json();
    const panel=data.dashboards.find(d=>d.key==='stats2.spotify-dash').rows.flatMap(r=>r.panels).find(p=>p.id==='stats2.spotify-dash.39');
    panel.options={mode:'html',content:'<p onclick="window.__unsafe=1"><strong>Safe formatting</strong><script>window.__unsafe=1</script><img src="https://example.invalid/pixel"><iframe src="https://example.invalid/frame"></iframe><a href="https://example.invalid/link">Link text</a><style>body{background:url(https://example.invalid/style)}</style></p>'};
    await route.fulfill({response,json:data});
  });
  await page.goto('${base}/?safe-text=${Date.now()}#/original?dash=stats2.spotify-dash&row=User%20Guide');
  const card=page.locator('[data-panel-id="stats2.spotify-dash.39"]'); await card.waitFor(); await card.scrollIntoViewIfNeeded();
  const text=card.locator('.original-text'); await text.waitFor();
  if(!await text.getByText('Safe formatting',{exact:true}).count()) throw new Error('Formatting lost');
  const unsafe=await text.evaluate(e=>Boolean(window.__unsafe) || Boolean(e.querySelector('script,img,iframe,a,style,svg')) || [...e.querySelectorAll('*')].some(n=>n.attributes.length));
  page.off('request',onRequest); await page.unroute('**/api/original/dashboards');
  if(unsafe || remote.length) throw new Error('Unsafe text rendering '+JSON.stringify(remote));
  return { formatting:true, scripts:false, remoteRequests:remote.length, passed:true };
}`); save();
if(!report.timeRange) report.timeRange = run(`async page => {
  await page.goto('${base}/?range-review=${Date.now()}#/original?dash=stats2.spotify-dash&row=Track%20Specific');
  const card=page.locator('[data-panel-id="stats2.spotify-dash.31"]'); await card.waitFor(); await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor();
  await page.getByRole('textbox',{name:'Original from',exact:true}).fill('2025-12-01T12:00:00Z');
  await page.getByRole('textbox',{name:'Original to',exact:true}).fill('2025-12-15T18:00:00Z');
  const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/original/panel' && u.searchParams.get('id')==='stats2.spotify-dash.31' && u.searchParams.get('from')==='2025-12-01T12:00:00Z';});
  await page.getByRole('button',{name:'Apply range',exact:true}).click(); await card.scrollIntoViewIfNeeded(); const data=await (await response).json();
  await card.locator('[data-panel-ready]').waitFor();
  if(data.time_range.from!=='2025-12-01T12:00:00+00:00' || data.time_range.to!=='2025-12-15T18:00:00+00:00') throw new Error('Range did not propagate');
  const ticks=await card.locator('.recharts-xAxis-tick-labels text').allTextContents();
  if(ticks.length<2 || ticks[0]!=='2025-12-01' || ticks.at(-1)!=='2025-12-15' || ticks.some(t=>t<'2025-12-01' || t>'2025-12-15')) throw new Error('Axis extended outside selected range: '+JSON.stringify(ticks));
  await page.getByRole('button',{name:'Switch to dark theme'}).click(); await page.screenshot({path:'output/playwright/original-dark.png',fullPage:false});
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  return { from:data.time_range.from,to:data.time_range.to,ticks,passed:true };
}`); save();
if(!report.relativeDates) report.relativeDates = run(`async page => {
  await page.goto('${base}/?relative-review=${Date.now()}#/original?dash=stats2.tax-v2&row=Person%20View');
  const card=page.locator('[data-panel-id="stats2.tax-v2.20"]'); await card.waitFor(); await card.scrollIntoViewIfNeeded(); await card.locator('[data-panel-ready]').waitFor();
  const dates=card.locator('tbody tr td:last-child span'); const before=await dates.allTextContents();
  if(!before.length) throw new Error('Need date rows');
  await page.getByRole('textbox',{name:'Original to',exact:true}).fill('2025-12-15T18:00:00Z');
  const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/original/panel' && u.searchParams.get('id')==='stats2.tax-v2.20' && u.searchParams.get('to')==='2025-12-15T18:00:00Z';});
  await page.getByRole('button',{name:'Apply range',exact:true}).click(); await card.scrollIntoViewIfNeeded(); await response; await card.locator('[data-panel-ready]').waitFor();
  const after=await dates.allTextContents(); if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Relative dates moved with range instead of archive anchor');
  return { panel:'stats2.tax-v2.20', displayedDates:after.slice(0,5), archiveAnchored:true, passed:true };
}`); save();
const all = JSON.parse(readFileSync('output/playwright/original-review.json','utf8')); all.numbers = report.numbers; writeFileSync('output/playwright/original-review.json',JSON.stringify(all,null,2));
console.log('Additional browser checks passed');
