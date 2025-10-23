/* HC Demographics Dashboard — ACS 5-Year
   Loads after Chart.js (script tag without defer in index.html) */

(function whenChartReady(cb){
  if (window.Chart) return cb();
  const iv = setInterval(()=>{ if(window.Chart){ clearInterval(iv); cb(); } }, 50);
  setTimeout(()=>clearInterval(iv), 8000);
})(main);

function main(){
  const scope = document.querySelector('#hc-demog[data-scope="acs"]');
  const $ = (sel) => scope.querySelector(sel);

  // Controls
  const yearEl = $('#year');
  const geoEl = $('#geoLevel');
  const stateCtl = $('#stateCtl');
  const stateSel = $('#stateSel');
  const metricEl = $('#metric');
  const topNEl = $('#topN');
  const topNVal = $('#topNVal');
  const apiKeyEl = $('#apikey');
  const refreshBtn = $('#refresh');
  const exportCSVBtn = $('#exportCSV');
  const statusPill = $('#statusPill');
  const statusMsg = $('#statusMsg');
  const countyCol = $('#countyCol');

  // KPIs
  const kpiAreas = $('#kpiAreas');
  const kpiPop = $('#kpiPop');
  const kpiInc = $('#kpiInc');
  const kpiAge = $('#kpiAge');

  // Charts
  let barChart, histChart;

  const fmtInt = new Intl.NumberFormat();
  const fmtUSD = new Intl.NumberFormat(undefined,{ style:'currency', currency:'USD', maximumFractionDigits:0 });
  const fmt1 = (x) => (x==null || isNaN(x) ? '—' : Number(x).toFixed(1));

  // Years: ACS 5-year typically available up to 2023 (as of 2025)
  const YEARS = Array.from({length:9}, (_,i)=>2015+i); // 2015..2023
  yearEl.innerHTML = YEARS.map(y=>`<option value="${y}" ${y===2023?'selected':''}>${y}</option>`).join('');

  // Save/restore simple state
  const LS = 'hcAcsState.v1';
  function saveState(){
    const s = {
      year:+yearEl.value, geo:geoEl.value, state:stateSel.value, metric:metricEl.value,
      topN:+topNEl.value, key:apiKeyEl.value.trim()
    };
    localStorage.setItem(LS, JSON.stringify(s));
  }
  function restoreState(){
    try{
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if(s.year) yearEl.value = s.year;
      if(s.geo) geoEl.value = s.geo;
      if(s.metric) metricEl.value = s.metric;
      if(s.topN) { topNEl.value = s.topN; topNVal.textContent = s.topN; }
      if(s.key) apiKeyEl.value = s.key;
      return s;
    }catch(e){ return {}; }
  }

  // Fetch helpers
  const ACS_BASE = (year) => `https://api.census.gov/data/${year}/acs/acs5`;

  async function fetchACS(year, metric, geo, stateFips, key){
    // Always fetch population, income, age + NAME to support KPIs regardless of selected metric
    const vars = ['NAME','B01003_001E','B19013_001E','B01002_001E'];
    const params = new URLSearchParams({ get: vars.join(',') });
    if(geo === 'state'){
      params.append('for','state:*');
    } else {
      params.append('for','county:*');
      params.append('in',`state:${stateFips}`);
    }
    if(key) params.append('key', key);
    const url = `${ACS_BASE(year)}?${params.toString()}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`ACS ${res.status}`);
    const json = await res.json(); // first row headers
    const headers = json[0];
    const rows = json.slice(1).map(r => Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
    // Normalize numeric fields
    return rows.map(o => ({
      name: o.NAME,
      pop: num(o.B01003_001E),
      income: num(o.B19013_001E),
      age: num(o.B01002_001E),
      state: o.state,
      county: o.county ?? null
    }));
  }

  async function fetchStatesList(year, key){
    const params = new URLSearchParams({ get:'NAME', for:'state:*' });
    if(key) params.append('key', key);
    const res = await fetch(`${ACS_BASE(year)}?${params.toString()}`);
    const json = await res.json();
    const headers = json[0]; const rows = json.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
    return rows.map(r => ({ fips:r.state, name:r.NAME }));
  }

  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }

  // UI wiring
  topNEl.addEventListener('input', () => { topNVal.textContent = topNEl.value; });
  [yearEl, metricEl, geoEl, stateSel].forEach(el => el.addEventListener('change', saveState));
  apiKeyEl.addEventListener('change', saveState);

  geoEl.addEventListener('change', () => {
    const countyMode = geoEl.value === 'county';
    stateCtl.style.display = countyMode ? '' : 'none';
    countyCol.style.display = countyMode ? '' : 'none';
  });

  $('#copySnapshot').addEventListener('click', async () => {
    const tsv = Array.from($('#rows').querySelectorAll('tr')).map(tr =>
      Array.from(tr.children).map(td => td.textContent.trim()).join('\t')
    ).join('\n');
    try{ await navigator.clipboard.writeText(tsv); toast('Snapshot copied.'); }catch(e){ toast('Copy failed.'); }
  });

  exportCSVBtn.addEventListener('click', () => {
    const list = CURRENT; if(!list.length) return toast('Nothing to export.');
    const csv = [
      ['Geography','Population','Median_HH_Income','Median_Age','StateFIPS','CountyFIPS'],
      ...list.map(r => [r.name, r.pop, r.income, r.age, r.state, r.county??''])
    ].map(arr => arr.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`acs_${yearEl.value}_${geoEl.value}.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  function toast(msg){
    statusMsg.textContent = msg;
    statusPill.innerHTML = `<i class="fa-solid fa-signal"></i>`;
    setTimeout(()=>{ statusPill.innerHTML = `<i class="fa-solid fa-signal"></i>`; }, 1200);
  }

  function destroyCharts(){ for(const c of [barChart,histChart]){ if(c) c.destroy(); } }

  function renderCharts(list, metricKey, metricLabel){
    destroyCharts();
    const topN = +topNEl.value;
    const sorted = [...list].filter(r => Number.isFinite(r[metricKey])).sort((a,b)=> (b[metricKey]-a[metricKey])).slice(0, topN);
    const labels = sorted.map(r => r.name);
    const data = sorted.map(r => r[metricKey]);

    $('#barTitle').textContent = `Top ${topN} by ${metricLabel}`;
    const ctxBar = $('#chartBars').getContext('2d');
    barChart = new Chart(ctxBar, {
      type:'bar',
      data:{ labels, datasets:[{ label: metricLabel, data }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false }, tooltip:{ mode:'index', intersect:false } },
        scales:{ x:{ ticks:{ color:'#cbd5e1' }, grid:{ color:'#1c2342' } }, y:{ ticks:{ color:'#cbd5e1' }, grid:{ color:'#1c2342' } } }
      }
    });

    // Histogram-like distribution (10 bins)
    $('#distTitle').textContent = `${metricLabel} — Distribution`;
    const values = list.map(r => r[metricKey]).filter(Number.isFinite);
    if(values.length){
      const min = Math.min(...values), max = Math.max(...values);
      const bins = 10, step = (max - min) / bins || 1;
      const edges = Array.from({length:bins}, (_,i)=>min + i*step);
      const counts = new Array(bins).fill(0);
      values.forEach(v => {
        let idx = Math.floor((v - min) / step);
        if(idx >= bins) idx = bins - 1;
        if(idx < 0) idx = 0;
        counts[idx]++;
      });
      const labelsH = edges.map((e,i)=> {
        const lo = edges[i];
        const hi = i===bins-1 ? max : (edges[i+1]);
        return metricKey==='income' ? `${fmtUSD.format(lo)}–${fmtUSD.format(hi)}` :
               metricKey==='pop' ? `${fmtInt.format(lo)}–${fmtInt.format(hi)}` :
               `${lo.toFixed(1)}–${hi.toFixed(1)}`;
      });
      const ctxH = $('#chartHist').getContext('2d');
      histChart = new Chart(ctxH, {
        type:'bar',
        data:{ labels: labelsH, datasets:[{ label:'Count of areas', data:counts }] },
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ display:false } },
          scales:{ x:{ ticks:{ color:'#cbd5e1', autoSkip:false, maxRotation:45, minRotation:0 }, grid:{ color:'#1c2342' } },
                   y:{ ticks:{ color:'#cbd5e1' }, grid:{ color:'#1c2342' } } }
        }
      });
    }
  }

  function renderTable(list){
    const rows = list.map(r => `
      <tr>
        <td>${r.name}</td>
        <td>${Number.isFinite(r.pop)? fmtInt.format(r.pop): '—'}</td>
        <td>${Number.isFinite(r.income)? fmtUSD.format(r.income): '—'}</td>
        <td>${Number.isFinite(r.age)? fmt1(r.age): '—'}</td>
        <td>${r.state||''}</td>
        <td style="${geoEl.value==='county'?'':'display:none'}">${r.county??''}</td>
      </tr>
    `).join('');
    $('#rows').innerHTML = rows || `<tr><td colspan="6" style="text-align:center; color:var(--ink-3)">No data.</td></tr>`;
  }

  function renderKpis(list){
    kpiAreas.textContent = fmtInt.format(list.length);
    $('#kpiAreasNote').textContent = geoEl.value==='state' ? 'States + DC/territories' : 'Counties in selected state';
    const popSum = list.map(r=>r.pop).filter(Number.isFinite).reduce((a,b)=>a+b,0);
    kpiPop.textContent = fmtInt.format(popSum);
    $('#kpiPopNote').textContent = 'Sum of total population';
    const incomes = list.map(r=>r.income).filter(Number.isFinite);
    const ages = list.map(r=>r.age).filter(Number.isFinite);
    const avg = (arr)=> arr.length? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
    const incAvg = avg(incomes), ageAvg = avg(ages);
    kpiInc.textContent = incAvg? fmtUSD.format(incAvg) : '—';
    $('#kpiIncNote').textContent = 'Simple average of medians';
    kpiAge.textContent = ageAvg? fmt1(ageAvg) : '—';
    $('#kpiAgeNote').textContent = 'Simple average of medians';
  }

  function wireSavePng(){
    const buttons = scope.querySelectorAll('[data-save]');
    buttons.forEach(btn => {
      btn.onclick = () => {
        const target = btn.getAttribute('data-save');
        const chart = target==='bar'? barChart : target==='hist'? histChart : null;
        if(!chart) return;
        const url = chart.toBase64Image();
        const a = document.createElement('a'); a.href=url; a.download=`demographics-${target}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      };
    });
  }

  async function populateStates(year, key){
    stateSel.innerHTML = `<option value="">Loading…</option>`;
    try{
      const list = await fetchStatesList(year, key);
      stateSel.innerHTML = list.map(s => `<option value="${s.fips}">${s.name}</option>`).join('');
      const restored = restoreState();
      if(restored?.state){ stateSel.value = restored.state; }
      else {
        const tn = list.find(s => s.fips === '47'); // TN default for you
        if(tn) stateSel.value = '47';
      }
    }catch(e){
      stateSel.innerHTML = `<option value="">(failed to load)</option>`;
    }
  }

  let CURRENT = [];
  async function load(){
    refreshBtn.dataset.state = 'busy';
    statusPill.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
    statusMsg.textContent = 'Fetching ACS…';
    try{
      const year = +yearEl.value;
      const metricVar = metricEl.value;
      const metricLabel = metricEl.options[metricEl.selectedIndex].dataset.label;
      const geo = geoEl.value;
      const key = apiKeyEl.value.trim();

      if(geo === 'county' && !stateSel.value){
        await populateStates(year, key);
      }

      const data = await fetchACS(year, metricVar, geo, stateSel.value || '47', key);
      CURRENT = data;

      renderKpis(CURRENT);
      const chartKey = metricVar === 'B01003_001E' ? 'pop' : metricVar === 'B19013_001E' ? 'income' : 'age';
      renderCharts(CURRENT, chartKey, metricLabel);
      renderTable(CURRENT);

      $('#tableTitle').textContent = (geo==='state' ? 'States' : `Counties in ${stateSel.options[stateSel.selectedIndex]?.text || ''}`) + ` — ${year}`;
      statusMsg.textContent = `Loaded ${CURRENT.length} ${geo==='state'?'states/areas':'counties'}.`;
      wireSavePng();
      saveState();
    } catch(e){
      statusMsg.textContent = `Error: ${e.message}`;
      statusPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--warn)"></i>`;
    } finally {
      refreshBtn.dataset.state = '';
    }
  }

  // Initial UI setup
  const restored = restoreState();
  topNVal.textContent = topNEl.value;
  const countyMode = geoEl.value === 'county';
  stateCtl.style.display = countyMode ? '' : 'none';
  countyCol.style.display = countyMode ? '' : 'none';

  // Preload states list (for convenience)
  populateStates(+yearEl.value, apiKeyEl.value.trim());

  // Events
  refreshBtn.addEventListener('click', load);
  [metricEl, topNEl, geoEl, yearEl, stateSel].forEach(el => el.addEventListener('change', () => {
    if(CURRENT.length){
      const metricVar = metricEl.value;
      const metricLabel = metricEl.options[metricEl.selectedIndex].dataset.label;
      const chartKey = metricVar === 'B01003_001E' ? 'pop' : metricVar === 'B19013_001E' ? 'income' : 'age';
      renderKpis(CURRENT);
      renderCharts(CURRENT, chartKey, metricLabel);
      renderTable(CURRENT);
    }
  }));

  // Auto-load once for demo
  window.addEventListener('load', load);
  window.addEventListener('resize', () => { if(barChart){ barChart.resize(); histChart.resize(); } });
}
