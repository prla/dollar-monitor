/**
 * Macro Monitor — Cloudflare Worker
 *
 * Fetches macro data from FRED, computes derived values,
 * scores USD and Gold, classifies regimes, determines cross-monitor
 * macro regime, and calls Claude for interpretations.
 */

const FRED_SERIES = {
  dxy: 'DTWEXBGS',
  us10y: 'DGS10',
  breakeven: 'T10YIE',
  spx: 'SP500',
};

// We need ~120 trading days for MA100 + buffer
const OBSERVATION_COUNT = 150;

// ---------------------------------------------------------------------------
// FRED helpers
// ---------------------------------------------------------------------------

async function fetchFredSeries(seriesId, apiKey) {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', String(OBSERVATION_COUNT));

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'MacroMonitor/1.0' },
  });

  if (!res.ok) {
    throw new Error(`FRED fetch failed for ${seriesId}: ${res.status}`);
  }

  const data = await res.json();
  // Filter out missing values (".") and parse
  return data.observations
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .reverse(); // oldest first
}

// ---------------------------------------------------------------------------
// Yahoo Finance gold price fetch
// ---------------------------------------------------------------------------

async function fetchGoldSeries() {
  // Fetch ~200 days of daily gold prices from Yahoo Finance
  const now = Math.floor(Date.now() / 1000);
  const from = now - 200 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?period1=${from}&period2=${now}&interval=1d`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'MacroMonitor/1.0' },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance gold fetch failed: ${res.status}`);
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error('No gold data returned from Yahoo Finance');

  const timestamps = result.timestamp;
  const closes = result.indicators?.quote?.[0]?.close;
  if (!timestamps || !closes) throw new Error('Invalid gold data structure');

  const series = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      const d = new Date(timestamps[i] * 1000);
      const dateStr = d.toISOString().split('T')[0];
      series.push({ date: dateStr, value: closes[i] });
    }
  }
  return series;
}

// ---------------------------------------------------------------------------
// EIA crude oil exports fetch
// ---------------------------------------------------------------------------

async function fetchCrudeExports() {
  const url = new URL('https://api.eia.gov/v2/petroleum/sum/sndw/data/');
  url.searchParams.set('api_key', 'DEMO_KEY');
  url.searchParams.set('frequency', 'weekly');
  url.searchParams.set('data[0]', 'value');
  url.searchParams.set('facets[series][]', 'WCREXUS2');
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', String(OBSERVATION_COUNT));

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'MacroMonitor/1.0' },
  });

  if (!res.ok) {
    throw new Error(`EIA fetch failed for WCREXUS2: ${res.status}`);
  }

  const data = await res.json();
  const rows = data.response?.data;
  if (!rows || rows.length === 0) throw new Error('No crude export data from EIA');

  return rows
    .filter((r) => r.value != null)
    .map((r) => ({ date: r.period, value: parseFloat(r.value) }))
    .reverse(); // oldest first
}

// ---------------------------------------------------------------------------
// Computation helpers
// ---------------------------------------------------------------------------

function movingAverage(values, window) {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((s, v) => s + v, 0) / window;
}

function trendSignal(values) {
  const ma20 = movingAverage(values, 20);
  const ma100 = movingAverage(values, 100);
  if (ma20 === null || ma100 === null || ma100 === 0) return null;
  return ((ma20 - ma100) / ma100) * 100;
}

function momentumSignal(values) {
  const ma5 = movingAverage(values, 5);
  const ma20 = movingAverage(values, 20);
  if (ma5 === null || ma20 === null || ma20 === 0) return null;
  return ((ma5 - ma20) / ma20) * 100;
}

// Blended trend: captures both medium-term trajectory and recent direction.
// Without momentum, a sharp reversal (e.g. gold -20% in a week) doesn't
// flip the MA20/MA100 trend fast enough and the score reads "strong" while
// the asset is in free fall.
function blendedTrend(values) {
  const trend = trendSignal(values);
  const momentum = momentumSignal(values);
  if (trend === null && momentum === null) return null;
  if (trend === null) return momentum;
  if (momentum === null) return trend;
  return 0.4 * trend + 0.6 * momentum;
}

function zScore(value, values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (value - mean) / std;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Rolling score history
// ---------------------------------------------------------------------------

function computeScoreHistory(dxySeries, us10ySeries, breakevenSeries, spxSeries, goldSeries) {
  const dxyValues = dxySeries.map((d) => d.value);
  const us10yValues = us10ySeries.map((d) => d.value);
  const breakevenValues = breakevenSeries.map((d) => d.value);
  const spxValues = spxSeries.map((d) => d.value);
  const goldValues = goldSeries.map((d) => d.value);

  // Build aligned real-yield series
  const minLen = Math.min(us10yValues.length, breakevenValues.length);
  const realYieldAll = [];
  for (let i = 0; i < minLen; i++) {
    const yIdx = us10yValues.length - minLen + i;
    const bIdx = breakevenValues.length - minLen + i;
    realYieldAll.push(us10yValues[yIdx] - breakevenValues[bIdx]);
  }

  // We need at least 100 data points for MA100; start from index 100
  const startIdx = 100;
  const usdHistory = [];
  const goldHistory = [];

  // Use the shortest series length as the iteration bound
  const maxLen = Math.min(
    dxyValues.length,
    spxValues.length,
    realYieldAll.length,
    goldValues.length,
    breakevenValues.length
  );

  for (let i = startIdx; i < maxLen; i++) {
    // Slice up to and including index i
    const dxySlice = dxyValues.slice(0, i + 1);
    const spxSlice = spxValues.slice(0, i + 1);
    const goldSlice = goldValues.slice(0, i + 1);
    const breakevenSlice = breakevenValues.slice(0, i + 1);

    // Real yield slice — align to the same end index
    const ryOffset = realYieldAll.length - maxLen;
    const rySlice = realYieldAll.slice(0, ryOffset + i + 1);

    // Compute trends
    const dxyT = trendSignal(dxySlice);
    const spxT = trendSignal(spxSlice);
    const ryT = trendSignal(rySlice);
    const goldT = blendedTrend(goldSlice);
    const beT = trendSignal(breakevenSlice);

    // Normalize
    const nDxy = dxyT !== null ? clamp(dxyT / 5, -1, 1) : 0;
    const nSpx = spxT !== null ? clamp(spxT / 5, -1, 1) : 0;
    const nGold = goldT !== null ? clamp(goldT / 5, -1, 1) : 0;
    const nBe = beT !== null ? clamp(beT / 5, -1, 1) : 0;
    const nRyT = ryT !== null ? clamp(ryT / 5, -1, 1) : 0;

    // USD score
    const usd = 0.4 * nDxy + 0.3 * nRyT + 0.2 * -nGold + 0.1 * -nSpx;

    // Gold score
    const gld = 0.4 * nGold + 0.3 * -nRyT + 0.2 * nBe + 0.1 * -nDxy;

    // Use dxy series date (aligned to the same index)
    const date = dxySeries[i]?.date || '';

    usdHistory.push({ date, score: round(usd, 3) });
    goldHistory.push({ date, score: round(gld, 3) });
  }

  return { usdHistory, goldHistory };
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

function computeAll(dxySeries, us10ySeries, breakevenSeries, spxSeries, goldSeries) {
  const dxyValues = dxySeries.map((d) => d.value);
  const us10yValues = us10ySeries.map((d) => d.value);
  const breakevenValues = breakevenSeries.map((d) => d.value);
  const spxValues = spxSeries.map((d) => d.value);
  const goldValues = goldSeries.map((d) => d.value);

  // Latest raw values
  const dxy = dxyValues[dxyValues.length - 1];
  const us10y = us10yValues[us10yValues.length - 1];
  const breakeven = breakevenValues[breakevenValues.length - 1];
  const spx = spxValues[spxValues.length - 1];
  const gold = goldValues[goldValues.length - 1];

  // Derived series
  const realYield = us10y - breakeven;
  const minLen = Math.min(us10yValues.length, breakevenValues.length);
  const realYieldSeries = [];
  for (let i = 0; i < minLen; i++) {
    const yIdx = us10yValues.length - minLen + i;
    const bIdx = breakevenValues.length - minLen + i;
    realYieldSeries.push(us10yValues[yIdx] - breakevenValues[bIdx]);
  }

  // Trend signals
  const dxyTrend = trendSignal(dxyValues);
  const spxTrend = trendSignal(spxValues);
  const realYieldTrend = trendSignal(realYieldSeries);
  const goldTrend = blendedTrend(goldValues);
  const breakevenTrend = trendSignal(breakevenValues);

  // Normalizations — clamp trend to [-5,5] → [-1,1]
  const normDxyTrend = dxyTrend !== null ? clamp(dxyTrend / 5, -1, 1) : 0;
  const normSpxTrend = spxTrend !== null ? clamp(spxTrend / 5, -1, 1) : 0;
  const normGoldTrend = goldTrend !== null ? clamp(goldTrend / 5, -1, 1) : 0;
  const normBreakevenTrend = breakevenTrend !== null ? clamp(breakevenTrend / 5, -1, 1) : 0;
  const normRealYieldTrend = realYieldTrend !== null ? clamp(realYieldTrend / 5, -1, 1) : 0;

  // ---- USD Score ----
  // 0.4 * norm(DXY_TREND) + 0.3 * norm(REAL_YIELD_TREND) + 0.2 * norm(-GOLD_TREND) + 0.1 * norm(-SPX_TREND)
  const usdScore =
    0.4 * normDxyTrend +
    0.3 * normRealYieldTrend +
    0.2 * -normGoldTrend +
    0.1 * -normSpxTrend;

  let usdSignal;
  if (usdScore > 0.2) usdSignal = 'STRONG_USD';
  else if (usdScore < -0.2) usdSignal = 'WEAK_USD';
  else usdSignal = 'NEUTRAL';

  // ---- USD Regime ----
  const dxyUp = dxyTrend !== null && dxyTrend > 0;
  const dxyDown = dxyTrend !== null && dxyTrend < 0;
  const realYieldRising = realYieldTrend !== null && realYieldTrend > 0;
  const realYieldFalling = realYieldTrend !== null && realYieldTrend < 0;
  const spxFalling = spxTrend !== null && spxTrend < 0;
  const goldUp = goldTrend !== null && goldTrend > 0;

  let usdRegime;
  if (dxyUp && realYieldRising) {
    usdRegime = 'USD_STRENGTH_REAL_RATES';
  } else if (dxyUp && spxFalling) {
    usdRegime = 'USD_STRENGTH_RISK_OFF';
  } else if (dxyDown && realYieldFalling) {
    usdRegime = 'USD_WEAKNESS_FALLING_REAL_RATES';
  } else if (dxyDown && goldUp) {
    usdRegime = 'USD_WEAKNESS_HARD_ASSETS';
  } else {
    usdRegime = 'MIXED';
  }

  // ---- Gold Score ----
  // 0.4 * norm(GOLD_TREND) + 0.3 * norm(-REAL_YIELD_TREND) + 0.2 * norm(BREAKEVEN_TREND) + 0.1 * norm(-DXY_TREND)
  const goldScore =
    0.4 * normGoldTrend +
    0.3 * -normRealYieldTrend +
    0.2 * normBreakevenTrend +
    0.1 * -normDxyTrend;

  let goldSignal;
  if (goldScore > 0.2) goldSignal = 'STRONG_GOLD';
  else if (goldScore < -0.2) goldSignal = 'WEAK_GOLD';
  else goldSignal = 'NEUTRAL';

  // ---- Gold Regime ----
  const goldDown = goldTrend !== null && goldTrend < 0;
  const breakevenUp = breakevenTrend !== null && breakevenTrend > 0;

  let goldRegime;
  if (goldUp && realYieldFalling) {
    goldRegime = 'GOLD_STRENGTH_REAL_RATES';
  } else if (goldUp && breakevenUp) {
    goldRegime = 'GOLD_STRENGTH_INFLATION';
  } else if (goldUp && spxFalling && dxyDown) {
    goldRegime = 'GOLD_STRENGTH_RISK_OFF';
  } else if (goldDown && realYieldRising) {
    goldRegime = 'GOLD_WEAKNESS_RISING_REAL_RATES';
  } else if (goldDown && dxyUp) {
    goldRegime = 'GOLD_WEAKNESS_STRONG_DOLLAR';
  } else {
    goldRegime = 'MIXED';
  }

  // ---- Cross-Monitor Macro Regime ----
  const usdStrong = usdSignal === 'STRONG_USD';
  const usdWeak = usdSignal === 'WEAK_USD';
  const usdNeutral = usdSignal === 'NEUTRAL';
  const goldStrong = goldSignal === 'STRONG_GOLD';
  const goldWeak = goldSignal === 'WEAK_GOLD';
  const goldNeutral = goldSignal === 'NEUTRAL';

  let macroRegime;
  if (usdStrong && goldWeak) macroRegime = 'TIGHTENING';
  else if (usdWeak && goldStrong) macroRegime = 'REFLATION_OR_STAGFLATION';
  else if (usdStrong && goldStrong) macroRegime = 'STRESS_SAFE_HAVEN';
  else if (usdWeak && goldWeak) macroRegime = 'DISINFLATIONARY_RISK_ON';
  else if (usdNeutral && goldStrong) macroRegime = 'GOLD_SPECIFIC_DRIVER';
  else if (usdStrong && goldNeutral) macroRegime = 'USD_TECHNICAL_MOVE';
  else macroRegime = 'MIXED';

  // Dates — use the most recent across all series
  const allDates = [dxySeries, us10ySeries, breakevenSeries, spxSeries, goldSeries]
    .map((s) => s[s.length - 1]?.date)
    .filter(Boolean);
  const latestDate = allDates.sort().pop();

  return {
    date: latestDate,
    dollar: {
      score: round(usdScore, 2),
      signal: usdSignal,
      regime: usdRegime,
      inputs: {
        dxy: round(dxy, 2),
        us10y_yield: round(us10y, 2),
        breakeven: round(breakeven, 2),
        spx: round(spx, 2),
      },
      derived: {
        real_yield: round(realYield, 2),
        dxy_trend: dxyTrend !== null ? round(dxyTrend, 2) : null,
        spx_trend: spxTrend !== null ? round(spxTrend, 2) : null,
        real_yield_trend: realYieldTrend !== null ? round(realYieldTrend, 2) : null,
      },
    },
    gold: {
      score: round(goldScore, 2),
      signal: goldSignal,
      regime: goldRegime,
      inputs: {
        gold: round(gold, 2),
      },
      derived: {
        gold_trend: goldTrend !== null ? round(goldTrend, 2) : null,
        breakeven_trend: breakevenTrend !== null ? round(breakevenTrend, 2) : null,
      },
    },
    macro: {
      regime: macroRegime,
    },
  };
}

// ---------------------------------------------------------------------------
// Claude interpretation — single call, three interpretations
// ---------------------------------------------------------------------------

async function getInterpretations(data, apiKey) {
  const prompt = `You explain macro data the way a sharp friend would over coffee — plain English, no jargon, no Bloomberg-speak. Given the following data, produce exactly THREE interpretations. Each must be ONE sentence, hard limit 20 words. Say what's actually happening and why it matters. Use numbers but don't hide behind them. Never use words like "amid", "amid uncertainty", "headwinds", "tailwinds", or "contradictory". Just say it plainly.

Data:
- DXY (Trade-Weighted USD): ${data.dollar.inputs.dxy}
- 10Y Treasury Yield: ${data.dollar.inputs.us10y_yield}%
- 10Y Breakeven Inflation: ${data.dollar.inputs.breakeven}%
- S&P 500: ${data.dollar.inputs.spx}
- Real Yield (10Y - Breakeven): ${data.dollar.derived.real_yield}%
- DXY Trend (MA20-MA100): ${data.dollar.derived.dxy_trend !== null ? data.dollar.derived.dxy_trend + '%' : 'N/A'}
- SPX Trend (MA20-MA100): ${data.dollar.derived.spx_trend !== null ? data.dollar.derived.spx_trend + '%' : 'N/A'}
- Real Yield Trend: ${data.dollar.derived.real_yield_trend !== null ? data.dollar.derived.real_yield_trend + '%' : 'N/A'}
- Gold Spot: ${data.gold.inputs.gold}
- Gold Trend (blended momentum+trend): ${data.gold.derived.gold_trend !== null ? data.gold.derived.gold_trend + '%' : 'N/A'}
- Breakeven Trend: ${data.gold.derived.breakeven_trend !== null ? data.gold.derived.breakeven_trend + '%' : 'N/A'}
- US Crude Oil Exports: ${data.crude_exports ? data.crude_exports.value + ' thousand barrels/day' : 'N/A'}
- Crude Exports Trend: ${data.crude_exports?.trend !== null ? data.crude_exports.trend + '%' : 'N/A'}
- USD Score: ${data.dollar.score} (Signal: ${data.dollar.signal}, Regime: ${data.dollar.regime})
- Gold Score: ${data.gold.score} (Signal: ${data.gold.signal}, Regime: ${data.gold.regime})
- Macro Regime: ${data.macro.regime}

Respond in exactly this format (three lines, no labels, no bullets):
[USD interpretation sentence]
[Gold interpretation sentence]
[Combined macro regime interpretation sentence]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Claude API error:', res.status, body);
      return { usd: null, gold: null, macro: null };
    }

    const result = await res.json();
    const text = result.content?.[0]?.text?.trim() || '';
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    return {
      usd: lines[0] || null,
      gold: lines[1] || null,
      macro: lines[2] || null,
    };
  } catch (err) {
    console.error('Claude API call failed:', err);
    return { usd: null, gold: null, macro: null };
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/data') {
      try {
        const fredKey = env.FRED_API_KEY;
        if (!fredKey) {
          return jsonResponse(
            { error: 'FRED_API_KEY not configured' },
            500,
            corsHeaders
          );
        }

        // Fetch all series in parallel
        const [dxySeries, us10ySeries, breakevenSeries, spxSeries, goldSeries, crudeExportsSeries] =
          await Promise.all([
            fetchFredSeries(FRED_SERIES.dxy, fredKey),
            fetchFredSeries(FRED_SERIES.us10y, fredKey),
            fetchFredSeries(FRED_SERIES.breakeven, fredKey),
            fetchFredSeries(FRED_SERIES.spx, fredKey),
            fetchGoldSeries(),
            fetchCrudeExports(),
          ]);

        // Compute everything
        const data = computeAll(
          dxySeries,
          us10ySeries,
          breakevenSeries,
          spxSeries,
          goldSeries
        );

        // Crude oil exports tracker — MA4 vs MA13 (1 month vs 1 quarter)
        const crudeValues = crudeExportsSeries.map((d) => d.value);
        const crudeLatest = crudeValues[crudeValues.length - 1];
        const crudeMA4 = movingAverage(crudeValues, 4);
        const crudeMA13 = movingAverage(crudeValues, 13);
        const crudeTrend = crudeMA4 !== null && crudeMA13 !== null && crudeMA13 !== 0
          ? ((crudeMA4 - crudeMA13) / crudeMA13) * 100
          : null;
        data.crude_exports = {
          value: round(crudeLatest, 0),
          trend: crudeTrend !== null ? round(crudeTrend, 2) : null,
          date: crudeExportsSeries[crudeExportsSeries.length - 1]?.date || null,
          history: crudeExportsSeries.map((d) => ({ date: d.date, value: round(d.value, 0) })),
        };

        // DXY and real yield time series for charts
        data.dollar.dxy_history = dxySeries.map((d) => ({ date: d.date, value: round(d.value, 2) }));

        const minLen = Math.min(us10ySeries.length, breakevenSeries.length);
        data.dollar.real_yield_history = [];
        for (let i = 0; i < minLen; i++) {
          const yIdx = us10ySeries.length - minLen + i;
          const bIdx = breakevenSeries.length - minLen + i;
          data.dollar.real_yield_history.push({
            date: us10ySeries[yIdx].date,
            value: round(us10ySeries[yIdx].value - breakevenSeries[bIdx].value, 2),
          });
        }

        // Compute rolling score history
        const { usdHistory, goldHistory } = computeScoreHistory(
          dxySeries,
          us10ySeries,
          breakevenSeries,
          spxSeries,
          goldSeries
        );
        data.dollar.history = usdHistory;
        data.gold.history = goldHistory;

        // Get Claude interpretations
        const anthropicKey = env.ANTHROPIC_API_KEY;
        let interpretations = { usd: null, gold: null, macro: null };
        if (anthropicKey) {
          interpretations = await getInterpretations(data, anthropicKey);
        }

        const fallback = 'Interpretation unavailable — check API key.';
        data.dollar.interpretation = interpretations.usd || fallback;
        data.gold.interpretation = interpretations.gold || fallback;
        data.macro.interpretation = interpretations.macro || fallback;
        data.updated_at = new Date().toISOString();

        return jsonResponse(data, 200, corsHeaders);
      } catch (err) {
        console.error('Worker error:', err);
        return jsonResponse(
          {
            error: 'Failed to fetch data',
            message: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // Health check
    if (url.pathname === '/api/health') {
      return jsonResponse({ status: 'ok' }, 200, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  },
};

function jsonResponse(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
