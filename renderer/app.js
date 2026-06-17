// ── Utility Functions ──────────────────────────────────────────────────
function formatTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatCost(dollars) {
  return '$' + dollars.toFixed(2);
}

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '< 1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function formatDate(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function elapsedTime(isoString) {
  if (!isoString) return '--';
  const ms = Date.now() - new Date(isoString).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return 'just now';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return h + 'h ' + m + 'm elapsed';
  return m + 'm elapsed';
}

/**
 * Clean a Claude Code project folder name into a human-readable label.
 * Example transformations:
 *   "C--Users-janedoe-Desktop-MyApp"  → "My App"
 *   "C--Users-janedoe"                → "Home Directory"
 *   "C--Windows-system32"             → "Windows System32"
 */
function cleanProjectName(raw) {
  if (!raw) return 'Unknown';

  let name = raw;

  // Strip leading drive letter + /Users/<name>/ path prefix (case-insensitive)
  name = name.replace(/^[a-zA-Z]--Users-[^-]+-?/i, '');

  // Remove "Desktop-" prefix if present (may have single or double dash)
  name = name.replace(/^Desktop-{1,2}/i, '');

  // Replace remaining dashes (single or double) with spaces
  name = name.replace(/--?/g, ' ').trim();

  // If nothing meaningful remains after stripping the user prefix, show "Home Directory"
  if (!name) {
    return 'Home Directory';
  }

  // Capitalize first letter of each word
  name = name.replace(/\b\w/g, c => c.toUpperCase());

  return name;
}

// ── Model Pricing ─────────────────────────────────────────────────────────
const DEFAULT_PRICING = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 0.8, output: 4 },
  'default': { input: 15, output: 75 }
};

function getPricing() {
  try {
    const saved = localStorage.getItem('claudelens-pricing');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_PRICING, ...parsed };
    }
  } catch (e) {
    console.error('Failed to parse saved pricing:', e);
  }
  return { ...DEFAULT_PRICING };
}

function savePricing(pricing) {
  try {
    localStorage.setItem('claudelens-pricing', JSON.stringify(pricing));
    return true;
  } catch (e) {
    console.error('Failed to save pricing:', e);
    return false;
  }
}

function getPricingForModel(model) {
  const pricing = getPricing();
  if (pricing[model]) return pricing[model];
  return pricing['default'];
}

function calculateCost(inputTokens, outputTokens, model) {
  const p = getPricingForModel(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ── Path Override ─────────────────────────────────────────────────────────
function getJsonlPath() {
  // Default to empty — the main process uses os.homedir() automatically.
  // The user sets this only if they want to override with a custom path.
  return localStorage.getItem('claudelens-jsonl-path') || '';
}

function saveJsonlPath(val) {
  localStorage.setItem('claudelens-jsonl-path', val);
}

// ── State ──────────────────────────────────────────────────────────────────
let allSessions = [];
let activeSessionData = null;
let currentSort = { field: 'startTime', dir: 'desc' };

// ── DOM References ─────────────────────────────────────────────────────────
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ── Navigation ─────────────────────────────────────────────────────────────
const navBtns = $$('.nav-btn');
const views = $$('.view');

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const viewName = btn.dataset.view;
    // Update active nav
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Update active view
    views.forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Trigger view-specific rendering
    if (viewName === 'dashboard') renderDashboard();
    else if (viewName === 'sessions') renderSessions();
    else if (viewName === 'projects') renderProjects();
    else if (viewName === 'graphs') renderGraphs();
    else if (viewName === 'settings') renderSettings();
  });
});

// ── Titlebar Buttons ──────────────────────────────────────────────────────
$('#btn-minimize').addEventListener('click', () => window.claudeLens.minimize());
$('#btn-maximize').addEventListener('click', () => window.claudeLens.maximize());
$('#btn-close').addEventListener('click', () => window.claudeLens.close());

// ── Data Loading ──────────────────────────────────────────────────────────
async function loadAllData() {
  try {
    const result = await window.claudeLens.readSessions();
    if (result.success) {
      allSessions = result.data;
    } else {
      console.error('Failed to load sessions:', result.error);
      allSessions = [];
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
    allSessions = [];
  }

  // Add computed cost and cleaned display name to each session
  allSessions.forEach(s => {
    s.cost = calculateCost(s.inputTokens, s.outputTokens, s.model || 'default');
    s.displayProject = cleanProjectName(s.project);
  });
}

async function loadActiveSession() {
  try {
    const result = await window.claudeLens.readActiveSession();
    if (result.success) {
      activeSessionData = result.data;
      updateDashboardLive();
    }
  } catch (err) {
    console.error('Error loading active session:', err);
  }
}

// ── Live Update Handler ───────────────────────────────────────────────────
window.claudeLens.onActiveSessionUpdate((data) => {
  activeSessionData = data;
  updateDashboardLive();
});

// ── Dashboard Rendering ───────────────────────────────────────────────────
function updateDashboardLive() {
  if (!activeSessionData) return;

  const tokens = activeSessionData.tokens || 0;
  const model = activeSessionData.model || 'default';
  const startTime = activeSessionData.startTime;
  const active = activeSessionData.active;
  const cost = calculateCost(
    activeSessionData.inputTokens || 0,
    activeSessionData.outputTokens || 0,
    model
  );

  // Live tokens
  const liveTokensEl = $('#live-tokens');
  if (liveTokensEl) liveTokensEl.textContent = tokens.toLocaleString();

  // Live sub (elapsed)
  const liveSubEl = $('#live-sub');
  if (liveSubEl) {
    if (startTime) {
      liveSubEl.textContent = elapsedTime(startTime);
    } else {
      liveSubEl.textContent = 'No active session';
    }
  }

  // Live dot
  const liveDot = $('#live-dot');
  if (liveDot) {
    if (active) liveDot.classList.add('active');
    else liveDot.classList.remove('active');
  }

  // Session cost
  const costEl = $('#session-cost');
  if (costEl) costEl.textContent = formatCost(cost);

  // Session cost model
  const modelEl = $('#session-cost-model');
  if (modelEl) modelEl.textContent = 'model: ' + model;

  // All-time tokens
  const allTokens = allSessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const allTokensEl = $('#alltime-tokens');
  if (allTokensEl) allTokensEl.textContent = formatTokens(allTokens);

  // All-time cost
  const allCost = allSessions.reduce((sum, s) => sum + (s.cost || 0), 0);
  const allCostEl = $('#alltime-cost');
  if (allCostEl) allCostEl.textContent = formatCost(allCost);
}

function renderDashboard() {
  updateDashboardLive();
  renderTodaySessions();
  renderTopProjectsThisWeek();
}

function renderTodaySessions() {
  const container = $('#today-sessions-list');
  if (!container) return;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const todaySessions = allSessions.filter(s => {
    if (!s.startTime) return false;
    const st = new Date(s.startTime);
    return st >= todayStart && st < todayEnd;
  });

  if (todaySessions.length === 0) {
    container.innerHTML = '<div class="zero-state">No sessions today</div>';
    return;
  }

  container.innerHTML = todaySessions.map(s => {
    const name = s.displayProject || cleanProjectName(s.project);
    const tokensStr = formatTokens(s.totalTokens);
    const durStr = formatDuration(s.durationMinutes);
    const costStr = formatCost(s.cost || 0);
    return `
      <div class="today-row">
        <span class="today-row-name">${escapeHtml(name)}</span>
        <div class="today-row-meta">
          <span>${tokensStr}</span>
          <span>${durStr}</span>
          <span class="today-row-cost">${costStr}</span>
        </div>
      </div>`;
  }).join('');
}

function renderTopProjectsThisWeek() {
  const container = $('#top-projects-chart');
  if (!container) return;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const weekSessions = allSessions.filter(s => {
    if (!s.startTime) return false;
    return new Date(s.startTime) >= weekAgo;
  });

  // Aggregate by project (use raw project key, but display with cleaned name)
  const projectMap = {};
  weekSessions.forEach(s => {
    const key = s.project;
    if (!projectMap[key]) {
      projectMap[key] = { tokens: 0, displayName: s.displayProject || cleanProjectName(s.project) };
    }
    projectMap[key].tokens += s.totalTokens;
  });

  const sorted = Object.entries(projectMap)
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="zero-state">No data this week</div>';
    return;
  }

  const maxTokens = sorted[0][1].tokens || 1;

  container.innerHTML = `
    <div class="bar-chart">
      ${sorted.map(([, info]) => {
        const pct = Math.max(2, Math.round((info.tokens / maxTokens) * 100));
        const shortName = info.displayName.length > 10 ? info.displayName.substring(0, 9) + '...' : info.displayName;
        return `
          <div class="bar-wrapper">
            <div class="bar-tooltip">${escapeHtml(info.displayName)} — ${formatTokens(info.tokens)}</div>
            <div class="bar-fill" style="height:${pct}%"></div>
            <div class="bar-label">${escapeHtml(shortName)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Sessions View ─────────────────────────────────────────────────────────
let sessionSortField = 'startTime';
let sessionSortDir = 'desc';

function renderSessions() {
  const tbody = $('#sessions-tbody');
  const tfoot = $('#sessions-tfoot');
  const zeroEl = $('#sessions-zero');
  const table = $('#sessions-table');
  if (!tbody || !tfoot) return;

  const searchTerm = ($('#session-search').value || '').toLowerCase();
  let filtered = allSessions.filter(s => {
    if (!searchTerm) return true;
    const name = (s.displayProject || cleanProjectName(s.project)).toLowerCase();
    return name.includes(searchTerm);
  });

  // Sort
  filtered.sort((a, b) => {
    let valA = a[sessionSortField];
    let valB = b[sessionSortField];
    if (sessionSortField === 'startTime') {
      valA = valA ? new Date(valA).getTime() : 0;
      valB = valB ? new Date(valB).getTime() : 0;
    }
    if (sessionSortField === 'project') {
      valA = (a.displayProject || cleanProjectName(a.project)).toLowerCase();
      valB = (b.displayProject || cleanProjectName(b.project)).toLowerCase();
    }
    if (sessionSortField === 'cost') {
      valA = a.cost || 0;
      valB = b.cost || 0;
    }
    if (typeof valA === 'string' && sessionSortField !== 'startTime') valA = valA.toLowerCase();
    if (typeof valB === 'string' && sessionSortField !== 'startTime') valB = valB.toLowerCase();
    if (valA < valB) return sessionSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sessionSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  if (filtered.length === 0) {
    if (table) table.style.display = 'none';
    if (zeroEl) { zeroEl.style.display = 'flex'; zeroEl.classList.add('table-zero'); }
    return;
  }

  if (table) table.style.display = '';
  if (zeroEl) { zeroEl.style.display = 'none'; zeroEl.classList.remove('table-zero'); }

  // Update sort indicators
  $$('#sessions-table th.sortable').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === sessionSortField) {
      th.classList.add(sessionSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      const arrow = sessionSortDir === 'asc' ? ' ▲' : ' ▼';
      const raw = th.textContent.replace(/ [▲▼]$/, '');
      th.textContent = raw + arrow;
    } else {
      th.textContent = th.textContent.replace(/ [▲▼]$/, '');
    }
  });

  // Totals
  let totInput = 0, totOutput = 0, totCache = 0, totTokens = 0, totCost = 0, totDuration = 0;
  filtered.forEach(s => {
    totInput += s.inputTokens || 0;
    totOutput += s.outputTokens || 0;
    totCache += s.cacheTokens || 0;
    totTokens += s.totalTokens || 0;
    totCost += s.cost || 0;
    totDuration += s.durationMinutes || 0;
  });

  tbody.innerHTML = filtered.map(s => {
    const name = s.displayProject || cleanProjectName(s.project);
    return `
      <tr>
        <td>${formatDate(s.startTime)} ${formatTime(s.startTime)}</td>
        <td>${escapeHtml(name)}</td>
        <td>${formatDuration(s.durationMinutes)}</td>
        <td>${s.inputTokens.toLocaleString()}</td>
        <td>${s.outputTokens.toLocaleString()}</td>
        <td>${(s.cacheTokens || 0).toLocaleString()}</td>
        <td>${s.totalTokens.toLocaleString()}</td>
        <td>${formatCost(s.cost || 0)}</td>
      </tr>`;
  }).join('');

  tfoot.innerHTML = `
    <tr>
      <td><strong>TOTAL (${filtered.length} sessions)</strong></td>
      <td></td>
      <td>${formatDuration(totDuration)}</td>
      <td>${totInput.toLocaleString()}</td>
      <td>${totOutput.toLocaleString()}</td>
      <td>${totCache.toLocaleString()}</td>
      <td>${totTokens.toLocaleString()}</td>
      <td>${formatCost(totCost)}</td>
    </tr>`;
}

// Sessions sorting
$$('#sessions-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    if (sessionSortField === field) {
      sessionSortDir = sessionSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sessionSortField = field;
      sessionSortDir = 'desc';
    }
    renderSessions();
  });
});

// Search filter
$('#session-search').addEventListener('input', () => {
  renderSessions();
});

// ── Projects View ─────────────────────────────────────────────────────────
function renderProjects() {
  const grid = $('#projects-grid');
  if (!grid) return;

  // Aggregate by project (use raw project key)
  const projectMap = {};
  allSessions.forEach(s => {
    const key = s.project;
    if (!projectMap[key]) {
      projectMap[key] = {
        name: key,
        displayName: s.displayProject || cleanProjectName(key),
        sessions: 0,
        totalTokens: 0,
        totalCost: 0,
        lastActive: ''
      };
    }
    const p = projectMap[key];
    p.sessions++;
    p.totalTokens += s.totalTokens;
    p.totalCost += (s.cost || 0);
    if (s.startTime && (!p.lastActive || s.startTime > p.lastActive)) {
      p.lastActive = s.startTime;
    }
  });

  const projects = Object.values(projectMap).sort((a, b) => b.totalTokens - a.totalTokens);

  if (projects.length === 0) {
    grid.innerHTML = '<div class="zero-state">No projects found</div>';
    return;
  }

  const maxTokens = Math.max(...projects.map(p => p.totalTokens));

  grid.innerHTML = projects.map(p => {
    const barPct = maxTokens > 0 ? Math.round((p.totalTokens / maxTokens) * 100) : 0;
    return `
      <div class="project-card">
        <div class="project-card-name">${escapeHtml(p.displayName)}</div>
        <div class="project-card-stats">
          <div class="project-card-stat">
            <div class="project-card-stat-label">Sessions</div>
            <div class="project-card-stat-value">${p.sessions}</div>
          </div>
          <div class="project-card-stat">
            <div class="project-card-stat-label">Tokens</div>
            <div class="project-card-stat-value">${formatTokens(p.totalTokens)}</div>
          </div>
          <div class="project-card-stat">
            <div class="project-card-stat-label">Est. Cost</div>
            <div class="project-card-stat-value">${formatCost(p.totalCost)}</div>
          </div>
          <div class="project-card-stat">
            <div class="project-card-stat-label">Last Active</div>
            <div class="project-card-stat-value">${formatDate(p.lastActive)}</div>
          </div>
        </div>
        <div class="project-card-bar-outer">
          <div class="project-card-bar-inner" style="width:${barPct}%"></div>
        </div>
        <div class="project-card-last">${barPct}% of total usage</div>
      </div>`;
  }).join('');
}

// ── Graphs View ───────────────────────────────────────────────────────────
function renderGraphs() {
  const container = $('#graph-container');
  const rollingSvg = $('#rolling-svg');
  const rollingZero = $('#rolling-zero');
  if (!container || !rollingSvg) return;

  // Aggregate daily tokens for last 30 days
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    days.push({ date: d, dateKey, tokens: 0, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  }

  allSessions.forEach(s => {
    if (!s.startTime) return;
    const dateKey = new Date(s.startTime).toISOString().slice(0, 10);
    const day = days.find(d => d.dateKey === dateKey);
    if (day) day.tokens += s.totalTokens;
  });

  console.log('[claudelens] Graph data — 30 days token totals:', days.map(d => d.dateKey + '=' + d.tokens));

  const maxTokens = Math.max(...days.map(d => d.tokens), 1);

  if (days.every(d => d.tokens === 0)) {
    container.innerHTML = '<div class="zero-state">No data available</div>';
    if (rollingZero) rollingZero.style.display = 'block';
    if (rollingSvg) rollingSvg.style.display = 'none';
    return;
  }

  // Date range title
  const startDate = days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDate = days[days.length - 1].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Build Y-axis labels (4 evenly spaced intervals)
  const ySteps = 4;
  const yAxisLabels = [];
  for (let i = 0; i <= ySteps; i++) {
    yAxisLabels.push(Math.round((maxTokens / ySteps) * i));
  }

  // Bar chart with Y-axis + X-axis — only show X label every 5 bars
  container.innerHTML = `
    <div class="graph-title">${startDate} — ${endDate}</div>
    <div class="graph-legend">
      <span class="legend-item"><span class="legend-swatch legend-bar"></span> Daily Tokens</span>
      <span class="legend-item"><span class="legend-swatch legend-line"></span> 7-Day Rolling Avg</span>
    </div>
    <div class="bar-chart-shell">
      <div class="y-axis">
        ${yAxisLabels.map(v => {
          const pct = maxTokens > 0 ? 100 - Math.round((v / maxTokens) * 100) : 0;
          return `<span class="y-tick" style="top:${pct}%">${formatTokens(v)}</span>`;
        }).join('')}
      </div>
      <div class="bar-chart-area">
        ${days.map((d, i) => {
          const pct = maxTokens > 0 ? Math.round((d.tokens / maxTokens) * 100) : 0;
          const heightPct = Math.max(4, pct); // minimum 4% height so every data day is visible
          const showLabel = (i % 5 === 0) || (i === days.length - 1);
          return `
            <div class="bar-wrapper">
              <div class="bar-inner">
                <div class="bar-tooltip">${d.label}: ${formatTokens(d.tokens)}</div>
                <div class="bar-fill" style="height:${heightPct}%"></div>
              </div>
              <div class="bar-label">${showLabel ? d.label : ''}</div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // Rolling 7-day average line chart
  if (rollingZero) rollingZero.style.display = 'none';
  if (rollingSvg) {
    rollingSvg.style.display = 'block';
    renderRollingAverage(days, rollingSvg);
  }
}

function renderRollingAverage(days, svg) {
  // Calculate 7-day rolling averages
  const averages = [];
  for (let i = 6; i < days.length; i++) {
    const win = days.slice(i - 6, i + 1);
    const avg = win.reduce((sum, d) => sum + d.tokens, 0) / 7;
    averages.push({ index: i, avg, dateKey: days[i].dateKey });
  }

  if (averages.length === 0) {
    svg.innerHTML = '';
    return;
  }

  const maxAvg = Math.max(...averages.map(a => a.avg), 1);
  const width = 800;
  const height = 220;
  const padLeft = 56;
  const padRight = 24;
  const padTop = 16;
  const padBottom = 24;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  function xPos(i) {
    return padLeft + (i / (averages.length - 1 || 1)) * plotWidth;
  }

  function yPos(val) {
    return padTop + plotHeight - (val / maxAvg) * plotHeight;
  }

  // Build points for polyline
  const points = averages.map((a, i) => `${xPos(i)},${yPos(a.avg)}`).join(' ');

  // Build area fill polygon that follows the line exactly:
  // Start at bottom-left, trace all data points left-to-right, go down
  // to bottom-right, then back across the bottom to bottom-left to close.
  const lastIdx = averages.length - 1;
  const bottomY = yPos(0); // baseline at y=0 in data space
  const areaPoints = [
    `${xPos(0)},${bottomY}`,
    ...averages.map((a, i) => `${xPos(i)},${yPos(a.avg)}`),
    `${xPos(lastIdx)},${bottomY}`
  ].join(' ');

  // Y-axis labels — 4 evenly spaced positive values
  const ySteps = 4;
  const yLabels = [];
  for (let i = 0; i <= ySteps; i++) {
    yLabels.push((maxAvg / ySteps) * i);
  }

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d4a27f" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#d4a27f" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <!-- Area fill under line -->
    <polygon points="${areaPoints}" fill="url(#areaGrad)" stroke="none"/>
    <!-- Grid lines + Y-axis labels -->
    ${yLabels.map(v => {
      const y = yPos(v);
      const labelY = v === 0 ? y - 4 : y + 4;
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(212,162,127,0.08)" stroke-width="0.5"/>
        <text x="${padLeft - 8}" y="${labelY}" text-anchor="end" fill="rgba(245,240,235,0.35)" font-size="10" font-family="system-ui">${formatTokens(v)}</text>`;
    }).join('')}
    <!-- Polyline -->
    <polyline points="${points}" fill="none" stroke="#d4a27f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <!-- Dot markers at each data point -->
    ${averages.map((a, i) => {
      return `<circle cx="${xPos(i)}" cy="${yPos(a.avg)}" r="3" fill="#c96442" stroke="none"/>`;
    }).join('')}
  `;
}

// ── Settings View ─────────────────────────────────────────────────────────
function renderSettings() {
  const pricingGrid = $('#pricing-grid');
  const pathInput = $('#jsonl-path-input');
  const pathHint = $('#path-hint');
  if (!pricingGrid) return;

  const pricing = getPricing();

  pricingGrid.innerHTML = Object.keys(DEFAULT_PRICING).map(key => {
    const model = DEFAULT_PRICING[key];
    const current = pricing[key] || model;
    return `
      <div class="settings-field">
        <div class="model-name">${key}</div>
        <label>Input price ($/M tokens)</label>
        <input type="number" step="0.01" min="0" data-model="${key}" data-field="input" value="${current.input}">
        <label>Output price ($/M tokens)</label>
        <input type="number" step="0.01" min="0" data-model="${key}" data-field="output" value="${current.output}">
      </div>`;
  }).join('');

  if (pathInput) pathInput.value = getJsonlPath();
  if (pathHint) pathHint.textContent = '';
}

// Settings save handlers
$('#btn-save-pricing').addEventListener('click', () => {
  const inputs = $$('#pricing-grid input');
  const newPricing = {};
  inputs.forEach(input => {
    const model = input.dataset.model;
    const field = input.dataset.field;
    const val = parseFloat(input.value) || 0;
    if (!newPricing[model]) newPricing[model] = { input: 0, output: 0 };
    newPricing[model][field] = val;
  });

  if (savePricing(newPricing)) {
    // Flash feedback
    const btn = $('#btn-save-pricing');
    btn.textContent = 'Saved!';
    btn.style.background = 'var(--success)';
    setTimeout(() => {
      btn.textContent = 'Save Pricing';
      btn.style.background = '';
    }, 1500);

    // Recalculate costs
    allSessions.forEach(s => {
      s.cost = calculateCost(s.inputTokens, s.outputTokens, s.model || 'default');
    });
    renderDashboard();
  }
});

$('#btn-save-path').addEventListener('click', () => {
  const val = $('#jsonl-path-input').value.trim();
  if (val) {
    saveJsonlPath(val);
    const btn = $('#btn-save-path');
    const hint = $('#path-hint');
    btn.textContent = 'Saved!';
    btn.style.background = 'var(--success)';
    if (hint) hint.textContent = 'Path saved. Restart the app for changes to take effect.';
    setTimeout(() => {
      btn.textContent = 'Save Path';
      btn.style.background = '';
    }, 1500);
  }
});

// ── Escape HTML ────────────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Initialization ─────────────────────────────────────────────────────────
async function init() {
  await loadAllData();
  await loadActiveSession();
  renderDashboard();
}

init();