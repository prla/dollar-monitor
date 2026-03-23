/**
 * Dollar Monitor — Cloudflare Worker
 *
 * Fetches macro data from FRED, computes derived values,
 * scores the USD, classifies the regime, and calls Claude
 * for a one-sentence interpretation.
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
    headers: { 'User-Agent': 'DollarMonitor/1.0' },
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

function zScore(value, values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (value - mean) / std;
}

function computeDerived(dxySeries, us10ySeries, breakevenSeries, spxSeries) {
  const dxyValues = dxySeries.map((d) => d.value);
  const us10yValues = us10ySeries.map((d) => d.value);
  const breakevenValues = breakevenSeries.map((d) => d.value);
  const spxValues = spxSeries.map((d) => d.value);

  // Latest raw values
  const dxy = dxyValues[dxyValues.length - 1];
  const us10y = us10yValues[us10yValues.length - 1];
  const breakeven = breakevenValues[breakevenValues.length - 1];
  const spx = spxValues[spxValues.length - 1];

  // Derived
  const realYield = us10y - breakeven;

  // Real yield series for trend
  const minLen = Math.min(us10yValues.length, breakevenValues.length);
  const realYieldSeries = [];
  for (let i = 0; i < minLen; i++) {
    const yIdx = us10yValues.length - minLen + i;
    const bIdx = breakevenValues.length - minLen + i;
    realYieldSeries.push(us10yValues[yIdx] - breakevenValues[bIdx]);
  }

  const dxyTrend = trendSignal(dxyValues);
  const spxTrend = trendSignal(spxValues);
  const realYieldTrend = trendSignal(realYieldSeries);

  // Z-scores for USD score computation
  const realYieldZ = zScore(realYield, realYieldSeries);
  const dxyTrendZ = dxyTrend !== null ? zScore(dxyTrend, [dxyTrend]) : 0;
  const spxTrendZ = spxTrend !== null ? zScore(spxTrend, [spxTrend]) : 0;

  // For z-scoring the trend values, we use a simpler normalization:
  // clamp the trend percentage to [-5, 5] and normalize to [-1, 1]
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const normDxyTrend = dxyTrend !== null ? clamp(dxyTrend / 5, -1, 1) : 0;
  const normSpxTrend = spxTrend !== null ? clamp(spxTrend / 5, -1, 1) : 0;
  const normRealYield = clamp(realYieldZ, -2, 2) / 2; // normalize z-score to [-1, 1]

  // USD score: weighted sum
  // real yield (40%), DXY trend (30%), inverted SPX trend (30%)
  const usdScore =
    normRealYield * 0.4 + normDxyTrend * 0.3 + -normSpxTrend * 0.3;

  // Signal
  let signal;
  if (usdScore > 0.2) signal = 'STRONG_USD';
  else if (usdScore < -0.2) signal = 'WEAK_USD';
  else signal = 'NEUTRAL';

  // Regime classification
  const realYieldRising = realYieldTrend !== null && realYieldTrend > 0;
  const realYieldFalling = realYieldTrend !== null && realYieldTrend < 0;
  const realYieldHigh = realYield > 1.5;
  const spxFalling = spxTrend !== null && spxTrend < 0;
  const spxRising = spxTrend !== null && spxTrend > 0;
  const breakevenRising =
    breakevenValues.length >= 20 &&
    breakevenValues[breakevenValues.length - 1] >
      breakevenValues[breakevenValues.length - 20];
  const dxyUp = dxyTrend !== null && dxyTrend > 0;

  let regime;
  if (realYieldRising && spxFalling && breakevenRising) {
    regime = 'STAGFLATION WATCH';
  } else if (realYieldRising && spxFalling) {
    regime = 'RISK-OFF DOLLAR RALLY';
  } else if ((realYieldHigh || realYieldRising) && dxyUp) {
    regime = 'YIELD-DRIVEN STRENGTH';
  } else if (realYieldFalling && spxRising) {
    regime = 'RISK-ON WEAKNESS';
  } else {
    regime = 'NEUTRAL / MIXED';
  }

  // Dates
  const latestDate =
    dxySeries[dxySeries.length - 1]?.date ||
    us10ySeries[us10ySeries.length - 1]?.date;

  return {
    date: latestDate,
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
    },
    usd_score: round(usdScore, 2),
    signal,
    regime,
  };
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Claude interpretation
// ---------------------------------------------------------------------------

async function getInterpretation(data, apiKey) {
  const prompt = `You are a concise macro analyst. Given the following USD data, write exactly ONE sentence. Hard limit: 25 words maximum. Explain what is driving the dollar right now. Reference 1-2 key numbers. No hedging, no preamble, no qualifiers.

Data:
- DXY (Trade-Weighted USD): ${data.inputs.dxy}
- 10Y Treasury Yield: ${data.inputs.us10y_yield}%
- 10Y Breakeven Inflation: ${data.inputs.breakeven}%
- S&P 500: ${data.inputs.spx}
- Real Yield (10Y - Breakeven): ${data.derived.real_yield}%
- DXY Trend (MA20-MA100): ${data.derived.dxy_trend !== null ? data.derived.dxy_trend + '%' : 'N/A'}
- SPX Trend (MA20-MA100): ${data.derived.spx_trend !== null ? data.derived.spx_trend + '%' : 'N/A'}
- USD Score: ${data.usd_score}
- Signal: ${data.signal}
- Regime: ${data.regime}

One sentence:`;

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
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Claude API error:', res.status, body);
      return null;
    }

    const result = await res.json();
    return result.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('Claude API call failed:', err);
    return null;
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
        const [dxySeries, us10ySeries, breakevenSeries, spxSeries] =
          await Promise.all([
            fetchFredSeries(FRED_SERIES.dxy, fredKey),
            fetchFredSeries(FRED_SERIES.us10y, fredKey),
            fetchFredSeries(FRED_SERIES.breakeven, fredKey),
            fetchFredSeries(FRED_SERIES.spx, fredKey),
          ]);

        // Compute everything
        const data = computeDerived(
          dxySeries,
          us10ySeries,
          breakevenSeries,
          spxSeries
        );

        // Get Claude interpretation
        const anthropicKey = env.ANTHROPIC_API_KEY;
        let interpretation = null;
        if (anthropicKey) {
          interpretation = await getInterpretation(data, anthropicKey);
        }

        const response = {
          ...data,
          interpretation:
            interpretation || 'Interpretation unavailable — check API key.',
          updated_at: new Date().toISOString(),
        };

        return jsonResponse(response, 200, corsHeaders);
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
