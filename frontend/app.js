/**
 * Dollar Monitor — Frontend
 */

const API_URL =
  window.DOLLAR_MONITOR_API_URL || 'https://dollar-monitor-api.paulo-r-l-andre.workers.dev/api/data';

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

  // Score
  const scoreEl = $('#score-value');
  const scoreNum = d.usd_score;
  const scoreStr = (scoreNum >= 0 ? '+' : '') + scoreNum.toFixed(2);
  scoreEl.textContent = scoreStr;

  // Score color
  scoreEl.className = 'text-6xl md:text-8xl font-bold tracking-tight transition-colors duration-500';
  if (d.signal === 'STRONG_USD') {
    scoreEl.classList.add('text-green');
  } else if (d.signal === 'WEAK_USD') {
    scoreEl.classList.add('text-red');
  } else {
    scoreEl.classList.add('text-neutral');
  }

  // Animate in
  const scoreContainer = $('#score-container');
  scoreContainer.classList.remove('opacity-0', 'translate-y-4');
  scoreContainer.classList.add('opacity-100', 'translate-y-0');

  // Signal badge
  const signalEl = $('#signal-badge');
  const signalLabels = {
    STRONG_USD: 'STRONG USD',
    WEAK_USD: 'WEAK USD',
    NEUTRAL: 'NEUTRAL',
  };
  signalEl.textContent = signalLabels[d.signal] || d.signal;
  signalEl.className =
    'inline-block px-4 py-1.5 rounded-full text-xs tracking-widest font-semibold uppercase transition-all duration-500';
  if (d.signal === 'STRONG_USD') {
    signalEl.classList.add('bg-green/15', 'text-green', 'border', 'border-green/30');
  } else if (d.signal === 'WEAK_USD') {
    signalEl.classList.add('bg-red/15', 'text-red', 'border', 'border-red/30');
  } else {
    signalEl.classList.add('bg-neutral/15', 'text-neutral', 'border', 'border-neutral/30');
  }

  // Regime badge
  const regimeEl = $('#regime-badge');
  regimeEl.textContent = d.regime;

  // Interpretation
  $('#interpretation').textContent = d.interpretation;

  // Data strip — inputs
  $('#val-dxy').textContent = d.inputs.dxy.toFixed(2);
  $('#val-10y').textContent = d.inputs.us10y_yield.toFixed(2) + '%';
  $('#val-breakeven').textContent = d.inputs.breakeven.toFixed(2) + '%';
  $('#val-spx').textContent = d.inputs.spx.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Data strip — derived
  $('#val-real-yield').textContent = formatSigned(d.derived.real_yield) + '%';
  colorize($('#val-real-yield'), d.derived.real_yield);

  $('#val-dxy-trend').textContent =
    d.derived.dxy_trend !== null ? formatSigned(d.derived.dxy_trend) + '%' : 'N/A';
  if (d.derived.dxy_trend !== null) colorize($('#val-dxy-trend'), d.derived.dxy_trend);

  $('#val-spx-trend').textContent =
    d.derived.spx_trend !== null ? formatSigned(d.derived.spx_trend) + '%' : 'N/A';
  if (d.derived.spx_trend !== null) colorize($('#val-spx-trend'), d.derived.spx_trend);

  // Date — make it clear this is delayed data
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

function formatSigned(n) {
  if (n === null || n === undefined) return 'N/A';
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function colorize(el, value) {
  el.classList.remove('text-green', 'text-red', 'text-neutral');
  if (value > 0) el.classList.add('text-green');
  else if (value < 0) el.classList.add('text-red');
  else el.classList.add('text-neutral');
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchData() {
  state.loading = true;
  state.error = null;
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
