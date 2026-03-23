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
  USD_STRENGTH_REAL_RATES: 'real rates',
  USD_STRENGTH_RISK_OFF: 'risk-off',
  USD_WEAKNESS_FALLING_REAL_RATES: 'falling real rates',
  USD_WEAKNESS_HARD_ASSETS: 'hard assets',
  MIXED: 'mixed',
};

const GOLD_REGIME_LABELS = {
  GOLD_STRENGTH_REAL_RATES: 'falling real rates',
  GOLD_STRENGTH_INFLATION: 'inflation',
  GOLD_STRENGTH_RISK_OFF: 'risk-off',
  GOLD_WEAKNESS_RISING_REAL_RATES: 'rising real rates',
  GOLD_WEAKNESS_STRONG_DOLLAR: 'strong dollar',
  MIXED: 'mixed',
};

const MACRO_REGIME_LABELS = {
  RISK_ON_RATES_RISING: 'Risk On / Rates Rising',
  REFLATION_OR_STAGFLATION: 'Reflation / Stagflation',
  STRESS_SAFE_HAVEN: 'Stress / Safe Haven',
  DISINFLATIONARY_RISK_ON: 'Disinflationary Risk On',
  GOLD_SPECIFIC_DRIVER: 'Gold-Specific Driver',
  USD_TECHNICAL_MOVE: 'USD Technical Move',
  MIXED: 'Mixed',
};

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

  // Date
  $('#data-date').textContent = d.date ? `FRED data as of ${d.date} (one business day lag)` : '';

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
