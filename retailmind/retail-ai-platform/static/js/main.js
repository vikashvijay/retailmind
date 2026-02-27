/* ═══════════════════════════════════════════════════════
   RetailMind — Frontend JS
   All interactions, chart rendering, API calls
═══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────
const S = {
  loaded:    false,
  tab:       'dashboard',
  charts:    {},
  decisions: [],
  decFilter: { text:'', urgency:'all' },
  chatLog:   [],
};

const SUGGESTIONS = [
  "📦 How many units of each product do I have?",
  "🏆 What are my best-selling products?",
  "⚠️ Which items urgently need restocking?",
  "💰 Are my prices competitive vs the market?",
  "📉 What's selling the slowest?",
  "📊 Give me a full store summary",
];

// ── Boot ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);
  initSuggestions();
  setupDrop();
});

function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function initSuggestions() {
  const g = document.getElementById('sugGrid');
  if (!g) return;
  g.innerHTML = SUGGESTIONS.map(s =>
    `<button class="sug-btn" onclick="useSuggestion(this)">${s}</button>`
  ).join('');
}

function setupDrop() {
  const dz = document.getElementById('dropZone');
  if (!dz) return;
  dz.addEventListener('dragover', e => e.preventDefault());
}

// ── Tab Switching ──────────────────────────────────────
function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.style.display='none');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const tabEl = document.getElementById('tab-'+tab);
  if (tabEl) tabEl.style.display = 'block';
  if (el) el.classList.add('active');

  const titles = {
    dashboard: ['Store Overview',         'Your real-time retail intelligence dashboard'],
    decisions: ['Smart Action Plan',       'AI-generated recommendations for your products'],
    insights:  ['Business Intelligence',   'Deep analysis of your store health and opportunities'],
    copilot:   ['Ask Anything',            'Your personal AI business advisor'],
  };
  const [title, sub] = titles[tab] || ['RetailMind',''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSub').textContent   = sub;
  S.tab = tab;

  if (!S.loaded) return;
  if (tab==='decisions' && S.decisions.length===0) loadDecisions();
  if (tab==='insights') loadInsights();
}

// ── Upload ─────────────────────────────────────────────
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone')?.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file?.name.endsWith('.csv')) uploadFile(file);
  else toast('Please drop a CSV file','error');
}

function handleUpload(inp) {
  if (inp.files?.[0]) uploadFile(inp.files[0]);
}

function uploadFile(file) {
  showLoader('Analysing your store data...', 'Training AI on your products');
  const fd = new FormData();
  fd.append('file', file);

  fetch('/api/upload', {method:'POST', body:fd})
    .then(r => r.json())
    .then(d => {
      hideLoader();
      if (d.error) { toast(d.error,'error'); return; }
      onLoaded(d.summary, file.name);
    })
    .catch(() => { hideLoader(); toast('Upload failed','error'); });
}

function onLoaded(summary, fname) {
  S.loaded = true;

  // hide welcome, show dashboard
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('liveBadge').style.display     = 'flex';
  document.getElementById('aiStatus').style.display      = 'flex';
  document.getElementById('aiStatusText').textContent    = `${summary.rows} rows · AI ready`;

  // update sidebar upload card
  document.getElementById('uploadTitle').textContent = fname.substring(0,20) + (fname.length>20?'…':'');
  document.getElementById('uploadHint').textContent  = `${summary.rows} rows · ${summary.products} products`;
  document.getElementById('uploadIcon').innerHTML    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  document.getElementById('uploadIcon').style.color  = '#10b981';

  switchTab('dashboard', document.querySelector('[data-tab="dashboard"]'));
  loadDashboard();
  toast('Data loaded! AI is ready 🚀','success');
}

// ── Dashboard ──────────────────────────────────────────
function loadDashboard() {
  fetch('/api/dashboard')
    .then(r => r.json())
    .then(d => {
      renderKPIs(d.kpis);
      renderDemandChart(d.demand_stock);
      renderCatChart(d.category_sales);
      renderTrendChart(d.daily_trend);
      renderPriceChart(d.price_comparison);
    });
}

function renderKPIs(k) {
  const items = [
    { label:'Total Records', val: k.total_rows?.toLocaleString(), icon:'🗂️', cls:'' },
    { label:'Products',      val: k.products,                     icon:'📦', cls:'purple' },
    { label:'Categories',    val: k.categories,                   icon:'🏷️', cls:'' },
    { label:'Avg Stock',     val: k.avg_stock,                    icon:'🏪', cls:'' },
    { label:'Avg Demand',    val: k.avg_demand,                   icon:'📈', cls:'green' },
    { label:'Critical Alerts', val: k.critical,                   icon:'🚨', cls: k.critical>0?'red':'' },
    { label:'Revenue Potential', val: '₹'+fmtNum(k.revenue_est), icon:'💰', cls:'purple' },
  ];
  document.getElementById('kpiGrid').innerHTML = items.map((it,i)=>`
    <div class="kpi-card" style="animation-delay:${i*0.05}s">
      <span class="kpi-icon">${it.icon}</span>
      <div class="kpi-label">${it.label}</div>
      <div class="kpi-val ${it.cls}">${it.val}</div>
    </div>
  `).join('');
}

// ── Charts ─────────────────────────────────────────────
const C = {
  bg: 'rgba(5,6,15,0)',
  grid: 'rgba(255,255,255,0.05)',
  text: '#94a3b8',
  font: 'Inter',
  p1: '#6366f1', p2: '#a855f7', p3: '#10b981', p4: '#f97316', p5: '#3b82f6',
};

const baseOpts = (extra={}) => ({
  responsive:true, maintainAspectRatio:false,
  plugins: {
    legend: { labels:{ color:C.text, font:{family:C.font,size:10}, boxWidth:10, padding:12 } },
    tooltip: { backgroundColor:'#0e1117', borderColor:'rgba(99,102,241,0.3)',
               borderWidth:1, titleColor:'#a5b4fc', bodyColor:C.text,
               titleFont:{family:'Syne',size:12,weight:'bold'}, bodyFont:{family:C.font,size:12} },
  },
  scales: {
    x: { ticks:{color:C.text,font:{family:C.font,size:9},maxRotation:35,maxTicksLimit:12},
         grid:{color:C.grid} },
    y: { ticks:{color:C.text,font:{family:C.font,size:9}}, grid:{color:C.grid} },
  },
  ...extra,
});

function destroy(id) {
  if (S.charts[id]) { S.charts[id].destroy(); delete S.charts[id]; }
}

function renderDemandChart(data) {
  destroy('demand');
  const ctx = document.getElementById('cDemand')?.getContext('2d');
  if (!ctx||!data?.length) return;
  S.charts['demand'] = new Chart(ctx, {
    type:'bar',
    data:{
      labels: data.map(d=>d.Product?.substring(0,14)),
      datasets:[
        { label:'Units Sold', data:data.map(d=>d.sold),
          backgroundColor:'rgba(99,102,241,0.7)', borderRadius:3, borderSkipped:false },
        { label:'Current Stock', data:data.map(d=>d.stock),
          backgroundColor:'rgba(168,85,247,0.6)', borderRadius:3, borderSkipped:false },
        { label:'AI Predicted Demand', data:data.map(d=>d.demand),
          backgroundColor:'rgba(16,185,129,0.5)', borderRadius:3, borderSkipped:false },
      ],
    },
    options: baseOpts(),
  });
}

function renderCatChart(data) {
  destroy('cat');
  const ctx = document.getElementById('cCat')?.getContext('2d');
  if (!ctx||!data?.length) return;
  const colors = ['#6366f1','#a855f7','#ec4899','#10b981','#f97316','#3b82f6','#eab308','#14b8a6'];
  S.charts['cat'] = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels: data.map(d=>d.category),
      datasets:[{ data:data.map(d=>d.sales),
        backgroundColor: colors.slice(0,data.length),
        borderColor:'#05060f', borderWidth:3 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins:{
        legend:{ position:'right', labels:{ color:C.text, font:{family:C.font,size:10}, boxWidth:10, padding:8 } },
        tooltip:{ backgroundColor:'#0e1117', borderColor:'rgba(99,102,241,0.3)', borderWidth:1,
                  titleColor:'#a5b4fc', bodyColor:C.text },
      },
    },
  });
}

function renderTrendChart(data) {
  destroy('trend');
  const ctx = document.getElementById('cTrend')?.getContext('2d');
  if (!ctx) return;
  if (!data?.length) {
    ctx.fillStyle=C.text; ctx.font='13px Inter'; ctx.textAlign='center';
    ctx.fillText('No date column in your dataset', ctx.canvas.width/2, ctx.canvas.height/2);
    return;
  }
  const grad = ctx.createLinearGradient(0,0,0,220);
  grad.addColorStop(0,'rgba(99,102,241,0.3)'); grad.addColorStop(1,'rgba(99,102,241,0)');
  S.charts['trend'] = new Chart(ctx, {
    type:'line',
    data:{
      labels: data.map(d=>d.date),
      datasets:[{ label:'Daily Sales', data:data.map(d=>d.sales),
        borderColor:C.p1, backgroundColor:grad, borderWidth:2,
        fill:true, tension:0.4, pointRadius:0, pointHoverRadius:5 }],
    },
    options: baseOpts(),
  });
}

function renderPriceChart(data) {
  destroy('price');
  const ctx = document.getElementById('cPrice')?.getContext('2d');
  if (!ctx||!data?.length) return;
  S.charts['price'] = new Chart(ctx, {
    type:'line',
    data:{
      labels: data.map(d=>d.Product?.substring(0,12)),
      datasets:[
        { label:'Your Price', data:data.map(d=>d.price), borderColor:C.p1, borderWidth:2, tension:0.3, pointRadius:3 },
        { label:'Competitor', data:data.map(d=>d.comp),  borderColor:'#ef4444', borderWidth:2, tension:0.3,
          pointRadius:3, borderDash:[5,5] },
      ],
    },
    options: baseOpts(),
  });
}

// ── Data Table ─────────────────────────────────────────
let dataLoaded = false;
function toggleData() {
  const wrap = document.getElementById('dataTableWrap');
  const btn  = document.getElementById('dataToggleBtn');
  const show = wrap.style.display==='none';
  wrap.style.display = show?'block':'none';
  btn.textContent    = show?'Hide ↑':'Show table ↓';
  if (show && !dataLoaded) {
    fetch('/api/raw_data').then(r=>r.json()).then(d=>{
      dataLoaded=true; buildTable(document.getElementById('dataTable'),d);
    });
  }
}
function buildTable(el, rows) {
  if (!rows?.length){ el.innerHTML='<div class="empty-state">No data</div>'; return; }
  const cols=Object.keys(rows[0]);
  el.innerHTML=`<table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
  <tbody>${rows.slice(0,150).map(r=>`<tr>${cols.map(c=>`<td>${fmt(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// ── Decisions ──────────────────────────────────────────
function loadDecisions() {
  document.getElementById('decisionsGrid').innerHTML =
    '<div class="empty-state">⚡ Generating AI recommendations...</div>';
  fetch('/api/decisions').then(r=>r.json()).then(d=>{
    S.decisions = Array.isArray(d) ? d : [];
    renderDecisions();
  }).catch(()=>{
    document.getElementById('decisionsGrid').innerHTML =
      '<div class="empty-state">Failed to load. Make sure GROQ_API_KEY is set.</div>';
  });
}

let urgencyFilter = 'all';
function setUrgencyFilter(u, btn) {
  urgencyFilter = u;
  document.querySelectorAll('.fpill').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderDecisions();
}
function filterDecisions(q) { renderDecisions(); }

function renderDecisions() {
  const q = (document.getElementById('decSearch')?.value||'').toLowerCase();
  let data = S.decisions.filter(d => {
    const matchText = !q ||
      d.product?.toLowerCase().includes(q) ||
      d.category?.toLowerCase().includes(q) ||
      d.action?.toLowerCase().includes(q);
    const matchUrg  = urgencyFilter==='all' || d.urgency===urgencyFilter;
    return matchText && matchUrg;
  });

  document.getElementById('decCount').textContent = `${data.length} recommendations`;

  if (!data.length) {
    document.getElementById('decisionsGrid').innerHTML =
      '<div class="empty-state">No matching results</div>';
    return;
  }

  document.getElementById('decisionsGrid').innerHTML = data.map((d,i)=>{
    const aCls = actionClass(d.action);
    const tags = (d.tags||[]).map(t=>`<span class="dec-tag">${t}</span>`).join('');
    return `
    <div class="dec-card urg-${d.urgency} fade-in" style="animation-delay:${i*0.04}s">
      <div class="dec-top">
        <div>
          <div class="dec-product">${d.product||'Unknown'}</div>
          <div class="dec-category">${d.category||''}</div>
        </div>
        <div class="dec-badges">
          <span class="badge-action ${aCls}">${d.action||'Review'}</span>
          <span class="badge-urgency urg-badge-${d.urgency}">${d.urgency||'Low'}</span>
        </div>
      </div>
      <div class="dec-headline">${d.headline||''}</div>
      <div class="dec-reason">${d.reasoning||''}</div>
      <div class="dec-stats">
        <div class="dec-stat">
          <div class="dec-stat-label">Stock</div>
          <div class="dec-stat-val">${fmtN(d.metric_stock)}</div>
        </div>
        <div class="dec-stat">
          <div class="dec-stat-label">Demand</div>
          <div class="dec-stat-val">${fmtN(d.metric_demand)}</div>
        </div>
        <div class="dec-stat">
          <div class="dec-stat-label">Price Gap</div>
          <div class="dec-stat-val" style="color:${(d.metric_price_gap||0)>5?'#ef4444':(d.metric_price_gap||0)<-5?'#10b981':'#94a3b8'}">${(d.metric_price_gap||0)>0?'+':''}${fmtN(d.metric_price_gap)}%</div>
        </div>
      </div>
      ${tags?`<div class="dec-tags">${tags}</div>`:''}
      <div class="dec-footer">
        <div class="priority-bar"><div class="priority-fill" style="width:${d.priority_score||0}%"></div></div>
        <div class="priority-num">${d.priority_score||0}</div>
        <div class="dec-impact">${d.expected_impact||''}</div>
      </div>
    </div>`;
  }).join('');
}

function actionClass(action='') {
  const a = action.toLowerCase();
  if (a.includes('restock') || a.includes('order'))   return 'action-restock';
  if (a.includes('clear')  || a.includes('liquidate'))return 'action-clear';
  if (a.includes('promot')) return 'action-promote';
  if (a.includes('bundle')) return 'action-bundle';
  if (a.includes('monitor')||a.includes('maintain'))  return 'action-monitor';
  if (a.includes('price'))  return 'action-price';
  return 'action-default';
}

// ── Insights ───────────────────────────────────────────
function loadInsights() {
  document.getElementById('insightsSummary').textContent = 'Generating your business report...';
  fetch('/api/insights').then(r=>r.json()).then(renderInsights)
    .catch(e=>{
      document.getElementById('insightsSummary').textContent =
        'Failed to load insights. Check GROQ_API_KEY.';
    });
}

function renderInsights(d) {
  const score  = d.health_score||0;
  const label  = d.health_label||'--';
  const color  = score>=75?'#10b981':score>=50?'#eab308':score>=30?'#f97316':'#ef4444';

  document.getElementById('healthScore').textContent = score;
  document.getElementById('healthLabel').textContent = label;
  drawRing(score, color);

  document.getElementById('insightsSummary').textContent = d.executive_summary||'';
  document.getElementById('revenueOpp').textContent = d.revenue_opportunity
    ? '💡 ' + d.revenue_opportunity : '';

  // Risks
  document.getElementById('risksList').innerHTML = (d.risks||[]).map(r=>`
    <div class="risk-item"><span class="risk-sev-badge sev-${r.severity}">${r.severity}</span>
      <span class="risk-title">${r.title}</span>
      <div class="risk-detail">${r.detail}${r.products_affected?' ('+r.products_affected+' products)':''}</div>
    </div>`).join('') || '<div class="empty-state" style="padding:14px">No major risks found ✓</div>';

  // Opportunities
  document.getElementById('oppList').innerHTML = (d.opportunities||[]).map(o=>`
    <div class="opp-item">
      <div class="opp-title"><span class="opp-icon">${o.icon||'✦'}</span>${o.title}</div>
      <div class="opp-detail">${o.detail}</div>
      ${o.potential_value?`<div style="font-size:11px;color:#10b981;margin-top:4px">Potential: ${o.potential_value}</div>`:''}
    </div>`).join('') || '<div class="empty-state" style="padding:14px">Keep monitoring</div>';

  // Categories
  document.getElementById('catInsights').innerHTML = (d.category_insights||[]).map(c=>`
    <div class="cat-item">
      <div><span class="cat-perf perf-${c.performance}">${c.performance}</span></div>
      <div class="cat-name">${c.category}</div>
      <div class="risk-detail">${c.insight}</div>
    </div>`).join('') || '<div class="empty-state" style="padding:14px">No category data</div>';

  // Actions
  document.getElementById('actionsList').innerHTML = (d.actions||[]).sort((a,b)=>a.priority-b.priority).map(a=>`
    <div class="action-row">
      <div class="action-num">${a.priority}</div>
      <div class="action-body">
        <div class="action-title">${a.action}</div>
        <div class="action-detail">${a.detail}</div>
      </div>
      <div class="action-time time-${(a.timeframe||'').replace(' ','-')}">${a.timeframe||''}</div>
    </div>`).join('');
}

function drawRing(score, color) {
  const c = document.getElementById('healthRing');
  if (!c) return;
  const ctx=c.getContext('2d'); const cx=90,cy=90,r=72;
  ctx.clearRect(0,0,180,180);
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=10; ctx.stroke();
  if (score>0) {
    const end = (score/100)*Math.PI*2-Math.PI/2;
    const grad=ctx.createLinearGradient(cx-r,0,cx+r,0);
    grad.addColorStop(0,color); grad.addColorStop(1,'#a855f7');
    ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,end);
    ctx.strokeStyle=grad; ctx.lineWidth=10; ctx.lineCap='round';
    ctx.shadowColor=color; ctx.shadowBlur=16;
    ctx.stroke(); ctx.shadowBlur=0;
  }
}

// ── Copilot ─────────────────────────────────────────────
function useSuggestion(btn) {
  const text = btn.textContent.replace(/^[\p{Emoji}\s]+/u,'').trim();
  document.getElementById('copInput').value = text;
  sendCopilot();
}

function clearChat() { S.chatLog=[]; renderChat(); }

function sendCopilot() {
  const inp = document.getElementById('copInput');
  const q   = inp.value.trim();
  if (!q) return;
  if (!S.loaded) { toast('Please upload your data first','error'); return; }

  S.chatLog.push({role:'user', text:q});
  S.chatLog.push({role:'ai', loading:true});
  inp.value='';
  renderChat();

  fetch('/api/copilot', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:q})
  })
  .then(r=>r.json())
  .then(d=>{
    S.chatLog[S.chatLog.length-1] = {role:'ai', answer: d.answer};
    renderChat();
  })
  .catch(e=>{
    S.chatLog[S.chatLog.length-1] = {role:'ai', answer:{
      answer:`Sorry, I couldn't process that. Error: ${e}`,
      data_cards:[], table:null, follow_up:[]
    }};
    renderChat();
  });
}

function renderChat() {
  const area = document.getElementById('chatArea');
  if (!S.chatLog.length) {
    area.innerHTML=`<div class="chat-empty">
      <div class="chat-empty-icon">
        <svg viewBox="0 0 28 28" fill="none" width="48">
          <path d="M14 2L26 9V19L14 26L2 19V9L14 2Z" fill="url(#ce2)"/>
          <defs><linearGradient id="ce2" x1="2" y1="2" x2="26" y2="26">
            <stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/>
          </linearGradient></defs>
        </svg>
      </div>
      <p>Ask me anything about your store and I'll give you specific, actionable answers.</p>
    </div>`;
    return;
  }

  // Show suggestions only if chat is empty
  const sug = document.getElementById('suggestions');
  if (sug) sug.style.display = S.chatLog.length>0?'none':'block';

  area.innerHTML = S.chatLog.map(m=>{
    if (m.role==='user') return `
      <div class="chat-row user">
        <div class="chat-bubble">${esc(m.text)}</div>
      </div>`;

    if (m.loading) return `
      <div class="chat-row ai">
        <div class="ai-ava">${aiSVG()}</div>
        <div class="ai-body"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
      </div>`;

    const a = m.answer || {};
    const answerText = a.answer || a.text || '';
    let body = answerText ? `<div class="ai-text">${mdBold(answerText)}</div>` : '';

    // Data cards
    if (a.data_cards?.length) {
      body += `<div class="data-cards">
        ${a.data_cards.map(c=>`
          <div class="data-card color-${c.color||'blue'}">
            <div class="dc-icon">${c.icon||'📊'}</div>
            <div class="dc-val">${c.value}</div>
            <div class="dc-label">${c.label}</div>
          </div>`).join('')}
      </div>`;
    }

    // Table
    if (a.table?.headers) {
      body += `<div class="ai-table-wrap">
        <table>
          <thead><tr>${a.table.headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${a.table.rows?.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')||''}</tbody>
        </table>
      </div>`;
    }

    // Follow-ups
    if (a.follow_up?.length) {
      body += `<div class="follow-ups">
        ${a.follow_up.map(f=>`<button class="follow-up" onclick="sendFollowUp(this)">${f}</button>`).join('')}
      </div>`;
    }

    return `<div class="chat-row ai">
      <div class="ai-ava">${aiSVG()}</div>
      <div class="ai-body">${body||'<div class="ai-text">No response generated.</div>'}</div>
    </div>`;
  }).join('');

  area.scrollTop = area.scrollHeight;
}

function sendFollowUp(btn) {
  document.getElementById('copInput').value = btn.textContent;
  sendCopilot();
}

// ── Helpers ─────────────────────────────────────────────
function aiSVG() {
  return `<svg viewBox="0 0 28 28" fill="none" width="22">
    <path d="M14 2L26 9V19L14 26L2 19V9L14 2Z" fill="url(#aig)"/>
    <defs><linearGradient id="aig" x1="2" y1="2" x2="26" y2="26">
      <stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/>
    </linearGradient></defs>
  </svg>`;
}

function mdBold(s) {
  return String(s||'').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
}
function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmt(v) {
  if (v===null||v===undefined) return '—';
  if (typeof v==='number') return Number.isInteger(v)?v.toLocaleString():v.toFixed(2);
  return String(v);
}
function fmtN(v) { return v===undefined||v===null?'0':typeof v==='number'?v.toLocaleString():v; }
function fmtNum(v) {
  if (!v) return '0';
  if (v>=1e7) return (v/1e7).toFixed(1)+'Cr';
  if (v>=1e5) return (v/1e5).toFixed(1)+'L';
  if (v>=1e3) return (v/1e3).toFixed(1)+'K';
  return v.toFixed(0);
}

// ── Loader & Toast ──────────────────────────────────────
function showLoader(text='Working...', sub='') {
  const s=document.getElementById('loaderScreen'), t=document.getElementById('loaderText'), b=document.getElementById('loaderSub');
  document.getElementById('welcomeScreen').style.display='none';
  if(s) s.style.display='flex';
  if(t) t.textContent=text;
  if(b) b.textContent=sub;
}
function hideLoader() {
  const s=document.getElementById('loaderScreen');
  if(s) s.style.display='none';
}

function toast(msg, type='info') {
  const colors = {success:'#10b981', error:'#ef4444', info:'#6366f1'};
  const el = document.createElement('div');
  el.style.cssText=`
    position:fixed;bottom:28px;right:28px;z-index:9999;
    background:${colors[type]||colors.info};color:white;
    padding:13px 22px;border-radius:10px;font-size:13px;font-weight:600;
    font-family:'Inter',sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);
    animation:slideUp 0.3s ease;max-width:360px;line-height:1.4;
  `;
  el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3800);
}
