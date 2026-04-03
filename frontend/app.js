/**
 * Macro Monitor — Frontend
 */

const API_URL =
  window.MACRO_MONITOR_API_URL ||
  'https://macro-monitor-api.paulo-r-l-andre.workers.dev/api/data';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  loading: true,
  error: null,
  data: null,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSigned(n) {
  if (n === null || n === undefined) return 'N/A';
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function colorize(el, value) {
  el.classList.remove('text-green', 'text-red', 'text-amber', 'text-neutral');
  if (value > 0) el.classList.add('text-green');
  else if (value < 0) el.classList.add('text-red');
  else el.classList.add('text-neutral');
}

// ---------------------------------------------------------------------------
// Regime label formatting
// ---------------------------------------------------------------------------

const USD_REGIME_LABELS = {
  USD_STRENGTH_REAL_RATES: 'bonds paying well, pulling money in',
  USD_STRENGTH_RISK_OFF: 'investors running to safety',
  USD_WEAKNESS_FALLING_REAL_RATES: 'bond returns dropping, dollar less attractive',
  USD_WEAKNESS_HARD_ASSETS: 'money moving to gold and commodities',
  MIXED: 'no clear driver',
};

const GOLD_REGIME_LABELS = {
  GOLD_STRENGTH_REAL_RATES: 'bonds paying less, gold looks better',
  GOLD_STRENGTH_INFLATION: 'inflation fears pushing money to gold',
  GOLD_STRENGTH_RISK_OFF: 'fear trade — stocks down, dollar down, gold up',
  GOLD_WEAKNESS_RISING_REAL_RATES: 'bonds paying more, gold less attractive',
  GOLD_WEAKNESS_STRONG_DOLLAR: 'strong dollar making gold expensive',
  MIXED: 'no clear driver',
};

const MACRO_REGIME_LABELS = {
  TIGHTENING: 'Tightening',
  REFLATION_OR_STAGFLATION: 'Reflation / Stagflation',
  STRESS_SAFE_HAVEN: 'Fear — both safe havens bid',
  DISINFLATIONARY_RISK_ON: 'Risk on — stocks leading',
  GOLD_SPECIFIC_DRIVER: 'Gold moving on its own',
  USD_TECHNICAL_MOVE: 'Dollar moving without confirmation',
  MIXED: 'Mixed',
};

// ---------------------------------------------------------------------------
// Sparkline SVG rendering
// ---------------------------------------------------------------------------

function renderSparkline(containerId, history, accentColor) {
  const container = document.getElementById(containerId);
  if (!container || !history || history.length < 2) return;

  const width = 320;
  const height = 80;
  const padX = 1;
  const padY = 4;

  const yMin = -1;
  const yMax = 1;

  // Map data to pixel coordinates
  const points = history.map((d, i) => {
    const x = padX + (i / (history.length - 1)) * (width - 2 * padX);
    const y = padY + ((yMax - d.score) / (yMax - yMin)) * (height - 2 * padY);
    return { x, y };
  });

  // Build smooth SVG path using Catmull-Rom to Bezier conversion
  function catmullRomToBezier(pts) {
    const d = [`M ${pts[0].x},${pts[0].y}`];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
    }
    return d.join(' ');
  }

  const linePath = catmullRomToBezier(points);

  // Area fill path — line path + close along bottom
  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  // Zero line y position
  const zeroY = padY + ((yMax - 0) / (yMax - yMin)) * (height - 2 * padY);
  const areaPath = linePath + ` L ${lastPt.x},${zeroY} L ${firstPt.x},${zeroY} Z`;

  const gradientId = `${containerId}-grad`;

  const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:${height}px;display:block;">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <line x1="${padX}" y1="${zeroY}" x2="${width - padX}" y2="${zeroY}" stroke="#2a2a2a" stroke-width="0.5" stroke-dasharray="4,3"/>
  <path d="${areaPath}" fill="url(#${gradientId})" stroke="none"/>
  <path d="${linePath}" fill="none" stroke="${accentColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

  container.innerHTML = svg;
}

function formatSparklineLabel(history) {
  if (!history || history.length < 2) return 'Score History';
  const first = history[0].date;
  const last = history[history.length - 1].date;
  const firstYear = first.split('-')[0];
  const lastYear = last.split('-')[0];
  const crossesYear = firstYear !== lastYear;
  const fmt = (d) => {
    const [y, m, day] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const base = `${months[parseInt(m) - 1]} ${parseInt(day)}`;
    return crossesYear ? `${base} '${y.slice(2)}` : base;
  };
  return `${fmt(first)} — ${fmt(last)}`;
}

function renderValueSparkline(containerId, history, accentColor, yLabelFmt) {
  if (!yLabelFmt) yLabelFmt = (v) => (v / 1000).toFixed(1);
  const container = document.getElementById(containerId);
  if (!container || !history || history.length < 2) return;

  const width = 320;
  const height = 80;
  const padX = 1;
  const padY = 4;

  const values = history.map((d) => d.value);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const yRange = yMax - yMin || 1;

  const points = history.map((d, i) => {
    const x = padX + (i / (history.length - 1)) * (width - 2 * padX);
    const y = padY + ((yMax - d.value) / yRange) * (height - 2 * padY);
    return { x, y };
  });

  function catmullRomToBezier(pts) {
    const d = [`M ${pts[0].x},${pts[0].y}`];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
    }
    return d.join(' ');
  }

  const linePath = catmullRomToBezier(points);
  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  const areaPath = linePath + ` L ${lastPt.x},${height - padY} L ${firstPt.x},${height - padY} Z`;
  const gradientId = `${containerId}-grad`;

  const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:${height}px;display:block;">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="${areaPath}" fill="url(#${gradientId})" stroke="none"/>
  <path d="${linePath}" fill="none" stroke="${accentColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

  // Build x-axis labels as HTML so they don't get stretched
  const seenMonths = new Set();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labels = [];
  for (let i = 0; i < history.length; i++) {
    const [y, m] = history[i].date.split('-');
    const key = `${y}-${m}`;
    if (!seenMonths.has(key)) {
      seenMonths.add(key);
      const pct = (i / (history.length - 1)) * 100;
      if (pct > 3 && pct < 97) {
        labels.push(`<span style="position:absolute;left:${pct}%;transform:translateX(-50%)" class="text-[9px] text-neutral/50 font-mono">${months[parseInt(m) - 1]}</span>`);
      }
    }
  }

  // Build y-axis labels
  const yMaxLabel = yLabelFmt(yMax);
  const yMinLabel = yLabelFmt(yMin);

  container.innerHTML =
    `<div style="position:relative;">` +
      `<div style="position:absolute;left:0;top:0;bottom:14px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none;">` +
        `<span class="text-[9px] text-neutral/50 font-mono" style="transform:translateY(-50%)">${yMaxLabel}</span>` +
        `<span class="text-[9px] text-neutral/50 font-mono" style="transform:translateY(50%)">${yMinLabel}</span>` +
      `</div>` +
      `<div style="margin-left:28px;">` +
        svg +
        `<div style="position:relative;height:14px;margin-top:2px;">${labels.join('')}</div>` +
      `</div>` +
    `</div>`;
}

function getSparklineColor(score, positiveColor, negativeColor) {
  if (score > 0) return positiveColor;
  if (score < 0) return negativeColor;
  return '#9e9e9e';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const loadingEl = $('#loading');
  const errorEl = $('#error');
  const dashboardEl = $('#dashboard');

  if (state.loading) {
    show(loadingEl);
    hide(errorEl);
    hide(dashboardEl);
    return;
  }

  hide(loadingEl);

  if (state.error) {
    show(errorEl);
    hide(dashboardEl);
    $('#error-message').textContent = state.error;
    return;
  }

  hide(errorEl);
  show(dashboardEl);

  const d = state.data;

  // ---- DOLLAR PANEL ----
  renderMonitorScore(
    '#usd-score-container',
    '#usd-score-value',
    d.dollar.score,
    d.dollar.signal,
    'STRONG_USD',
    'WEAK_USD',
    'green',
    0
  );

  renderSignalBadge(
    '#usd-signal-badge',
    d.dollar.signal,
    { STRONG_USD: 'STRONG USD', WEAK_USD: 'WEAK USD', NEUTRAL: 'NEUTRAL' },
    { STRONG_USD: 'green', WEAK_USD: 'red', NEUTRAL: 'neutral' }
  );

  const usdSignalWord = d.dollar.signal === 'STRONG_USD' ? 'Strong' : d.dollar.signal === 'WEAK_USD' ? 'Weak' : 'Neutral';
  $('#usd-regime-line').textContent = `${usdSignalWord} USD — ${USD_REGIME_LABELS[d.dollar.regime] || d.dollar.regime.toLowerCase()}`;

  $('#usd-interpretation').textContent = d.dollar.interpretation;

  // Dollar sparkline
  if (d.dollar.history && d.dollar.history.length > 1) {
    const usdColor = getSparklineColor(d.dollar.score, '#00e676', '#ff1744');
    renderSparkline('usd-sparkline', d.dollar.history, usdColor);
    $('#usd-sparkline-container .sparkline-label').textContent = formatSparklineLabel(d.dollar.history);
    const usdSparkContainer = $('#usd-sparkline-container');
    setTimeout(() => {
      usdSparkContainer.classList.remove('opacity-0');
      usdSparkContainer.classList.add('opacity-100');
    }, 50);
  }

  // Dollar data strip
  $('#val-dxy').textContent = d.dollar.inputs.dxy.toFixed(2);
  $('#val-10y').textContent = d.dollar.inputs.us10y_yield.toFixed(2) + '%';
  $('#val-breakeven').textContent = d.dollar.inputs.breakeven.toFixed(2) + '%';
  $('#val-spx').textContent = d.dollar.inputs.spx.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  $('#val-real-yield').textContent = formatSigned(d.dollar.derived.real_yield) + '%';
  colorize($('#val-real-yield'), d.dollar.derived.real_yield);

  $('#val-dxy-trend').textContent =
    d.dollar.derived.dxy_trend !== null ? formatSigned(d.dollar.derived.dxy_trend) + '%' : 'N/A';
  if (d.dollar.derived.dxy_trend !== null) colorize($('#val-dxy-trend'), d.dollar.derived.dxy_trend);

  $('#val-spx-trend').textContent =
    d.dollar.derived.spx_trend !== null ? formatSigned(d.dollar.derived.spx_trend) + '%' : 'N/A';
  if (d.dollar.derived.spx_trend !== null) colorize($('#val-spx-trend'), d.dollar.derived.spx_trend);

  // ---- GOLD PANEL ----
  renderMonitorScore(
    '#gold-score-container',
    '#gold-score-value',
    d.gold.score,
    d.gold.signal,
    'STRONG_GOLD',
    'WEAK_GOLD',
    'amber',
    100 // stagger delay
  );

  renderSignalBadge(
    '#gold-signal-badge',
    d.gold.signal,
    { STRONG_GOLD: 'STRONG GOLD', WEAK_GOLD: 'WEAK GOLD', NEUTRAL: 'NEUTRAL' },
    { STRONG_GOLD: 'amber', WEAK_GOLD: 'red', NEUTRAL: 'neutral' }
  );

  const goldSignalWord = d.gold.signal === 'STRONG_GOLD' ? 'Strong' : d.gold.signal === 'WEAK_GOLD' ? 'Weak' : 'Neutral';
  $('#gold-regime-line').textContent = `${goldSignalWord} Gold — ${GOLD_REGIME_LABELS[d.gold.regime] || d.gold.regime.toLowerCase()}`;

  $('#gold-interpretation').textContent = d.gold.interpretation;

  // Gold sparkline
  if (d.gold.history && d.gold.history.length > 1) {
    const goldColor = getSparklineColor(d.gold.score, '#ffd600', '#ff1744');
    renderSparkline('gold-sparkline', d.gold.history, goldColor);
    $('#gold-sparkline-container .sparkline-label').textContent = formatSparklineLabel(d.gold.history);
    const goldSparkContainer = $('#gold-sparkline-container');
    setTimeout(() => {
      goldSparkContainer.classList.remove('opacity-0');
      goldSparkContainer.classList.add('opacity-100');
    }, 150);
  }

  // Gold data strip
  $('#val-gold').textContent = '$' + d.gold.inputs.gold.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  $('#val-gold-trend').textContent =
    d.gold.derived.gold_trend !== null ? formatSigned(d.gold.derived.gold_trend) + '%' : 'N/A';
  if (d.gold.derived.gold_trend !== null) colorize($('#val-gold-trend'), d.gold.derived.gold_trend);

  $('#val-breakeven-trend').textContent =
    d.gold.derived.breakeven_trend !== null ? formatSigned(d.gold.derived.breakeven_trend) + '%' : 'N/A';
  if (d.gold.derived.breakeven_trend !== null) colorize($('#val-breakeven-trend'), d.gold.derived.breakeven_trend);

  // ---- RELATIONSHIP BAR ----
  const bar = $('#relationship-bar');
  const macroLabel = MACRO_REGIME_LABELS[d.macro.regime] || d.macro.regime;
  $('#macro-regime-label').textContent = macroLabel;
  $('#macro-interpretation').textContent = d.macro.interpretation;

  // Fade in relationship bar last (200ms after gold panel)
  setTimeout(() => {
    bar.classList.remove('opacity-0', 'translate-y-3');
    bar.classList.add('opacity-100', 'translate-y-0');
  }, 300);

  // ---- CRUDE OIL EXPORTS ----
  if (d.crude_exports) {
    $('#val-crude-exports').textContent =
      (d.crude_exports.value / 1000).toFixed(1) + ' M b/d';

    const crudeTrendEl = $('#val-crude-trend');
    crudeTrendEl.textContent =
      d.crude_exports.trend !== null ? formatSigned(d.crude_exports.trend) + '%' : 'N/A';
    if (d.crude_exports.trend !== null) colorize(crudeTrendEl, d.crude_exports.trend);

    if (d.crude_exports.history && d.crude_exports.history.length > 1) {
      const currentYear = new Date().getFullYear().toString();
      const ytdHistory = d.crude_exports.history.filter((d) => d.date >= currentYear);
      const crudeData = ytdHistory.length > 1 ? ytdHistory : d.crude_exports.history;
      const crudeColor = d.crude_exports.trend >= 0 ? '#00e676' : '#ff1744';
      renderValueSparkline('crude-sparkline', crudeData, crudeColor);
      $('#crude-sparkline-container .sparkline-label').textContent = formatSparklineLabel(crudeData);
      const crudeSparkContainer = $('#crude-sparkline-container');
      setTimeout(() => {
        crudeSparkContainer.classList.remove('opacity-0');
        crudeSparkContainer.classList.add('opacity-100');
      }, 200);
    }
  }

  // ---- REAL YIELD CHART ----
  if (d.dollar.real_yield_history && d.dollar.real_yield_history.length > 1) {
    const currentYear = new Date().getFullYear().toString();
    const ryYtd = d.dollar.real_yield_history.filter((d) => d.date >= currentYear);
    const ryData = ryYtd.length > 1 ? ryYtd : d.dollar.real_yield_history;
    const ryLatest = ryData[ryData.length - 1].value;
    const ryColor = ryLatest >= 0 ? '#00e676' : '#ff1744';
    renderValueSparkline('realyield-sparkline', ryData, ryColor, (v) => v.toFixed(2) + '%');
    $('#realyield-sparkline-container .sparkline-label').textContent = formatSparklineLabel(ryData);
    const ryContainer = $('#realyield-sparkline-container');
    setTimeout(() => {
      ryContainer.classList.remove('opacity-0');
      ryContainer.classList.add('opacity-100');
    }, 250);
  }

  // ---- DXY CHART ----
  if (d.dollar.dxy_history && d.dollar.dxy_history.length > 1) {
    const currentYear = new Date().getFullYear().toString();
    const dxyYtd = d.dollar.dxy_history.filter((d) => d.date >= currentYear);
    const dxyData = dxyYtd.length > 1 ? dxyYtd : d.dollar.dxy_history;
    const dxyLatest = dxyData[dxyData.length - 1].value;
    const dxyFirst = dxyData[0].value;
    const dxyColor = dxyLatest >= dxyFirst ? '#00e676' : '#ff1744';
    renderValueSparkline('dxy-sparkline', dxyData, dxyColor, (v) => v.toFixed(1));
    $('#dxy-sparkline-container .sparkline-label').textContent = formatSparklineLabel(dxyData);
    const dxyContainer = $('#dxy-sparkline-container');
    setTimeout(() => {
      dxyContainer.classList.remove('opacity-0');
      dxyContainer.classList.add('opacity-100');
    }, 300);
  }

  // Date
  $('#data-date').textContent = 'Data from FRED + Yahoo Finance + EIA. Updated on business days with ~1 day lag.';

  // Updated at
  if (d.updated_at) {
    const ts = new Date(d.updated_at);
    $('#updated-at').textContent = `Updated ${ts.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
}

function renderMonitorScore(containerSel, valueSel, score, signal, strongKey, weakKey, strongColor, delayMs) {
  const scoreEl = $(valueSel);
  const scoreStr = (score >= 0 ? '+' : '') + score.toFixed(2);
  scoreEl.textContent = scoreStr;

  scoreEl.className = 'text-5xl md:text-7xl font-bold tracking-tight transition-colors duration-500';
  if (signal === strongKey) {
    scoreEl.classList.add(`text-${strongColor}`);
  } else if (signal === weakKey) {
    scoreEl.classList.add('text-red');
  } else {
    scoreEl.classList.add('text-neutral');
  }

  // Animate in with stagger
  const container = $(containerSel);
  setTimeout(() => {
    container.classList.remove('opacity-0', 'translate-y-4');
    container.classList.add('opacity-100', 'translate-y-0');
  }, delayMs);
}

function renderSignalBadge(sel, signal, labelMap, colorMap) {
  const el = $(sel);
  el.textContent = labelMap[signal] || signal;
  const color = colorMap[signal] || 'neutral';

  el.className =
    'inline-block px-4 py-1.5 rounded-full text-xs tracking-widest font-semibold uppercase transition-all duration-500';
  el.classList.add(`bg-${color}/15`, `text-${color}`, 'border', `border-${color}/30`);
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchData() {
  state.loading = true;
  state.error = null;

  // Reset animation states
  const usdContainer = $('#usd-score-container');
  const goldContainer = $('#gold-score-container');
  const bar = $('#relationship-bar');
  if (usdContainer) {
    usdContainer.classList.add('opacity-0', 'translate-y-4');
    usdContainer.classList.remove('opacity-100', 'translate-y-0');
  }
  if (goldContainer) {
    goldContainer.classList.add('opacity-0', 'translate-y-4');
    goldContainer.classList.remove('opacity-100', 'translate-y-0');
  }
  if (bar) {
    bar.classList.add('opacity-0', 'translate-y-3');
    bar.classList.remove('opacity-100', 'translate-y-0');
  }
  const usdSpark = $('#usd-sparkline-container');
  const goldSpark = $('#gold-sparkline-container');
  if (usdSpark) {
    usdSpark.classList.add('opacity-0');
    usdSpark.classList.remove('opacity-100');
  }
  if (goldSpark) {
    goldSpark.classList.add('opacity-0');
    goldSpark.classList.remove('opacity-100');
  }

  render();

  // Show spinner on refresh button
  const refreshBtn = $('#refresh-btn');
  const refreshIcon = $('#refresh-icon');
  refreshIcon.classList.add('animate-spin');
  refreshBtn.disabled = true;

  try {
    const res = await fetch(API_URL);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    state.data = data;
    state.error = null;
  } catch (err) {
    state.error = err.message || 'Failed to fetch data. Check your connection.';
  } finally {
    state.loading = false;
    refreshIcon.classList.remove('animate-spin');
    refreshBtn.disabled = false;
    render();
  }
}

// ---------------------------------------------------------------------------
// Methodology modal
// ---------------------------------------------------------------------------

function initModal() {
  const modal = $('#methodology-modal');
  const openBtn = $('#methodology-link');
  const closeBtn = $('#modal-close');
  const backdrop = $('#modal-backdrop');

  function openModal() {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    requestAnimationFrame(() => {
      backdrop.classList.remove('opacity-0');
      backdrop.classList.add('opacity-100');
      $('#modal-content').classList.remove('opacity-0', 'scale-95');
      $('#modal-content').classList.add('opacity-100', 'scale-100');
    });
  }

  function closeModal() {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    $('#modal-content').classList.remove('opacity-100', 'scale-100');
    $('#modal-content').classList.add('opacity-0', 'scale-95');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }, 200);
  }

  openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initModal();
  $('#refresh-btn').addEventListener('click', fetchData);
  fetchData();
});
