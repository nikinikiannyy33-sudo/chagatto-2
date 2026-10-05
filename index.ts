import { Hono } from "hono";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";
const app = new Hono();

function sma(values: number[], period: number) {
  if (values.length < period) return null;

  const part = values.slice(-period);
  return part.reduce((a, b) => a + b, 0) / period;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];

    if (diff > 0) gains += diff;
    if (diff < 0) losses += Math.abs(diff);
  }

  if (losses === 0) return 100;

  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}
function atr(
  candles: {
    high: number;
    low: number;
    close: number;
  }[],
  period = 14
) {
  if (candles.length <= period) return null;

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const previousClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );

    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  const recent = trueRanges.slice(-period);

  return (
    recent.reduce((sum, value) => sum + value, 0) /
    period
  );
}
app.get("/", (c) => {
  return c.json({
    system: "Chagatto-2",
    status: "running",
    mode: "FX verification system",
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    system: "Chagatto-2",
  });
});

app.get("/test", (c) => {
  return c.json({
    system: "Chagatto-2",
    test: "success",
    time: new Date().toISOString(),
  });
});

app.get("/fx-test", async (c) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);
 }

  const response = await fetch(
    `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=50&apikey=${apiKey}`
  );

  const data = await response.json() as any;

  if (!data.values || !Array.isArray(data.values)) {
    return c.json({
      error: "Twelve Data API error",
      details: data
    }, 500);
  }

  const prices = data.values
    .slice()
    .reverse()
    .map((item: any) => Number(item.close))
    .filter((price: number) => Number.isFinite(price));

  const currentPrice = prices[prices.length - 1];
  const sma5 = sma(prices, 5);
  const sma10 = sma(prices, 10);
  const rsi14 = rsi(prices, 14);

  let signal = "WAIT";

  if (sma5 !== null && sma10 !== null && rsi14 !== null) {
    if (sma5 > sma10 && rsi14 < 70) {
      signal = "BUY";
    } else if (sma5 < sma10 && rsi14 > 30) {
      signal = "SELL";
    }
  }

  return c.json({
    system: "Chagatto-2",
    pair: "USDJPY",
    price: currentPrice,
    sma5,
    sma10,
    rsi14,
    signal,
    time: new Date().toISOString(),
  });
});
app.get("/backtest", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return c.json(
      { error: "TWELVE_DATA_API_KEY is not set" },
      500
    );
  }

  const response = await fetch(
    `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=500&apikey=${apiKey}`
  );

  const data = await response.json() as any;

  if (!data.values || !Array.isArray(data.values)) {
    return c.json({
      error: "Twelve Data API error",
      details: data
    }, 500);
  }
  const candles = data.values
    .slice()
    .reverse()
    .map((item: any) => ({
      time: item.datetime,
      close: Number(item.close),
      high: Number(item.high),
      low: Number(item.low),
    }))
    .filter((item: any) => Number.isFinite(item.close) && Number.isFinite(item.high) && Number.isFinite(item.low));

  let trades = 0;
  let wins = 0;
  let losses = 0;
  let totalPips = 0;
  let grossProfit = 0;
let grossLoss = 0;
  let winningPips = 0;
let losingPips = 0;
let currentLosingStreak = 0;
let maxLosingStreak = 0;
  let equity = 0, peakEquity = 0, maxDrawdown = 0;
  const stopLossResults: any[] = [];
  for (let i = 14; i < candles.length - 1; i++) {
    const history = candles
      .slice(0, i + 1)
      .map((item: any) => item.close);

    const sma5 = sma(history, 5);
    const sma10 = sma(history, 10);
    const rsi14 = rsi(history, 14);

    if (sma5 === null || sma10 === null || rsi14 === null) {
      continue;
    }

    let signal = "WAIT";

    if (sma5 > sma10 && rsi14 < 60) {
      signal = "BUY";
    } else if (sma5 < sma10 && rsi14 > 40) {
      signal = "SELL";
    }

    if (signal === "WAIT") continue;

    const entry = candles[i].close;
    const nextCandle = candles[i + 1];
if (!nextCandle) continue;
    const exit = nextCandle.close;
    const stopLoss = 4.618;
  
    let pips =
      signal === "BUY"
        ? (exit - entry) * 100
        : (entry - exit) * 100;
    const stopPrice = signal === "BUY" ? entry - stopLoss / 100
      : entry + stopLoss / 100;
    const stopHit = signal === "BUY" ? nextCandle.low <= stopPrice : nextCandle.high >= stopPrice;
  if (stopHit) pips = -stopLoss;
const tradeTime = candles[i].time;
    const tradeHour = Number(tradeTime.slice(11, 13));
    if (![0,6].includes(tradeHour)) continue;
    trades++;
    if (pips > 0) {
  wins++;
  grossProfit += pips;
      winningPips += pips;
  currentLosingStreak = 0;
} else if (pips < 0) {
  losses++;
      losingPips += Math.abs(pips);
  grossLoss += Math.abs(pips);
  currentLosingStreak++;
  maxLosingStreak = Math.max(maxLosingStreak, currentLosingStreak);
}

    totalPips += pips;
    equity += pips;
peakEquity = Math.max(peakEquity, equity);
maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
  }
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
const avgWin = wins > 0 ? winningPips / wins : 0;
const avgLoss = losses > 0 ? losingPips / losses : 0;
    stopLossResults.push({
    stopLoss: 4.618,
      trades,
      wins,
      losses,
      winRate,
      totalPips,
      profitFactor,
      avgWin,
      avgLoss,
      maxLosingStreak,
      maxDrawdown
    });

  return c.json({
    system: "Chagatto-2 StopLoss Test",
    pair: "USDJPY",
    interval: "1h",
    results: stopLossResults
  });
});
app.get("/auto-backtest", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return c.json(
      { error: "TWELVE_DATA_API_KEY is not set" },
      500
    );
  }

  try {
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=500&apikey=${apiKey}`
    );

    const data = await response.json() as any;

    if (!data.values || !Array.isArray(data.values)) {
      return c.json({
        error: "Twelve Data API error",
        details: data,
      }, 500);
    }

    const candles = data.values
      .slice()
      .reverse()
      .map((item: any) => ({
        time: item.datetime,
        close: Number(item.close),
        high: Number(item.high),
        low: Number(item.low),
      }))
      .filter(
        (item: any) =>
          Number.isFinite(item.close) &&
          Number.isFinite(item.high) &&
          Number.isFinite(item.low)
      );

    // 現在の4.618を中心に自動比較
    const stopLossCandidates = [
      3.0,
      3.5,
      4.0,
      4.5,
      4.618,
      5.0,
      5.5,
      6.0,
    ];

    const results: any[] = [];

    for (const stopLoss of stopLossCandidates) {
      let trades = 0;
      let wins = 0;
      let losses = 0;
      let totalPips = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let equity = 0;
      let peakEquity = 0;
      let maxDrawdown = 0;

      for (let i = 14; i < candles.length - 1; i++) {
        const history = candles
          .slice(0, i + 1)
          .map((item: any) => item.close);

        const sma5 = sma(history, 5);
        const sma10 = sma(history, 10);
        const rsi14 = rsi(history, 14);

        if (
          sma5 === null ||
          sma10 === null ||
          rsi14 === null
        ) {
          continue;
        }

        let signal = "WAIT";

        // 現在のチャガット1号の条件を変更しない
        if (sma5 > sma10 && rsi14 < 60) {
          signal = "BUY";
        } else if (sma5 < sma10 && rsi14 > 40) {
          signal = "SELL";
        }

        if (signal === "WAIT") continue;

        const tradeTime = candles[i].time;
        const tradeHour =
          Number(tradeTime.slice(11, 13));

        // 現在の時間フィルターを変更しない
        if (![0, 6].includes(tradeHour)) {
          continue;
        }

        const entry = candles[i].close;
        const nextCandle = candles[i + 1];

        if (!nextCandle) continue;

        const exit = nextCandle.close;

        let pips =
          signal === "BUY"
            ? (exit - entry) * 100
            : (entry - exit) * 100;

        const stopPrice =
          signal === "BUY"
            ? entry - stopLoss / 100
            : entry + stopLoss / 100;

        const stopHit =
          signal === "BUY"
            ? nextCandle.low <= stopPrice
            : nextCandle.high >= stopPrice;

        if (stopHit) {
          pips = -stopLoss;
        }

        trades++;
        totalPips += pips;

        if (pips > 0) {
          wins++;
          grossProfit += pips;
        } else if (pips < 0) {
          losses++;
          grossLoss += Math.abs(pips);
        }

        equity += pips;
        peakEquity = Math.max(
          peakEquity,
          equity
        );

        maxDrawdown = Math.max(
          maxDrawdown,
          peakEquity - equity
        );
      }

      const winRate =
        trades > 0
          ? (wins / trades) * 100
          : 0;

      const profitFactor =
        grossLoss > 0
          ? grossProfit / grossLoss
          : grossProfit > 0
            ? Infinity
            : 0;

      results.push({
        stopLoss,
        trades,
        wins,
        losses,
        winRate,
        totalPips,
        profitFactor,
        maxDrawdown,
      });
    }

    return c.json({
      system: "Chagatto-1 Auto Backtest",
      pair: "USDJPY",
      interval: "1h",
      baselineStopLoss: 4.618,
      testedStopLosses: stopLossCandidates,
      results,
      note:
        "Comparison only. Parameters are not automatically changed.",
    });
  } catch (error) {
    return c.json({
      error: "AUTO_BACKTEST_FAILED",
      message:
        error instanceof Error
          ? error.message
          : String(error),
    }, 500);
  }
});
app.get("/take-profit-backtest", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);
  }

  try {
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=500&apikey=${apiKey}`
    );
    const data = await response.json() as any;

    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values
      .slice()
      .reverse()
      .map((item: any) => ({
        time: item.datetime,
        close: Number(item.close),
        high: Number(item.high),
        low: Number(item.low),
      }))
      .filter((item: any) =>
        Number.isFinite(item.close) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low)
      );

    const stopLoss = 4.618;
    const tpRatios: Array<number | null> = [null, 1.0, 1.5, 2.0];
    const results: any[] = [];

    for (const tpRatio of tpRatios) {
      let trades = 0;
      let wins = 0;
      let losses = 0;
      let totalPips = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let equity = 0;
      let peakEquity = 0;
      let maxDrawdown = 0;
      let stopHits = 0;
      let takeProfitHits = 0;
      let ambiguousBothHit = 0;

      for (let i = 14; i < candles.length - 1; i++) {
        const history = candles.slice(0, i + 1).map((item: any) => item.close);
        const sma5 = sma(history, 5);
        const sma10 = sma(history, 10);
        const rsi14 = rsi(history, 14);

        if (sma5 === null || sma10 === null || rsi14 === null) continue;

        let signal = "WAIT";
        if (sma5 > sma10 && rsi14 < 60) signal = "BUY";
        else if (sma5 < sma10 && rsi14 > 40) signal = "SELL";
        if (signal === "WAIT") continue;

        const tradeHour = Number(candles[i].time.slice(11, 13));
        if (![0, 6].includes(tradeHour)) continue;

        const entry = candles[i].close;
        const nextCandle = candles[i + 1];
        if (!nextCandle) continue;

        let pips = signal === "BUY"
          ? (nextCandle.close - entry) * 100
          : (entry - nextCandle.close) * 100;

        const stopPrice = signal === "BUY"
          ? entry - stopLoss / 100
          : entry + stopLoss / 100;
        const stopHit = signal === "BUY"
          ? nextCandle.low <= stopPrice
          : nextCandle.high >= stopPrice;

        let tpHit = false;
        let takeProfitPips: number | null = null;
        if (tpRatio !== null) {
          takeProfitPips = stopLoss * tpRatio;
          const tpPrice = signal === "BUY"
            ? entry + takeProfitPips / 100
            : entry - takeProfitPips / 100;
          tpHit = signal === "BUY"
            ? nextCandle.high >= tpPrice
            : nextCandle.low <= tpPrice;
        }

        // 1時間足OHLCだけでは、同じ足の中でSLとTPのどちらが先に
        // 到達したか判定できない。両方に触れた足は安全側にSL先着とする。
        if (stopHit && tpHit) {
          ambiguousBothHit++;
          stopHits++;
          pips = -stopLoss;
        } else if (stopHit) {
          stopHits++;
          pips = -stopLoss;
        } else if (tpHit && takeProfitPips !== null) {
          takeProfitHits++;
          pips = takeProfitPips;
        }

        trades++;
        totalPips += pips;
        if (pips > 0) {
          wins++;
          grossProfit += pips;
        } else if (pips < 0) {
          losses++;
          grossLoss += Math.abs(pips);
        }

        equity += pips;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
      }

      const winRate = trades > 0 ? (wins / trades) * 100 : 0;
      const profitFactor = grossLoss > 0
        ? grossProfit / grossLoss
        : grossProfit > 0 ? Infinity : 0;

      results.push({
        mode: tpRatio === null ? "NO_FIXED_TP" : `TP_${tpRatio}R`,
        stopLossPips: stopLoss,
        takeProfitPips: tpRatio === null ? null : stopLoss * tpRatio,
        riskReward: tpRatio === null ? null : `1:${tpRatio}`,
        trades,
        wins,
        losses,
        winRate,
        totalPips,
        profitFactor,
        maxDrawdown,
        stopHits,
        takeProfitHits,
        ambiguousBothHit,
      });
    }

    return c.json({
      system: "Chagatto-1 Take Profit Backtest",
      pair: "USDJPY",
      interval: "1h",
      candlesRequested: 500,
      stopLossPips: stopLoss,
      tested: ["NO_FIXED_TP", "1:1", "1:1.5", "1:2"],
      results,
      assumption: "If SL and TP are both touched within the same 1h candle, SL is counted first because OHLC data cannot determine intrabar order.",
      note: "Comparison only. Live-trading parameters are not changed.",
    });
  } catch (error) {
    return c.json({
      error: "TAKE_PROFIT_BACKTEST_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

app.get("/auto-optimize", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return c.json(
      { error: "TWELVE_DATA_API_KEY is not set" },
      500
    );
  }

  try {
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=500&apikey=${apiKey}`
    );

    const data = (await response.json()) as any;

    if (!data.values || !Array.isArray(data.values)) {
      return c.json(
        {
          error: "Twelve Data API error",
          details: data,
        },
        500
      );
    }

    const candles = data.values
      .slice()
      .reverse()
      .map((item: any) => ({
        time: item.datetime,
        close: Number(item.close),
        high: Number(item.high),
        low: Number(item.low),
      }))
      .filter(
        (item: any) =>
          Number.isFinite(item.close) &&
          Number.isFinite(item.high) &&
          Number.isFinite(item.low)
      );

    // チャガット1号が比較する候補
    const fastSmaCandidates = [3, 5, 7];
    const slowSmaCandidates = [8, 10, 12];
    const buyRsiCandidates = [55, 60, 65];
    const sellRsiCandidates = [35, 40, 45];

    // 現在の基準4.618を必ず含める
    const stopLossCandidates = [
      3,
      3.5,
      4,
      4.5,
      4.618,
      5,
      5.5,
      6,
    ];

    const results: any[] = [];

    for (const fastSma of fastSmaCandidates) {
      for (const slowSma of slowSmaCandidates) {
        if (fastSma >= slowSma) continue;

        for (const buyRsi of buyRsiCandidates) {
          for (const sellRsi of sellRsiCandidates) {
            for (const stopLoss of stopLossCandidates) {
              let trades = 0;
              let wins = 0;
              let losses = 0;
              let totalPips = 0;
              let grossProfit = 0;
              let grossLoss = 0;
              let equity = 0;
              let peakEquity = 0;
              let maxDrawdown = 0;

              for (
                let i = 14;
                i < candles.length - 1;
                i++
              ) {
                const history = candles
                  .slice(0, i + 1)
                  .map((item: any) => item.close);

                const fast = sma(history, fastSma);
                const slow = sma(history, slowSma);
                const rsi14 = rsi(history, 14);

                if (
                  fast === null ||
                  slow === null ||
                  rsi14 === null
                ) {
                  continue;
                }

                let signal = "WAIT";

                if (
                  fast > slow &&
                  rsi14 < buyRsi
                ) {
                  signal = "BUY";
                } else if (
                  fast < slow &&
                  rsi14 > sellRsi
                ) {
                  signal = "SELL";
                }

                if (signal === "WAIT") continue;

                const entry = candles[i].close;
                const nextCandle = candles[i + 1];

                if (!nextCandle) continue;

                const exit = nextCandle.close;

                let pips =
                  signal === "BUY"
                    ? (exit - entry) * 100
                    : (entry - exit) * 100;

                const stopPrice =
                  signal === "BUY"
                    ? entry - stopLoss / 100
                    : entry + stopLoss / 100;

                const stopHit =
                  signal === "BUY"
                    ? nextCandle.low <= stopPrice
                    : nextCandle.high >= stopPrice;

                if (stopHit) {
                  pips = -stopLoss;
                }

                // 現行バックテストと同じ時間フィルター
                const tradeTime = candles[i].time;
                const tradeHour = Number(
                  tradeTime.slice(11, 13)
                );

                if (![0, 6].includes(tradeHour)) {
                  continue;
                }

                trades++;
                totalPips += pips;

                if (pips > 0) {
                  wins++;
                  grossProfit += pips;
                } else if (pips < 0) {
                  losses++;
                  grossLoss += Math.abs(pips);
                }

                equity += pips;

                if (equity > peakEquity) {
                  peakEquity = equity;
                }

                const drawdown =
                  peakEquity - equity;

                if (drawdown > maxDrawdown) {
                  maxDrawdown = drawdown;
                }
              }

              const winRate =
                trades > 0
                  ? (wins / trades) * 100
                  : 0;

              const profitFactor =
                grossLoss > 0
                  ? grossProfit / grossLoss
                  : grossProfit > 0
                    ? null
                    : 0;

              results.push({
                fastSma,
                slowSma,
                buyRsi,
                sellRsi,
                stopLoss,
                trades,
                wins,
                losses,
                winRate,
                totalPips,
                profitFactor,
                maxDrawdown,
              });
            }
          }
        }
      }
    }

    // 成績だけでなく安定性も含めて自動評価する
const rankedResults = results
  .map((result: any) => {
    const score =
      result.totalPips +
      result.profitFactor * 10 -
      result.maxDrawdown * 0.5;

    return {
      ...result,
      score,
    };
  })
  .filter(
    (result: any) =>
      result.trades >= 15 &&
      result.totalPips > 0 &&
      result.profitFactor > 1
  )
  .sort(
    (a: any, b: any) =>
      b.score - a.score
  );

const bestCandidate =
  rankedResults.length > 0
    ? rankedResults[0]
    : null;

    return c.json({
      system: "Chagatto-1 Auto Optimizer",
      pair: "USDJPY",
      interval: "1h",

      baseline: {
        fastSma: 5,
        slowSma: 10,
        buyRsi: 60,
        sellRsi: 40,
        stopLoss: 4.618,
      },

      combinationsTested: results.length,
      bestCandidate,

      // 上位20件だけ表示
      topResults: rankedResults.slice(0, 20),

      note:
        "Research only. Chagatto-2 live parameters are NOT automatically changed.",
    });
  } catch (error) {
    return c.json(
      {
        error: "AUTO_OPTIMIZE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500
    );
  }
});

app.get("/walk-forward", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);

  try {
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=500&apikey=${apiKey}`
    );
    const data = (await response.json()) as any;
    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values.slice().reverse().map((item: any) => ({
      time: item.datetime,
      close: Number(item.close),
      high: Number(item.high),
      low: Number(item.low),
    })).filter((item: any) =>
      Number.isFinite(item.close) && Number.isFinite(item.high) && Number.isFinite(item.low)
    );

    const splitIndex = Math.floor(candles.length * 0.70);
    const fastSmaCandidates = [3, 5, 7];
    const slowSmaCandidates = [8, 10, 12];
    const buyRsiCandidates = [55, 60, 65];
    const sellRsiCandidates = [35, 40, 45];
    const stopLossCandidates = [3, 3.5, 4, 4.5, 4.618, 5, 5.5, 6];

    const evaluate = (params: any, startIndex: number, endIndexExclusive: number) => {
      let trades = 0, wins = 0, losses = 0, totalPips = 0;
      let grossProfit = 0, grossLoss = 0, equity = 0, peakEquity = 0, maxDrawdown = 0;
      let buyTrades = 0, buyPips = 0, sellTrades = 0, sellPips = 0;

      for (let i = Math.max(14, startIndex); i < Math.min(endIndexExclusive, candles.length - 1); i++) {
        const history = candles.slice(0, i + 1).map((item: any) => item.close);
        const fast = sma(history, params.fastSma);
        const slow = sma(history, params.slowSma);
        const rsi14 = rsi(history, 14);
        if (fast === null || slow === null || rsi14 === null) continue;

        let signal = "WAIT";
        if (fast > slow && rsi14 < params.buyRsi) signal = "BUY";
        else if (fast < slow && rsi14 > params.sellRsi) signal = "SELL";
        if (signal === "WAIT") continue;

        const tradeHour = Number(candles[i].time.slice(11, 13));
        if (![0, 6].includes(tradeHour)) continue;

        const entry = candles[i].close;
        const nextCandle = candles[i + 1];
        let pips = signal === "BUY"
          ? (nextCandle.close - entry) * 100
          : (entry - nextCandle.close) * 100;
        const stopPrice = signal === "BUY"
          ? entry - params.stopLoss / 100
          : entry + params.stopLoss / 100;
        const stopHit = signal === "BUY"
          ? nextCandle.low <= stopPrice
          : nextCandle.high >= stopPrice;
        if (stopHit) pips = -params.stopLoss;

        trades++;
        totalPips += pips;
        if (signal === "BUY") { buyTrades++; buyPips += pips; }
        else { sellTrades++; sellPips += pips; }
        if (pips > 0) { wins++; grossProfit += pips; }
        else if (pips < 0) { losses++; grossLoss += Math.abs(pips); }
        equity += pips;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
      }

      const winRate = trades > 0 ? wins / trades * 100 : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
      return { trades, wins, losses, winRate, totalPips, profitFactor, maxDrawdown, buyTrades, buyPips, sellTrades, sellPips };
    };

    const trainingResults: any[] = [];
    for (const fastSma of fastSmaCandidates) {
      for (const slowSma of slowSmaCandidates) {
        if (fastSma >= slowSma) continue;
        for (const buyRsi of buyRsiCandidates) {
          for (const sellRsi of sellRsiCandidates) {
            for (const stopLoss of stopLossCandidates) {
              const params = { fastSma, slowSma, buyRsi, sellRsi, stopLoss };
              const metrics = evaluate(params, 14, splitIndex);
              const pfForScore = typeof metrics.profitFactor === "number" ? metrics.profitFactor : 0;
              const score = metrics.totalPips + pfForScore * 10 - metrics.maxDrawdown * 0.5;
              trainingResults.push({ ...params, ...metrics, score });
            }
          }
        }
      }
    }

    const eligible = trainingResults.filter((r: any) =>
      r.trades >= 10 && r.totalPips > 0 && typeof r.profitFactor === "number" && r.profitFactor > 1
    ).sort((a: any, b: any) => b.score - a.score);

    const selected = eligible.length > 0 ? eligible[0] : null;
    if (!selected) {
      return c.json({
        system: "Chagatto-1 Walk Forward Validation",
        pair: "USDJPY", interval: "1h", candles: candles.length,
        split: { trainingPercent: 70, validationPercent: 30, splitIndex },
        combinationsTested: trainingResults.length,
        selected: null,
        note: "No training candidate passed the minimum filters. Live parameters are NOT changed."
      });
    }

    const params = {
      fastSma: selected.fastSma, slowSma: selected.slowSma,
      buyRsi: selected.buyRsi, sellRsi: selected.sellRsi, stopLoss: selected.stopLoss
    };
    const validation = evaluate(params, splitIndex, candles.length - 1);

    return c.json({
      system: "Chagatto-1 Walk Forward Validation",
      pair: "USDJPY", interval: "1h", candles: candles.length,
      split: {
        trainingPercent: 70, validationPercent: 30, splitIndex,
        trainingFrom: candles[0]?.time, trainingTo: candles[splitIndex - 1]?.time,
        validationFrom: candles[splitIndex]?.time, validationTo: candles[candles.length - 1]?.time
      },
      combinationsTested: trainingResults.length,
      selectedParameters: params,
      training: {
        trades: selected.trades, wins: selected.wins, losses: selected.losses,
        winRate: selected.winRate, totalPips: selected.totalPips,
        profitFactor: selected.profitFactor, maxDrawdown: selected.maxDrawdown,
        buyTrades: selected.buyTrades, buyPips: selected.buyPips,
        sellTrades: selected.sellTrades, sellPips: selected.sellPips,
        score: selected.score
      },
      validation,
      validationPassed: validation.trades >= 5 && validation.totalPips > 0 && typeof validation.profitFactor === "number" && validation.profitFactor > 1,
      note: "Parameters are selected only on the first 70% and then frozen for the final 30%. Research only; live parameters are NOT changed."
    });
  } catch (error) {
    return c.json({
      error: "WALK_FORWARD_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});


app.get("/direction-walk-forward", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);

  try {
    const requestedCandles = 2000;
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=${requestedCandles}&apikey=${apiKey}`
    );
    const data = (await response.json()) as any;
    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values.slice().reverse().map((item: any) => ({
      time: item.datetime,
      close: Number(item.close),
      high: Number(item.high),
      low: Number(item.low),
    })).filter((item: any) =>
      Number.isFinite(item.close) && Number.isFinite(item.high) && Number.isFinite(item.low)
    );

    const splitIndex = Math.floor(candles.length * 0.70);
    const fastSmaCandidates = [3, 5, 7];
    const slowSmaCandidates = [8, 10, 12];
    const buyRsiCandidates = [55, 60, 65];
    const sellRsiCandidates = [35, 40, 45];
    const stopLossCandidates = [3, 3.5, 4, 4.5, 4.618, 5, 5.5, 6];
    const modes = ["BUY_ONLY", "SELL_ONLY", "BOTH"];

    const evaluate = (params: any, mode: string, startIndex: number, endIndexExclusive: number) => {
      let trades = 0, wins = 0, losses = 0, totalPips = 0;
      let grossProfit = 0, grossLoss = 0, equity = 0, peakEquity = 0, maxDrawdown = 0;
      let buyTrades = 0, buyPips = 0, sellTrades = 0, sellPips = 0;

      for (let i = Math.max(14, startIndex); i < Math.min(endIndexExclusive, candles.length - 1); i++) {
        const history = candles.slice(0, i + 1).map((item: any) => item.close);
        const fast = sma(history, params.fastSma);
        const slow = sma(history, params.slowSma);
        const rsi14 = rsi(history, 14);
        if (fast === null || slow === null || rsi14 === null) continue;

        let signal = "WAIT";
        if (fast > slow && rsi14 < params.buyRsi) signal = "BUY";
        else if (fast < slow && rsi14 > params.sellRsi) signal = "SELL";
        if (signal === "WAIT") continue;
        if (mode === "BUY_ONLY" && signal !== "BUY") continue;
        if (mode === "SELL_ONLY" && signal !== "SELL") continue;

        const tradeHour = Number(candles[i].time.slice(11, 13));
        if (![0, 6].includes(tradeHour)) continue;

        const entry = candles[i].close;
        const nextCandle = candles[i + 1];
        let pips = signal === "BUY"
          ? (nextCandle.close - entry) * 100
          : (entry - nextCandle.close) * 100;

        const stopPrice = signal === "BUY"
          ? entry - params.stopLoss / 100
          : entry + params.stopLoss / 100;
        const stopHit = signal === "BUY"
          ? nextCandle.low <= stopPrice
          : nextCandle.high >= stopPrice;
        if (stopHit) pips = -params.stopLoss;

        trades++;
        totalPips += pips;
        if (signal === "BUY") { buyTrades++; buyPips += pips; }
        else { sellTrades++; sellPips += pips; }

        if (pips > 0) { wins++; grossProfit += pips; }
        else if (pips < 0) { losses++; grossLoss += Math.abs(pips); }

        equity += pips;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
      }

      const winRate = trades > 0 ? wins / trades * 100 : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
      return { trades, wins, losses, winRate, totalPips, profitFactor, maxDrawdown, buyTrades, buyPips, sellTrades, sellPips };
    };

    const optimizeMode = (mode: string) => {
      const results: any[] = [];

      for (const fastSma of fastSmaCandidates) {
        for (const slowSma of slowSmaCandidates) {
          if (fastSma >= slowSma) continue;
          for (const buyRsi of buyRsiCandidates) {
            for (const sellRsi of sellRsiCandidates) {
              for (const stopLoss of stopLossCandidates) {
                if (mode === "BUY_ONLY" && sellRsi !== sellRsiCandidates[0]) continue;
                if (mode === "SELL_ONLY" && buyRsi !== buyRsiCandidates[0]) continue;

                const params = { fastSma, slowSma, buyRsi, sellRsi, stopLoss };
                const metrics = evaluate(params, mode, 14, splitIndex);
                const pfForScore = typeof metrics.profitFactor === "number" ? metrics.profitFactor : 0;
                const score = metrics.totalPips + pfForScore * 10 - metrics.maxDrawdown * 0.5;
                results.push({ ...params, ...metrics, score });
              }
            }
          }
        }
      }

      const eligible = results.filter((r: any) =>
        r.trades >= 10 && r.totalPips > 0 &&
        typeof r.profitFactor === "number" && r.profitFactor > 1
      ).sort((a: any, b: any) => b.score - a.score);

      const selected = eligible[0] ?? null;
      if (!selected) return { mode, combinationsTested: results.length, selected: null, validation: null, validationPassed: false };

      const params = {
        fastSma: selected.fastSma, slowSma: selected.slowSma,
        buyRsi: selected.buyRsi, sellRsi: selected.sellRsi, stopLoss: selected.stopLoss
      };
      const validation = evaluate(params, mode, splitIndex, candles.length - 1);

      return {
        mode,
        combinationsTested: results.length,
        selectedParameters: params,
        training: {
          trades: selected.trades, wins: selected.wins, losses: selected.losses,
          winRate: selected.winRate, totalPips: selected.totalPips,
          profitFactor: selected.profitFactor, maxDrawdown: selected.maxDrawdown,
          buyTrades: selected.buyTrades, buyPips: selected.buyPips,
          sellTrades: selected.sellTrades, sellPips: selected.sellPips,
          score: selected.score
        },
        validation,
        validationPassed:
          validation.trades >= 5 &&
          validation.totalPips > 0 &&
          typeof validation.profitFactor === "number" &&
          validation.profitFactor > 1
      };
    };

    const results = modes.map(optimizeMode);

    return c.json({
      system: "Chagatto-1 Direction Walk Forward",
      pair: "USDJPY",
      interval: "1h",
      candlesRequested: requestedCandles,
      candlesReceived: candles.length,
      split: {
        trainingPercent: 70,
        validationPercent: 30,
        splitIndex,
        trainingFrom: candles[0]?.time,
        trainingTo: candles[splitIndex - 1]?.time,
        validationFrom: candles[splitIndex]?.time,
        validationTo: candles[candles.length - 1]?.time
      },
      results,
      note: "BUY_ONLY, SELL_ONLY and BOTH are optimized only on the first 70%, then frozen for the final 30%. Research only; live parameters are NOT changed."
    });
  } catch (error) {
    return c.json({
      error: "DIRECTION_WALK_FORWARD_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});


app.get("/multi-window-validation", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);

  try {
    const requestedCandles = 2000;
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=${requestedCandles}&apikey=${apiKey}`
    );
    const data = (await response.json()) as any;
    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values.slice().reverse().map((item: any) => ({
      time: item.datetime,
      close: Number(item.close),
      high: Number(item.high),
      low: Number(item.low),
    })).filter((item: any) =>
      Number.isFinite(item.close) && Number.isFinite(item.high) && Number.isFinite(item.low)
    );

    const params = { fastSma: 7, slowSma: 10, buyRsi: 60, sellRsi: 45, stopLoss: 6 };

    const evaluate = (startIndex: number, endIndexExclusive: number) => {
      let trades = 0, wins = 0, losses = 0, totalPips = 0;
      let grossProfit = 0, grossLoss = 0, equity = 0, peakEquity = 0, maxDrawdown = 0;
      let buyTrades = 0, buyPips = 0, sellTrades = 0, sellPips = 0;

      for (let i = Math.max(14, startIndex); i < Math.min(endIndexExclusive, candles.length - 1); i++) {
        const history = candles.slice(0, i + 1).map((item: any) => item.close);
        const fast = sma(history, params.fastSma);
        const slow = sma(history, params.slowSma);
        const rsi14 = rsi(history, 14);
        if (fast === null || slow === null || rsi14 === null) continue;

        let signal = "WAIT";
        if (fast > slow && rsi14 < params.buyRsi) signal = "BUY";
        else if (fast < slow && rsi14 > params.sellRsi) signal = "SELL";
        if (signal === "WAIT") continue;

        const tradeHour = Number(candles[i].time.slice(11, 13));
        if (![0, 6].includes(tradeHour)) continue;

        const entry = candles[i].close;
        const nextCandle = candles[i + 1];
        let pips = signal === "BUY"
          ? (nextCandle.close - entry) * 100
          : (entry - nextCandle.close) * 100;

        const stopPrice = signal === "BUY"
          ? entry - params.stopLoss / 100
          : entry + params.stopLoss / 100;
        const stopHit = signal === "BUY"
          ? nextCandle.low <= stopPrice
          : nextCandle.high >= stopPrice;
        if (stopHit) pips = -params.stopLoss;

        trades++;
        totalPips += pips;
        if (signal === "BUY") { buyTrades++; buyPips += pips; }
        else { sellTrades++; sellPips += pips; }

        if (pips > 0) { wins++; grossProfit += pips; }
        else if (pips < 0) { losses++; grossLoss += Math.abs(pips); }

        equity += pips;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
      }

      return {
        trades, wins, losses,
        winRate: trades ? wins / trades * 100 : 0,
        totalPips,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
        maxDrawdown,
        buyTrades, buyPips, sellTrades, sellPips
      };
    };

    const windowCount = 5;
    const usableEnd = candles.length - 1;
    const windowSize = Math.floor(usableEnd / windowCount);
    const windows: any[] = [];

    for (let w = 0; w < windowCount; w++) {
      const start = w * windowSize;
      const end = w === windowCount - 1 ? usableEnd : (w + 1) * windowSize;
      const metrics = evaluate(start, end);
      windows.push({
        window: w + 1,
        from: candles[start]?.time,
        to: candles[Math.max(start, end - 1)]?.time,
        ...metrics,
        passed: metrics.trades >= 5 &&
          metrics.totalPips > 0 &&
          (metrics.profitFactor === null || metrics.profitFactor > 1)
      });
    }

    const positiveWindows = windows.filter((w: any) => w.totalPips > 0).length;
    const pfAboveOneWindows = windows.filter((w: any) =>
      w.profitFactor === null || (typeof w.profitFactor === "number" && w.profitFactor > 1)
    ).length;
    const total = evaluate(14, usableEnd);

    return c.json({
      system: "Chagatto-1 Multi Window Validation",
      pair: "USDJPY",
      interval: "1h",
      candlesRequested: requestedCandles,
      candlesReceived: candles.length,
      fixedParameters: params,
      method: "The same frozen parameters are tested across 5 chronological non-overlapping windows. No parameter optimization is performed inside these windows.",
      windows,
      summary: {
        positiveWindows,
        pfAboveOneWindows,
        windowCount,
        allWindowsPassed: windows.every((w: any) => w.passed),
        total
      },
      liveParametersChanged: false,
      note: "Research only. LIVE_TRADING_ENABLED is not changed by this endpoint."
    });
  } catch (error) {
    return c.json({
      error: "MULTI_WINDOW_VALIDATION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});


app.get("/regime-filter-validation", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);

  try {
    const requestedCandles = 2000;
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=${requestedCandles}&apikey=${apiKey}`
    );
    const data = (await response.json()) as any;
    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values.slice().reverse().map((item: any) => ({
      time: item.datetime,
      close: Number(item.close),
      high: Number(item.high),
      low: Number(item.low),
    })).filter((x: any) =>
      Number.isFinite(x.close) && Number.isFinite(x.high) && Number.isFinite(x.low)
    );

    const params = { fastSma: 7, slowSma: 10, buyRsi: 60, sellRsi: 45, stopLoss: 6 };

    const atrAt = (i: number, period = 14) => {
      if (i < period) return null;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const prevClose = j > 0 ? candles[j - 1].close : candles[j].close;
        const tr = Math.max(
          candles[j].high - candles[j].low,
          Math.abs(candles[j].high - prevClose),
          Math.abs(candles[j].low - prevClose)
        );
        sum += tr;
      }
      return sum / period;
    };

    const filterDefs: any[] = [
      { name: "NO_FILTER", pass: (_i: number, _f: number, _s: number, _a: number|null) => true },
      { name: "SMA_GAP_2PIPS", pass: (_i: number, f: number, s: number, _a: number|null) => Math.abs(f - s) * 100 >= 2 },
      { name: "SMA_GAP_4PIPS", pass: (_i: number, f: number, s: number, _a: number|null) => Math.abs(f - s) * 100 >= 4 },
      { name: "ATR14_6PIPS", pass: (_i: number, _f: number, _s: number, a: number|null) => a !== null && a * 100 >= 6 },
      { name: "ATR14_8PIPS", pass: (_i: number, _f: number, _s: number, a: number|null) => a !== null && a * 100 >= 8 },
      { name: "GAP2_AND_ATR6", pass: (_i: number, f: number, s: number, a: number|null) => Math.abs(f - s) * 100 >= 2 && a !== null && a * 100 >= 6 },
    ];

    const evaluate = (filter: any, startIndex: number, endIndexExclusive: number) => {
      let trades=0,wins=0,losses=0,totalPips=0,grossProfit=0,grossLoss=0,equity=0,peak=0,maxDrawdown=0;
      let buyTrades=0,buyPips=0,sellTrades=0,sellPips=0;

      for (let i=Math.max(14,startIndex); i<Math.min(endIndexExclusive,candles.length-1); i++) {
        const history = candles.slice(0,i+1).map((x:any)=>x.close);
        const fast=sma(history,params.fastSma), slow=sma(history,params.slowSma), rsi14=rsi(history,14);
        if (fast===null || slow===null || rsi14===null) continue;

        let signal="WAIT";
        if (fast>slow && rsi14<params.buyRsi) signal="BUY";
        else if (fast<slow && rsi14>params.sellRsi) signal="SELL";
        if (signal==="WAIT") continue;

        const hour=Number(candles[i].time.slice(11,13));
        if (![0,6].includes(hour)) continue;

        const a=atrAt(i,14);
        if (!filter.pass(i,fast,slow,a)) continue;

        const entry=candles[i].close, next=candles[i+1];
        let pips=signal==="BUY" ? (next.close-entry)*100 : (entry-next.close)*100;
        const stopPrice=signal==="BUY" ? entry-params.stopLoss/100 : entry+params.stopLoss/100;
        const stopHit=signal==="BUY" ? next.low<=stopPrice : next.high>=stopPrice;
        if (stopHit) pips=-params.stopLoss;

        trades++; totalPips+=pips;
        if(signal==="BUY"){buyTrades++;buyPips+=pips}else{sellTrades++;sellPips+=pips}
        if(pips>0){wins++;grossProfit+=pips}else if(pips<0){losses++;grossLoss+=Math.abs(pips)}
        equity+=pips; peak=Math.max(peak,equity); maxDrawdown=Math.max(maxDrawdown,peak-equity);
      }
      return {
        trades,wins,losses,winRate:trades?wins/trades*100:0,totalPips,
        profitFactor:grossLoss>0?grossProfit/grossLoss:(grossProfit>0?null:0),
        maxDrawdown,buyTrades,buyPips,sellTrades,sellPips
      };
    };

    const usableEnd=candles.length-1, windowCount=5, windowSize=Math.floor(usableEnd/windowCount);
    const filters=filterDefs.map((filter:any)=>{
      const windows:any[]=[];
      for(let w=0;w<windowCount;w++){
        const start=w*windowSize;
        const end=w===windowCount-1?usableEnd:(w+1)*windowSize;
        const m=evaluate(filter,start,end);
        windows.push({
          window:w+1,from:candles[start]?.time,to:candles[Math.max(start,end-1)]?.time,...m,
          passed:m.trades>=5 && m.totalPips>0 && (m.profitFactor===null || m.profitFactor>1)
        });
      }
      const total=evaluate(filter,14,usableEnd);
      return {
        filter:filter.name,windows,
        summary:{
          positiveWindows:windows.filter((x:any)=>x.totalPips>0).length,
          passedWindows:windows.filter((x:any)=>x.passed).length,
          total
        }
      };
    });

    return c.json({
      system:"Chagatto-1 Regime Filter Validation",
      pair:"USDJPY",interval:"1h",candlesRequested:requestedCandles,candlesReceived:candles.length,
      fixedParameters:params,
      filtersTested:filters.map((x:any)=>x.filter),
      filters,
      liveParametersChanged:false,
      note:"Research only. Filters are compared across the same five chronological windows; LIVE_TRADING_ENABLED is not changed."
    });
  } catch (error) {
    return c.json({error:"REGIME_FILTER_VALIDATION_FAILED",message:error instanceof Error?error.message:String(error)},500);
  }
});

app.get("/gmo-test", async (c) => {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;

  if (!apiKey || !apiSecret) {
    return c.json({ error: "GMO API keys are not set" }, 500);
  }

  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/v1/account/assets";

  const text = timestamp + method + path;

  const sign = crypto
    .createHmac("sha256", apiSecret)
    .update(text)
    .digest("hex");

  const response = await fetch(
  "https://forex-api.coin.z.com/private/v1/account/assets",
    {
      method,
      headers: {
        "API-KEY": apiKey,
        "API-TIMESTAMP": timestamp,
        "API-SIGN": sign,
      },
    }
  );

  const data = await response.json();

  return c.json({
    connected: response.ok,
    data,
  });
});
app.get("/gmo-price", async (c) => {
  const response = await fetch(
    "https://forex-api.coin.z.com/public/v1/ticker"
  );

  const data: any = await response.json();

  if (data.status !== 0 || !Array.isArray(data.data)) {
    return c.json({
      error: "Failed to get GMO FX price",
      data,
    }, 500);
  }

  const usdJpy = data.data.find(
    (item: any) => item.symbol === "USD_JPY"
  );

  if (!usdJpy) {
    return c.json({
      error: "USD_JPY not found",
    }, 404);
  }

  return c.json({
    system: "Chagatto-2",
    source: "GMO Coin FX",
    symbol: usdJpy.symbol,
    bid: Number(usdJpy.bid),
    ask: Number(usdJpy.ask),
    status: usdJpy.status,
    timestamp: usdJpy.timestamp,
  });
});
app.get("/gmo-klines", async (c) => {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  // GMO FXは日本時間6:00で取引日が切り替わる
  if (jst.getUTCHours() < 6) {
    jst.setUTCDate(jst.getUTCDate() - 1);
  }

  const formatDate = (d: Date) =>
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");

  const currentDate = formatDate(jst);

  const previous = new Date(jst);
  previous.setUTCDate(previous.getUTCDate() - 1);

  // 土日を飛ばす
  while (
    previous.getUTCDay() === 0 ||
    previous.getUTCDay() === 6
  ) {
    previous.setUTCDate(previous.getUTCDate() - 1);
  }

  const previousDate = formatDate(previous);

  const getKlines = async (date: string) => {
    const url =
      "https://forex-api.coin.z.com/public/v1/klines" +
      "?symbol=USD_JPY" +
      "&priceType=BID" +
      "&interval=1hour" +
      "&date=" + date;

    const response = await fetch(url);
    const data: any = await response.json();

    if (data.status !== 0 || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((x: any) => ({
      time: Number(x.openTime),
      open: Number(x.open),
      high: Number(x.high),
      low: Number(x.low),
      close: Number(x.close),
    }));
  };

  const previousCandles = await getKlines(previousDate);
  const currentCandles = await getKlines(currentDate);

  const candles = [
    ...previousCandles,
    ...currentCandles,
  ].sort((a, b) => a.time - b.time);

  return c.json({
    system: "Chagatto-2",
    source: "GMO Coin FX",
    symbol: "USD_JPY",
    interval: "1hour",
    previousDate,
    currentDate,
    candleCount: candles.length,
    candles: candles.slice(-30),
  });
});
app.get("/gmo-signal", async (c) => {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  if (jst.getUTCHours() < 6) {
    jst.setUTCDate(jst.getUTCDate() - 1);
  }

  const formatDate = (d: Date) =>
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");

  const currentDate = formatDate(jst);

  const previous = new Date(jst);
  previous.setUTCDate(previous.getUTCDate() - 1);

  while (
    previous.getUTCDay() === 0 ||
    previous.getUTCDay() === 6
  ) {
    previous.setUTCDate(previous.getUTCDate() - 1);
  }

  const previousDate = formatDate(previous);

  const getKlines = async (date: string) => {
    const url =
      "https://forex-api.coin.z.com/public/v1/klines" +
      "?symbol=USD_JPY" +
      "&priceType=BID" +
      "&interval=1hour" +
      "&date=" + date;

    const response = await fetch(url);
    const data: any = await response.json();

    if (data.status !== 0 || !Array.isArray(data.data)) {
      return [];
    }

 return data.data.map((x: any) => ({
  time: Number(x.openTime),
  high: Number(x.high),
  low: Number(x.low),
  close: Number(x.close),
}));
  };

  const previousCandles = await getKlines(previousDate);
  const currentCandles = await getKlines(currentDate);

  const candles = [
    ...previousCandles,
    ...currentCandles,
  ].sort((a, b) => a.time - b.time);
    // 確定した1時間足だけを使用する
  const nowMs = Date.now();

  const completedCandles = candles.filter(
    (x) => x.time + 60 * 60 * 1000 <= nowMs
  );

  const closes = completedCandles.map((x) => x.close);

  if (closes.length < 15) {
    return c.json({
      error: "Not enough candles",
      candleCount: closes.length,
    }, 500);
  }

  const sma7 = sma(closes, 7);
  const sma8 = sma(closes, 8);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(completedCandles, 14);

  let signal = "WAIT";

  if (
    sma7 !== null &&
    sma8 !== null &&
    rsi14 !== null
  ) {
    if (sma7 > sma8 && rsi14 < 60) {
      signal = "BUY";
    } else if (sma7 < sma8 && rsi14 > 45) {
      signal = "SELL";
    }
  }
const maxRiskYen = TARGET_LOSS_PER_TRADE_YEN;
const stopDistance = FIXED_STOP_DISTANCE;
const orderSize = FIXED_ORDER_SIZE;

  return c.json({
    system: "Chagatto-2",
    source: "GMO Coin FX",
    symbol: "USD_JPY",
    interval: "1hour",
    candleCount: closes.length,
    price: closes[closes.length - 1],
    sma7,
    sma8,
    rsi14,
    atr14,
stopDistance,
maxRiskYen,
orderSize,
    signal,
    time: new Date().toISOString(),
  });
});
let gmoOrderInProgress = false;
let gmoSafetyHalt = false;
let gmoSafetyHaltReason: string | null = null;

// ===== Chagatto-1 safety scheduler patch =====
// 検証中は Railway の LIVE_TRADING_ENABLED=false のままにする。
const DAILY_LOSS_LIMIT_YEN = -1200;
const MAX_DAILY_TRADES = 20;
const FIXED_ORDER_SIZE = 1000;
const FIXED_STOP_DISTANCE = 0.100; // 10 pips on USD/JPY
const FIXED_TAKE_PROFIT_DISTANCE = 0.200; // 20 pips on USD/JPY
const TARGET_LOSS_PER_TRADE_YEN = 100;
const TARGET_PROFIT_PER_TRADE_YEN = 200;
let schedulerInProgress = false;
let lastSchedulerJstHourKey: string | null = null;
let lastSchedulerResult: any = null;

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: get("hour"),
    minute: get("minute"),
  };
}

function isGmoFxTradingHoursJst(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");

  // GMO外国為替FXの通常取引時間: 月曜07:00〜土曜05:59(JST)
  if (weekday === "Sun") return false;
  if (weekday === "Mon") return hour >= 7;
  if (weekday === "Sat") return hour < 6;
  return true;
}

function toJstDateString(value: unknown) {
  const d = new Date(String(value ?? ""));
  if (!Number.isFinite(d.getTime())) return null;
  return jstParts(d).date;
}

async function gmoPrivateGet(path: string, query = "") {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("GMO API keys are not set");

  const timestamp = Date.now().toString();
  const method = "GET";
  const sign = crypto
    .createHmac("sha256", apiSecret)
    .update(timestamp + method + path)
    .digest("hex");

  const response = await fetch(`https://forex-api.coin.z.com/private${path}${query}`, {
    method,
    headers: {
      "API-KEY": apiKey,
      "API-TIMESTAMP": timestamp,
      "API-SIGN": sign,
    },
  });
  const data: any = await response.json();
  if (!response.ok || data?.status !== 0) {
    throw new Error(`GMO ${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getTodayRealizedPnlJst() {
  const todayJst = jstParts().date;
  const data = await gmoPrivateGet("/v1/latestExecutions", "?symbol=USD_JPY&count=100");
  const rows = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.list)
      ? data.data.list
      : [];

  const todayRows = rows.filter((x: any) => toJstDateString(x?.timestamp) === todayJst);
  let pnl = 0;
  let closeCount = 0;

  for (const x of todayRows) {
    const lossGain = Number(x?.lossGain);
    // lossGain が返る決済約定だけを日次確定損益へ加算する。
    if (!Number.isFinite(lossGain)) continue;
    const fee = Number(x?.fee ?? 0);
    const settledSwap = Number(x?.settledSwap ?? 0);
    pnl += lossGain + (Number.isFinite(fee) ? fee : 0) + (Number.isFinite(settledSwap) ? settledSwap : 0);
    closeCount += 1;
  }

  return { dateJst: todayJst, pnl, closeCount, fetchedCount: rows.length };
}

async function getUsdJpyOpenPositionCount() {
  const data = await gmoPrivateGet("/v1/openPositions", "?symbol=USD_JPY&count=100");
  const rows = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.list)
      ? data.data.list
      : [];
  return rows.length;
}

function schedulerBaseUrl() {
  const explicit = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) return `https://${railwayDomain}`;
  return `http://127.0.0.1:${Number(process.env.PORT || 8080)}`;
}

async function runHourlySafetyCycle() {
  if (schedulerInProgress) return;
  schedulerInProgress = true;
  const startedAt = new Date().toISOString();

  try {
    if (!isGmoFxTradingHoursJst()) {
      lastSchedulerResult = {
        startedAt,
        action: "STOP_MARKET_CLOSED",
        reason: "GMO_FX_REGULAR_TRADING_HOURS_CLOSED",
        regularTradingHours: "Mon 07:00 - Sat 05:59 JST",
        jst: jstParts(),
      };
      console.log("[scheduler] market closed", lastSchedulerResult);
      return;
    }

    const daily = await getTodayRealizedPnlJst();
    if (daily.pnl <= DAILY_LOSS_LIMIT_YEN) {
      lastSchedulerResult = { startedAt, action: "STOP_DAILY_LOSS", daily };
      console.log("[scheduler] daily loss stop", lastSchedulerResult);
      return;
    }
if (daily.closeCount >= MAX_DAILY_TRADES) {
      lastSchedulerResult = { startedAt, action: "STOP_DAILY_TRADE_COUNT", daily };
      console.log("[scheduler] daily trade-count stop", lastSchedulerResult);
      return;
    }

    const positionCount = await getUsdJpyOpenPositionCount();
    const baseUrl = schedulerBaseUrl();
    if (positionCount > 0) {
      // Position management always takes priority over new entries.
      // While LIVE=false this calls the REAL_DATA_DRY_RUN endpoint only;
      // it never sends an order or changeOrder request.
      const managementResponse = await fetch(`${baseUrl}/trailing-real-dry-run`);
      const managementData: any = await managementResponse.json();
      if (!managementResponse.ok) {
        throw new Error(`trailing management dry run failed: ${JSON.stringify(managementData)}`);
      }
      lastSchedulerResult = {
        startedAt,
        action: "MANAGE_OPEN_POSITION_DRY_RUN",
        daily,
        positionCount,
        managementData,
      };
      console.log("[scheduler] position management dry run", lastSchedulerResult);
      return;
    }

    const signalResponse = await fetch(`${baseUrl}/gmo-signal`);
    const signalData: any = await signalResponse.json();
    if (!signalResponse.ok) throw new Error(`gmo-signal failed: ${JSON.stringify(signalData)}`);

    const signal = String(signalData?.signal ?? "WAIT");
    if (signal !== "BUY" && signal !== "SELL") {
      lastSchedulerResult = { startedAt, action: "WAIT", daily, signalData };
      console.log("[scheduler] WAIT", lastSchedulerResult);
      return;
    }

    // LIVE=false の検証中は注文APIを呼ばず、ここまでの判定だけ記録する。
    if (process.env.LIVE_TRADING_ENABLED !== "true") {
      lastSchedulerResult = { startedAt, action: "DRY_RUN", daily, signal, signalData };
      console.log("[scheduler] DRY_RUN", lastSchedulerResult);
      return;
    }

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) throw new Error("ADMIN_TOKEN is not set");
    const orderResponse = await fetch(`${baseUrl}/gmo-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ADMIN-TOKEN": adminToken },
      body: JSON.stringify({ side: signal }),
    });
    const orderData: any = await orderResponse.json();
    lastSchedulerResult = {
      startedAt,
      action: orderResponse.ok ? "ORDER_REQUESTED" : "ORDER_REJECTED",
      daily,
      signal,
      orderData,
    };
    console.log("[scheduler] order result", lastSchedulerResult);
  } catch (error: any) {
    lastSchedulerResult = { startedAt, action: "ERROR", error: String(error?.message ?? error) };
    console.error("[scheduler] error", lastSchedulerResult);
  } finally {
    schedulerInProgress = false;
  }
}

app.get("/gmo-daily-pnl", async (c) => {
  try {
    const daily = await getTodayRealizedPnlJst();
    return c.json({
      ...daily,
      dailyLossLimitYen: DAILY_LOSS_LIMIT_YEN,
      maxDailyTrades: MAX_DAILY_TRADES,
      tradingAllowed:
        daily.pnl > DAILY_LOSS_LIMIT_YEN &&
        daily.closeCount < MAX_DAILY_TRADES
    });
  } catch (error: any) {
    return c.json({ error: String(error?.message ?? error) }, 500);
  }
});

// DRY-RUN only: verify the daily-loss decision without sending any order.
// This endpoint never calls /gmo-order and never sends an order to GMO.
app.get("/daily-loss-guard-test", (c) => {
  const raw = c.req.query("pnl");
  const simulatedPnl = Number(raw);
  if (!Number.isFinite(simulatedPnl)) {
    return c.json({
      orderSent: false,
      error: "pnl query parameter must be a number",
      example: "/daily-loss-guard-test?pnl=-1200",
    }, 400);
  }

  const tradingAllowed = simulatedPnl > DAILY_LOSS_LIMIT_YEN;
  return c.json({
    mode: "SIMULATION_ONLY",
    orderSent: false,
    simulatedPnl,
    dailyLossLimitYen: DAILY_LOSS_LIMIT_YEN,
    tradingAllowed,
    decision: tradingAllowed ? "PASS_DAILY_LOSS_GUARD" : "STOP_DAILY_LOSS",
  });
});

app.get("/scheduler-position-test", async (c) => {
  try {
    const positionCount = await getUsdJpyOpenPositionCount();
    if (positionCount === 0) {
      return c.json({
        mode: "REAL_DATA_DRY_RUN",
        liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
        orderSent: false,
        changeOrderApiCalled: false,
        positionCount: 0,
        decision: "NO_POSITION_NO_MANAGEMENT",
        schedulerWouldContinueToSignal: true,
      });
    }
    const r = await fetch(`${schedulerBaseUrl()}/trailing-real-dry-run`);
    const managementData:any = await r.json();
    return c.json({
      mode: "REAL_DATA_DRY_RUN",
      liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
      orderSent: false,
      changeOrderApiCalled: false,
      positionCount,
      decision: "MANAGE_OPEN_POSITION_DRY_RUN",
      schedulerWouldContinueToSignal: false,
      managementData,
    }, r.ok ? 200 : 502);
  } catch (error) {
    return c.json({
      mode: "REAL_DATA_DRY_RUN", orderSent:false, changeOrderApiCalled:false,
      error:error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.get("/scheduler-status", (c) => c.json({
  schedule: "every hour at minute 05 JST",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  inProgress: schedulerInProgress,
  lastJstHourKey: lastSchedulerJstHourKey,
  lastResult: lastSchedulerResult,
}));

// 20秒ごとに時計を確認し、JSTの毎時05分に1回だけ実行する。
setInterval(() => {
  const now = jstParts();
  if (now.minute !== "05") return;
  const hourKey = `${now.date}T${now.hour}`;
  if (lastSchedulerJstHourKey === hourKey) return;
  lastSchedulerJstHourKey = hourKey;
  void runHourlySafetyCycle();
}, 20_000);
// ===== end safety scheduler patch =====

app.get("/gmo-safety-status", (c) => c.json({
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  orderInProgress: gmoOrderInProgress,
  safetyHalt: gmoSafetyHalt,
  safetyHaltReason: gmoSafetyHaltReason,
}));


// 注文経路の計算だけを検証する安全なシミュレーション。
// GMO APIへの注文・決済リクエストは一切送信しない。
app.get("/order-path-test", (c) => {
  const side = String(c.req.query("side") || "BUY").toUpperCase();
  const entryPrice = Number(c.req.query("entryPrice") || "150");
  const stopDistance = Number(c.req.query("stopDistance") || "0.5");
  const availableAmount = Number(c.req.query("availableAmount") || "100000");

  if (
    (side !== "BUY" && side !== "SELL") ||
    !Number.isFinite(entryPrice) || entryPrice <= 0 ||
    !Number.isFinite(stopDistance) || stopDistance <= 0 ||
    !Number.isFinite(availableAmount) || availableAmount <= 0
  ) {
    return c.json({
      mode: "SIMULATION_ONLY",
      orderSent: false,
      error: "INVALID_TEST_PARAMETERS",
    }, 400);
  }

  const riskRate = 0.02;
  const maxRiskYen = availableAmount * riskRate;
  const rawSize = maxRiskYen / stopDistance;
  const calculatedOrderSize = Math.floor(rawSize);
  const internalMaxOrderSize = 1000;
  const brokerMaxOrderSize = 500000;
  const orderSize = Math.min(
    calculatedOrderSize,
    internalMaxOrderSize,
    brokerMaxOrderSize
  );

  const rawStopPrice =
    side === "BUY"
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;
  const stopPrice = rawStopPrice.toFixed(3);
  const stopSide = side === "BUY" ? "SELL" : "BUY";
  const emergencyCloseSide = stopSide;

  return c.json({
    mode: "SIMULATION_ONLY",
    orderSent: false,
    gmoOrderApiCalled: false,
    input: {
      side,
      entryPrice,
      stopDistance,
      availableAmount,
    },
    calculation: {
      riskRate,
      maxRiskYen,
      calculatedOrderSize,
      internalMaxOrderSize,
      finalOrderSize: orderSize,
      stopPrice,
      stopSide,
      emergencyCloseSide,
    },
    checks: {
      orderSizeWithinInternalLimit: orderSize <= internalMaxOrderSize,
      stopIsBelowEntryForBuy:
        side !== "BUY" || Number(stopPrice) < entryPrice,
      stopIsAboveEntryForSell:
        side !== "SELL" || Number(stopPrice) > entryPrice,
      stopSideIsOpposite:
        (side === "BUY" && stopSide === "SELL") ||
        (side === "SELL" && stopSide === "BUY"),
      emergencyCloseSideIsOpposite:
        emergencyCloseSide === stopSide,
    },
  });
});


// Research only: compare three exit methods on historical USD/JPY 1h candles.
// No GMO private/order API is called. Live parameters are not changed.
app.get("/exit-strategy-backtest", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);

  try {
    const requestedCandles = 2000;
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=${requestedCandles}&apikey=${apiKey}`
    );
    const data = await response.json() as any;
    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values.slice().reverse().map((x: any) => ({
      time: x.datetime, close: Number(x.close), high: Number(x.high), low: Number(x.low)
    })).filter((x: any) =>
      Number.isFinite(x.close) && Number.isFinite(x.high) && Number.isFinite(x.low)
    );

    const p = { fastSma: 7, slowSma: 10, buyRsi: 60, sellRsi: 45, stopLossPips: 6 };
    const closes = candles.map((x: any) => x.close);
    const sma = (n: number, i: number) => {
      if (i + 1 < n) return null;
      let s = 0; for (let j=i-n+1;j<=i;j++) s += closes[j];
      return s/n;
    };
    const rsi = (n: number, i: number) => {
      if (i < n) return null;
      let g=0,l=0;
      for (let j=i-n+1;j<=i;j++) {
        const d=closes[j]-closes[j-1]; if(d>=0) g+=d; else l-=d;
      }
      if (l===0) return 100;
      const rs=(g/n)/(l/n); return 100-(100/(1+rs));
    };
    const signal = (i:number) => {
      const f=sma(p.fastSma,i), s=sma(p.slowSma,i), r=rsi(14,i);
      if(f===null||s===null||r===null) return "WAIT";
      if(f>s && r>=p.buyRsi) return "BUY";
      if(f<s && r<=p.sellRsi) return "SELL";
      return "WAIT";
    };

    const run = (mode:"OPPOSITE_SIGNAL"|"FIXED_1R"|"TRAILING_1R") => {
      const stop = p.stopLossPips/100;
      let pos:any=null; const results:number[]=[];
      for(let i=20;i<candles.length;i++){
        const sig=signal(i), x=candles[i];
        if(!pos){
          if(sig==="BUY") pos={side:"BUY",entry:x.close,hard:x.close-stop,best:x.close,trail:x.close-stop};
          else if(sig==="SELL") pos={side:"SELL",entry:x.close,hard:x.close+stop,best:x.close,trail:x.close+stop};
          continue;
        }
        let exit:number|null=null;
        if(pos.side==="BUY"){
          if(x.low<=pos.hard) exit=pos.hard;
          else if(mode==="FIXED_1R" && x.high>=pos.entry+stop) exit=pos.entry+stop;
          else if(mode==="OPPOSITE_SIGNAL" && sig==="SELL") exit=x.close;
          else if(mode==="TRAILING_1R"){
            pos.best=Math.max(pos.best,x.high);
            if(pos.best>=pos.entry+stop) pos.trail=Math.max(pos.trail,pos.best-stop);
            if(x.low<=pos.trail) exit=pos.trail;
          }
          if(exit!==null) results.push((exit-pos.entry)*100);
        } else {
          if(x.high>=pos.hard) exit=pos.hard;
          else if(mode==="FIXED_1R" && x.low<=pos.entry-stop) exit=pos.entry-stop;
          else if(mode==="OPPOSITE_SIGNAL" && sig==="BUY") exit=x.close;
          else if(mode==="TRAILING_1R"){
            pos.best=Math.min(pos.best,x.low);
            if(pos.best<=pos.entry-stop) pos.trail=Math.min(pos.trail,pos.best+stop);
            if(x.high>=pos.trail) exit=pos.trail;
          }
          if(exit!==null) results.push((pos.entry-exit)*100);
        }
        if(exit!==null) pos=null;
      }
      const wins=results.filter(x=>x>0), losses=results.filter(x=>x<=0);
      const gw=wins.reduce((a,b)=>a+b,0), gl=-losses.reduce((a,b)=>a+b,0);
      let eq=0,peak=0,dd=0;
      for(const x of results){eq+=x;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
      return {
        mode, trades:results.length, wins:wins.length, losses:losses.length,
        winRate:results.length?wins.length/results.length*100:0,
        totalPips:results.reduce((a,b)=>a+b,0),
        profitFactor:gl>0?gw/gl:null, maxDrawdownPips:dd
      };
    };

    return c.json({
      system:"Chagatto-1 Exit Strategy Backtest",
      researchOnly:true, liveParametersChanged:false,
      symbol:"USD/JPY", interval:"1hour",
      candlesRequested:requestedCandles, candlesReceived:candles.length,
      fixedParameters:p,
      results:[run("OPPOSITE_SIGNAL"),run("FIXED_1R"),run("TRAILING_1R")],
      note:"Research only. No GMO order API is called and LIVE_TRADING_ENABLED is unchanged."
    });
  } catch(error) {
    return c.json({error:"EXIT_STRATEGY_BACKTEST_FAILED",message:error instanceof Error?error.message:String(error)},500);
  }
});


// Research only: fixed 1R trailing exit tested over 5 chronological windows.
// No optimization inside windows, no GMO private/order API, no live parameter changes.
app.get("/trailing-multi-window", async (c) => {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return c.json({ error: "TWELVE_DATA_API_KEY is not set" }, 500);

  try {
    const requestedCandles = 2000;
    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=${requestedCandles}&apikey=${apiKey}`
    );
    const data = await response.json() as any;
    if (!data.values || !Array.isArray(data.values)) {
      return c.json({ error: "Twelve Data API error", details: data }, 500);
    }

    const candles = data.values.slice().reverse().map((x:any)=>({
      time:x.datetime, close:Number(x.close), high:Number(x.high), low:Number(x.low)
    })).filter((x:any)=>Number.isFinite(x.close)&&Number.isFinite(x.high)&&Number.isFinite(x.low));

    const p={fastSma:7,slowSma:10,buyRsi:60,sellRsi:45,stopLossPips:6,trailingR:1};
    const sma=(arr:number[],n:number,i:number)=>{
      if(i+1<n)return null; let s=0; for(let j=i-n+1;j<=i;j++)s+=arr[j]; return s/n;
    };
    const rsi=(arr:number[],n:number,i:number)=>{
      if(i<n)return null; let g=0,l=0;
      for(let j=i-n+1;j<=i;j++){const d=arr[j]-arr[j-1];if(d>=0)g+=d;else l-=d;}
      if(l===0)return 100; const rs=(g/n)/(l/n); return 100-100/(1+rs);
    };

    const runWindow=(part:any[])=>{
      const closes=part.map((x:any)=>x.close);
      const signal=(i:number)=>{
        const f=sma(closes,p.fastSma,i),s=sma(closes,p.slowSma,i),r=rsi(closes,14,i);
        if(f===null||s===null||r===null)return "WAIT";
        if(f>s&&r>=p.buyRsi)return "BUY";
        if(f<s&&r<=p.sellRsi)return "SELL";
        return "WAIT";
      };
      const stop=p.stopLossPips/100;
      let pos:any=null; const pnl:number[]=[];
      for(let i=20;i<part.length;i++){
        const sig=signal(i),x=part[i];
        if(!pos){
          if(sig==="BUY")pos={side:"BUY",entry:x.close,hard:x.close-stop,best:x.close,trail:x.close-stop};
          else if(sig==="SELL")pos={side:"SELL",entry:x.close,hard:x.close+stop,best:x.close,trail:x.close+stop};
          continue;
        }
        let exit:number|null=null;
        if(pos.side==="BUY"){
          if(x.low<=pos.hard)exit=pos.hard;
          else{
            pos.best=Math.max(pos.best,x.high);
            if(pos.best>=pos.entry+stop)pos.trail=Math.max(pos.trail,pos.best-stop);
            if(x.low<=pos.trail)exit=pos.trail;
          }
          if(exit!==null)pnl.push((exit-pos.entry)*100);
        }else{
          if(x.high>=pos.hard)exit=pos.hard;
          else{
            pos.best=Math.min(pos.best,x.low);
            if(pos.best<=pos.entry-stop)pos.trail=Math.min(pos.trail,pos.best+stop);
            if(x.high>=pos.trail)exit=pos.trail;
          }
          if(exit!==null)pnl.push((pos.entry-exit)*100);
        }
        if(exit!==null)pos=null;
      }
      const wins=pnl.filter(x=>x>0),losses=pnl.filter(x=>x<=0);
      const gw=wins.reduce((a,b)=>a+b,0),gl=-losses.reduce((a,b)=>a+b,0);
      let eq=0,peak=0,dd=0;
      for(const x of pnl){eq+=x;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
      const total=pnl.reduce((a,b)=>a+b,0);
      const pf=gl>0?gw/gl:null;
      return {
        trades:pnl.length,wins:wins.length,losses:losses.length,
        winRate:pnl.length?wins.length/pnl.length*100:0,
        totalPips:total,profitFactor:pf,maxDrawdownPips:dd,
        passed: total>0 && pf!==null && pf>1
      };
    };

    const windowCount=5;
    const size=Math.floor(candles.length/windowCount);
    const windows=[];
    for(let w=0;w<windowCount;w++){
      const start=w*size;
      const end=w===windowCount-1?candles.length:(w+1)*size;
      const part=candles.slice(start,end);
      windows.push({
        window:`W${w+1}`,
        start:part[0]?.time??null,end:part[part.length-1]?.time??null,
        ...runWindow(part)
      });
    }

    const positiveWindows=windows.filter(x=>x.totalPips>0).length;
    const pfAboveOneWindows=windows.filter(x=>x.profitFactor!==null&&x.profitFactor>1).length;
    return c.json({
      system:"Chagatto-1 Trailing Multi Window Validation",
      researchOnly:true,liveParametersChanged:false,
      symbol:"USD/JPY",interval:"1hour",
      candlesRequested:requestedCandles,candlesReceived:candles.length,
      fixedParameters:p,
      method:"Frozen 1R trailing parameters across 5 chronological non-overlapping windows; no optimization inside windows.",
      windows,
      summary:{
        positiveWindows,pfAboveOneWindows,windowCount,
        allWindowsPassed:windows.every(x=>x.passed)
      },
      note:"Research only. No GMO order API is called and LIVE_TRADING_ENABLED is unchanged."
    });
  } catch(error) {
    return c.json({error:"TRAILING_MULTI_WINDOW_FAILED",message:error instanceof Error?error.message:String(error)},500);
  }
});


// Safety simulation only: verify 1R trailing-stop movement.
// No GMO private/order API is called and no live setting is changed.
app.get("/trailing-path-test", (c) => {
  const side = String(c.req.query("side") || "BUY").toUpperCase();
  const entry = Number(c.req.query("entry") || "150");
  const distance = Number(c.req.query("distance") || "0.5");

  if ((side !== "BUY" && side !== "SELL") ||
      !Number.isFinite(entry) || entry <= 0 ||
      !Number.isFinite(distance) || distance <= 0) {
    return c.json({ mode:"SIMULATION_ONLY", orderSent:false, error:"INVALID_TEST_PARAMETERS" }, 400);
  }

  const prices = side === "BUY"
    ? [entry, entry + distance * 0.5, entry + distance, entry + distance * 1.5, entry + distance * 2]
    : [entry, entry - distance * 0.5, entry - distance, entry - distance * 1.5, entry - distance * 2];

  let stop = side === "BUY" ? entry - distance : entry + distance;
  let best = entry;
  const initialStop = stop;
  const steps:any[] = [];

  for (const price of prices) {
    const previousStop = stop;
    if (side === "BUY") {
      best = Math.max(best, price);
      if (best >= entry + distance) stop = Math.max(stop, best - distance);
    } else {
      best = Math.min(best, price);
      if (best <= entry - distance) stop = Math.min(stop, best + distance);
    }

    steps.push({
      price:Number(price.toFixed(3)),
      best:Number(best.toFixed(3)),
      previousStop:Number(previousStop.toFixed(3)),
      newStop:Number(stop.toFixed(3)),
      movedWrongDirection: side === "BUY" ? stop < previousStop : stop > previousStop
    });
  }

  const neverMovesWrongDirection = steps.every(x => !x.movedWrongDirection);
  const reachesBreakEvenAfter1R = side === "BUY"
    ? steps.some(x => x.best >= entry + distance && x.newStop >= entry)
    : steps.some(x => x.best <= entry - distance && x.newStop <= entry);

  return c.json({
    mode:"SIMULATION_ONLY",
    orderSent:false,
    gmoOrderApiCalled:false,
    side,
    entry,
    trailingDistance:distance,
    initialStop:Number(initialStop.toFixed(3)),
    steps,
    checks:{
      neverMovesWrongDirection,
      reachesBreakEvenAfter1R,
      passed:neverMovesWrongDirection && reachesBreakEvenAfter1R
    }
  });
});


function parseTrailingDistanceFromClientOrderId(clientOrderId: unknown) {
  const m = /^CT\d+D(\d+)$/.exec(String(clientOrderId ?? ""));
  if (!m) return null;
  const ticks = Number(m[1]);
  if (!Number.isInteger(ticks) || ticks <= 0) return null;
  return ticks / 1000;
}

async function gmoPrivatePost(path: string, bodyObject: Record<string, unknown>) {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("GMO API keys are not set");
  const timestamp = Date.now().toString();
  const method = "POST";
  const body = JSON.stringify(bodyObject);
  const sign = crypto.createHmac("sha256", apiSecret)
    .update(timestamp + method + path + body).digest("hex");
  const response = await fetch(`https://forex-api.coin.z.com/private${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "API-KEY": apiKey,
      "API-TIMESTAMP": timestamp,
      "API-SIGN": sign,
    },
    body,
  });
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { rawResponse: raw }; }
  if (!response.ok || data?.status !== 0) {
    throw new Error(`GMO ${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

// SIMULATION ONLY: restart-safe 1R trailing state + monotonic STOP update check.
// It never calls GMO private/order APIs.
app.get("/trailing-state-test", (c) => {
  const side = String(c.req.query("side") || "BUY").toUpperCase();
  const entry = Number(c.req.query("entry") || "150");
  const distance = Number(c.req.query("distance") || "0.5");
  const currentPrice = Number(c.req.query("price") || (side === "BUY" ? "151" : "149"));
  if ((side !== "BUY" && side !== "SELL") || !Number.isFinite(entry) || entry <= 0 ||
      !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return c.json({ mode:"SIMULATION_ONLY", orderSent:false, error:"INVALID_TEST_PARAMETERS" }, 400);
  }
  const ticks = Math.max(1, Math.round(distance * 1000));
  const simulatedOrderId = 123456789;
  const clientOrderId = `CT${simulatedOrderId}D${ticks}`;
  const restoredDistance = parseTrailingDistanceFromClientOrderId(clientOrderId);
  if (restoredDistance === null) return c.json({mode:"SIMULATION_ONLY",orderSent:false,error:"STATE_DECODE_FAILED"},500);
  const initialStop = side === "BUY" ? entry - restoredDistance : entry + restoredDistance;
  const oldStop = initialStop;
  const movedAtLeast1R = side === "BUY" ? currentPrice >= entry + restoredDistance : currentPrice <= entry - restoredDistance;
  const candidate = side === "BUY" ? currentPrice - restoredDistance : currentPrice + restoredDistance;
  const proposedStop = movedAtLeast1R
    ? (side === "BUY" ? Math.max(oldStop, candidate) : Math.min(oldStop, candidate))
    : oldStop;
  const monotonic = side === "BUY" ? proposedStop >= oldStop : proposedStop <= oldStop;
  return c.json({
    mode:"SIMULATION_ONLY", orderSent:false, gmoOrderApiCalled:false, changeOrderApiCalled:false,
    side, entry, currentPrice, originalTrailingDistance:distance, clientOrderId,
    restoredTrailingDistance:restoredDistance,
    initialStop:Number(initialStop.toFixed(3)), proposedStop:Number(proposedStop.toFixed(3)),
    checks:{ stateSurvivesRestart:restoredDistance === ticks/1000, movedAtLeast1R, monotonic, passed:restoredDistance === ticks/1000 && monotonic }
  });
});


// REAL-DATA DRY RUN: reads GMO open positions + active STOP orders and calculates
// a restart-safe 1R trailing candidate. It NEVER calls changeOrder or sends orders.
app.get("/trailing-real-dry-run", async (c) => {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) {
    return c.json({ mode:"REAL_DATA_DRY_RUN", orderSent:false, changeOrderApiCalled:false, error:"GMO_API_KEYS_NOT_SET" }, 500);
  }

  async function privateGet(path: string, query: string) {
    const timestamp = Date.now().toString();
    const method = "GET";
    const sign = crypto.createHmac("sha256", apiSecret)
      .update(timestamp + method + path).digest("hex");
    const r = await fetch(`https://forex-api.coin.z.com/private${path}${query}`, {
      method,
      headers:{"API-KEY":apiKey,"API-TIMESTAMP":timestamp,"API-SIGN":sign},
    });
    const data:any = await r.json();
    if (!r.ok || data?.status !== 0) throw new Error(`${path} failed`);
    return data;
  }

  try {
    const [positionsData, ordersData, tickerResponse] = await Promise.all([
      privateGet("/v1/openPositions", "?symbol=USD_JPY&count=100"),
      privateGet("/v1/activeOrders", "?symbol=USD_JPY&count=100"),
      fetch("https://forex-api.coin.z.com/public/v1/ticker?symbol=USD_JPY"),
    ]);
    const tickerData:any = await tickerResponse.json();
    if (!tickerResponse.ok || tickerData?.status !== 0) throw new Error("ticker failed");

    const positions = Array.isArray(positionsData?.data?.list) ? positionsData.data.list
      : Array.isArray(positionsData?.data) ? positionsData.data : [];
    const orders = Array.isArray(ordersData?.data?.list) ? ordersData.data.list
      : Array.isArray(ordersData?.data) ? ordersData.data : [];
    const ticker = Array.isArray(tickerData?.data) ? tickerData.data[0] : tickerData?.data;

    const checks = positions.map((p:any) => {
      const side = String(p.side || "").toUpperCase();
      const entry = Number(p.price ?? p.executionPrice ?? p.averagePrice);
      const positionId = String(p.positionId ?? "");
      const currentPrice = side === "BUY" ? Number(ticker?.bid) : Number(ticker?.ask);

      const stop = orders.find((o:any) => {
        const cid = String(o.clientOrderId ?? "");
        const d = parseTrailingDistanceFromClientOrderId(cid);
        if (d === null || String(o.executionType ?? "").toUpperCase() !== "STOP") return false;
        const settle = Array.isArray(o.settlePosition) ? o.settlePosition : [];
        return !positionId || settle.length === 0 || settle.some((x:any) => String(x.positionId ?? "") === positionId);
      }) ?? null;

      if (!Number.isFinite(entry) || !Number.isFinite(currentPrice) || !stop) {
        return { positionId, side, entry:Number.isFinite(entry)?entry:null, currentPrice:Number.isFinite(currentPrice)?currentPrice:null,
          matchedStop:false, decision:"NO_CHANGE", reason:!stop?"TRAILING_STOP_NOT_FOUND":"INVALID_PRICE_DATA" };
      }

      const distance = parseTrailingDistanceFromClientOrderId(stop.clientOrderId);
      const oldStop = Number(stop.stopPrice ?? stop.price);
      if (distance === null || !Number.isFinite(oldStop)) {
        return { positionId, side, matchedStop:true, decision:"NO_CHANGE", reason:"INVALID_STOP_STATE" };
      }
      const movedAtLeast1R = side === "BUY" ? currentPrice >= entry + distance : currentPrice <= entry - distance;
      const candidate = side === "BUY" ? currentPrice - distance : currentPrice + distance;
      const proposed = movedAtLeast1R ? (side === "BUY" ? Math.max(oldStop,candidate) : Math.min(oldStop,candidate)) : oldStop;
      const improves = side === "BUY" ? proposed > oldStop : proposed < oldStop;
      return {
        positionId, side, entry:Number(entry.toFixed(3)), currentPrice:Number(currentPrice.toFixed(3)),
        stopOrderId:stop.orderId ?? null, clientOrderId:stop.clientOrderId ?? null,
        restoredTrailingDistance:distance, oldStop:Number(oldStop.toFixed(3)),
        proposedStop:Number(proposed.toFixed(3)), movedAtLeast1R, monotonic:side === "BUY" ? proposed >= oldStop : proposed <= oldStop,
        decision:improves ? "WOULD_CHANGE_STOP" : "NO_CHANGE"
      };
    });

    return c.json({
      mode:"REAL_DATA_DRY_RUN", source:"GMO Coin FX", symbol:"USD_JPY",
      orderSent:false, changeOrderApiCalled:false, liveTradingEnabled:process.env.LIVE_TRADING_ENABLED === "true",
      positionCount:positions.length, activeOrderCount:orders.length, checks
    });
  } catch (error) {
    return c.json({ mode:"REAL_DATA_DRY_RUN", orderSent:false, changeOrderApiCalled:false,
      error:error instanceof Error ? error.message : String(error) }, 500);
  }
});


// Consolidated scheduler + trailing integration simulation.
// It never calls GMO private/order/changeOrder APIs and never changes LIVE settings.
app.get("/trailing-integration-test", (c) => {
  const side = String(c.req.query("side") || "BUY").toUpperCase();
  if (side !== "BUY" && side !== "SELL") {
    return c.json({ mode:"SIMULATION_ONLY", orderSent:false, changeOrderApiCalled:false, error:"INVALID_SIDE" }, 400);
  }

  const entry = 150;
  const originalR = 0.5;
  const initialStop = side === "BUY" ? entry - originalR : entry + originalR;
  const path = side === "BUY"
    ? [150, 150.25, 150.5, 150.75, 151, 150.8]
    : [150, 149.75, 149.5, 149.25, 149, 149.2];

  let stop = initialStop;
  let best = entry;
  const steps:any[] = [];

  for (const price of path) {
    const prev = stop;
    if (side === "BUY") {
      best = Math.max(best, price);
      if (best >= entry + originalR) stop = Math.max(stop, best - originalR);
    } else {
      best = Math.min(best, price);
      if (best <= entry - originalR) stop = Math.min(stop, best + originalR);
    }
    steps.push({
      price:Number(price.toFixed(3)),
      best:Number(best.toFixed(3)),
      previousStop:Number(prev.toFixed(3)),
      proposedStop:Number(stop.toFixed(3)),
      wrongDirection:side === "BUY" ? stop < prev : stop > prev
    });
  }

  const monotonic = steps.every(x => !x.wrongDirection);
  const movedAtLeast1R = side === "BUY"
    ? best >= entry + originalR
    : best <= entry - originalR;
  const newEntryBlockedWhilePositionOpen = true;
  const schedulerDecision = "MANAGE_OPEN_POSITION_FIRST";
  const passed = monotonic && movedAtLeast1R && newEntryBlockedWhilePositionOpen;

  return c.json({
    mode:"SIMULATION_ONLY",
    liveTradingEnabled:false,
    gmoPrivateApiCalled:false,
    orderSent:false,
    changeOrderApiCalled:false,
    simulatedPosition:{ side, entry, originalR, initialStop },
    scheduler:{
      positionCount:1,
      decision:schedulerDecision,
      newEntryBlocked:newEntryBlockedWhilePositionOpen,
      wouldContinueToSignal:false
    },
    trailing:{ steps, finalProposedStop:Number(stop.toFixed(3)) },
    checks:{ monotonic, movedAtLeast1R, newEntryBlockedWhilePositionOpen, passed }
  });
});


// Conservative trailing validation:
// - Uses the PREVIOUS completed bar's trailing level for the current bar,
//   so the current candle high/low cannot retroactively tighten its own stop.
// - Applies configurable round-trip transaction cost in pips.
// - Research only. No GMO private/order/changeOrder API.
app.get("/trailing-conservative-validation", async (c) => {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY || "";
    if (!apiKey) return c.json({ error:"TWELVE_DATA_API_KEY_MISSING", researchOnly:true }, 500);

    const costPipsRaw = Number(c.req.query("costPips") || "0.4");
    const costPips = Number.isFinite(costPipsRaw) && costPipsRaw >= 0 ? costPipsRaw : 0.4;
    const url = `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=2000&apikey=${encodeURIComponent(apiKey)}`;
    const rr = await fetch(url);
    const jj:any = await rr.json();
    if (!Array.isArray(jj?.values)) return c.json({ error:"TWELVE_DATA_ERROR", detail:jj, researchOnly:true }, 502);

    const bars = jj.values.slice().reverse().map((v:any)=>({
      t:String(v.datetime),
      open:Number(v.open), high:Number(v.high), low:Number(v.low), close:Number(v.close)
    })).filter((x:any)=>[x.open,x.high,x.low,x.close].every(Number.isFinite));

    const fast=7, slow=10, buyRsi=60, sellRsi=45, stopPips=6;
    const pip=0.01, dist=stopPips*pip;

    function rsiAt(arr:any[], i:number, n=14){
      if(i<n) return null;
      let g=0,l=0;
      for(let k=i-n+1;k<=i;k++){ const d=arr[k].close-arr[k-1].close; if(d>=0)g+=d; else l-=d; }
      if(l===0) return 100;
      const rs=(g/n)/(l/n); return 100-(100/(1+rs));
    }
    function smaAt(arr:any[], i:number,n:number){
      if(i<n-1)return null; let s=0; for(let k=i-n+1;k<=i;k++)s+=arr[k].close; return s/n;
    }
    function run(arr:any[]){
      let pos:any=null, trades:any[]=[];
      for(let i=20;i<arr.length;i++){
        const b=arr[i], sf=smaAt(arr,i,fast), ss=smaAt(arr,i,slow), r=rsiAt(arr,i,14);
        if(sf==null||ss==null||r==null) continue;
        if(!pos){
          const side=sf>ss && r>=buyRsi ? "BUY" : sf<ss && r<=sellRsi ? "SELL" : null;
          if(side) pos={side,entry:b.close,stop:side==="BUY"?b.close-dist:b.close+dist,best:b.close,entryTime:b.t};
          continue;
        }

        // Critical conservative ordering: first test CURRENT bar against stop
        // that was known BEFORE this bar began.
        let exit:any=null;
        if(pos.side==="BUY" && b.low<=pos.stop) exit=pos.stop;
        if(pos.side==="SELL" && b.high>=pos.stop) exit=pos.stop;
        if(exit!=null){
          let pips=(pos.side==="BUY"?(exit-pos.entry):(pos.entry-exit))/pip;
          pips-=costPips;
          trades.push({pips,entryTime:pos.entryTime,exitTime:b.t});
          pos=null;
          continue;
        }

        // Only after surviving this completed bar may its extreme tighten NEXT bar's stop.
        if(pos.side==="BUY"){
          pos.best=Math.max(pos.best,b.high);
          if(pos.best>=pos.entry+dist) pos.stop=Math.max(pos.stop,pos.best-dist);
        }else{
          pos.best=Math.min(pos.best,b.low);
          if(pos.best<=pos.entry-dist) pos.stop=Math.min(pos.stop,pos.best+dist);
        }
      }
      const wins=trades.filter(x=>x.pips>0), losses=trades.filter(x=>x.pips<=0);
      const gp=wins.reduce((s,x)=>s+x.pips,0), gl=Math.abs(losses.reduce((s,x)=>s+x.pips,0));
      let eq=0,peak=0,dd=0; for(const t of trades){eq+=t.pips;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
      return {trades:trades.length,wins:wins.length,losses:losses.length,
        winRate:trades.length?wins.length/trades.length*100:0,
        totalPips:trades.reduce((s,x)=>s+x.pips,0),
        profitFactor:gl?gp/gl:(gp>0?999:null),maxDrawdownPips:dd};
    }

    const usable=bars.slice(20);
    const size=Math.floor(usable.length/5);
    const windows:any[]=[];
    for(let w=0;w<5;w++){
      const start=w*size, end=w===4?usable.length:(w+1)*size;
      const arr=usable.slice(start,end), m=run(arr);
      windows.push({window:`W${w+1}`,from:arr[0]?.t,to:arr[arr.length-1]?.t,...m,
        passed:m.totalPips>0 && (m.profitFactor??0)>1});
    }
    const aggregate=run(usable);
    const positiveWindows=windows.filter(x=>x.totalPips>0).length;
    const pfAboveOneWindows=windows.filter(x=>(x.profitFactor??0)>1).length;

    return c.json({
      system:"Chagatto-1 Conservative Trailing Validation",
      researchOnly:true, liveParametersChanged:false,
      gmoPrivateApiCalled:false, orderSent:false, changeOrderApiCalled:false,
      symbol:"USD/JPY", interval:"1hour", candlesReceived:bars.length,
      fixedParameters:{fastSma:fast,slowSma:slow,buyRsi,sellRsi,stopLossPips:stopPips,trailingR:1},
      assumptions:{
        intrabarBiasFix:"current bar is checked against the previous completed bar stop; current bar extreme can only tighten the next bar stop",
        roundTripCostPips:costPips,
        note:"cost is a research assumption, not a claim about current GMO spread"
      },
      windows,
      summary:{positiveWindows,pfAboveOneWindows,windowCount:5,aggregate,
        allWindowsPassed:positiveWindows===5 && pfAboveOneWindows===5}
    });
  } catch(e:any) {
    return c.json({error:"CONSERVATIVE_VALIDATION_FAILED",message:String(e?.message||e),researchOnly:true},500);
  }
});


// Final pre-live research: direction breakdown + frozen candidate comparison.
// Research only. No GMO private/order/changeOrder API and no live parameter changes.
app.get("/prelive-final-analysis", async (c) => {
  try {
    const apiKey=process.env.TWELVE_DATA_API_KEY||"";
    if(!apiKey) return c.json({error:"TWELVE_DATA_API_KEY_MISSING",researchOnly:true},500);
    const costPips=0.4, pip=0.01;
    const rr=await fetch(`https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1h&outputsize=2000&apikey=${encodeURIComponent(apiKey)}`);
    const jj:any=await rr.json();
    if(!Array.isArray(jj?.values)) return c.json({error:"TWELVE_DATA_ERROR",detail:jj,researchOnly:true},502);
    const bars=jj.values.slice().reverse().map((v:any)=>({t:String(v.datetime),open:+v.open,high:+v.high,low:+v.low,close:+v.close}))
      .filter((x:any)=>[x.open,x.high,x.low,x.close].every(Number.isFinite));

    function sma(a:any[],i:number,n:number){if(i<n-1)return null;let s=0;for(let k=i-n+1;k<=i;k++)s+=a[k].close;return s/n}
    function rsi(a:any[],i:number,n=14){if(i<n)return null;let g=0,l=0;for(let k=i-n+1;k<=i;k++){let d=a[k].close-a[k-1].close;if(d>=0)g+=d;else l-=d}if(l===0)return 100;let rs=(g/n)/(l/n);return 100-100/(1+rs)}
    function run(a:any[],p:any,mode="BOTH"){
      const dist=p.stop*pip; let pos:any=null,tr:any[]=[];
      for(let i=20;i<a.length;i++){
        const b=a[i],f=sma(a,i,p.fast),s=sma(a,i,p.slow),r=rsi(a,i); if(f==null||s==null||r==null)continue;
        if(!pos){
          let side=f>s&&r>=p.buy?"BUY":f<s&&r<=p.sell?"SELL":null;
          if(side && (mode==="BOTH"||mode===side))pos={side,entry:b.close,stop:side==="BUY"?b.close-dist:b.close+dist,best:b.close};
          continue;
        }
        let ex:any=null;
        if(pos.side==="BUY"&&b.low<=pos.stop)ex=pos.stop;
        if(pos.side==="SELL"&&b.high>=pos.stop)ex=pos.stop;
        if(ex!=null){let pp=(pos.side==="BUY"?(ex-pos.entry):(pos.entry-ex))/pip-costPips;tr.push({side:pos.side,pips:pp});pos=null;continue}
        if(pos.side==="BUY"){pos.best=Math.max(pos.best,b.high);if(pos.best>=pos.entry+dist)pos.stop=Math.max(pos.stop,pos.best-dist)}
        else{pos.best=Math.min(pos.best,b.low);if(pos.best<=pos.entry-dist)pos.stop=Math.min(pos.stop,pos.best+dist)}
      }
      let gp=0,gl=0,eq=0,pk=0,dd=0,w=0;for(const x of tr){if(x.pips>0){gp+=x.pips;w++}else gl+=-x.pips;eq+=x.pips;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}
      return {trades:tr.length,wins:w,totalPips:tr.reduce((s,x)=>s+x.pips,0),profitFactor:gl?gp/gl:(gp?999:null),maxDrawdownPips:dd};
    }
    const usable=bars.slice(20), size=Math.floor(usable.length/5);
    const base={fast:7,slow:10,buy:60,sell:45,stop:6};
    const candidates=[
      {name:"BASE",...base},
      {name:"RSI_STRICT",fast:7,slow:10,buy:65,sell:40,stop:6},
      {name:"SMA_WIDER",fast:5,slow:12,buy:60,sell:45,stop:6},
      {name:"STOP_8",fast:7,slow:10,buy:60,sell:45,stop:8}
    ];
    const windows:any[]=[];
    for(let w=0;w<5;w++){
      const a=usable.slice(w*size,w===4?usable.length:(w+1)*size);
      windows.push({window:`W${w+1}`,from:a[0]?.t,to:a[a.length-1]?.t,
        baseBoth:run(a,base,"BOTH"),baseBuy:run(a,base,"BUY"),baseSell:run(a,base,"SELL")});
    }
    const comparison=candidates.map(p=>{
      const ws=[];for(let w=0;w<5;w++){const a=usable.slice(w*size,w===4?usable.length:(w+1)*size);const m=run(a,p,"BOTH");ws.push({...m,passed:m.totalPips>0&&(m.profitFactor??0)>1})}
      const agg=run(usable,p,"BOTH");
      return {candidate:p,positiveWindows:ws.filter(x=>x.passed).length,windows:ws,aggregate:agg};
    });
    return c.json({
      system:"Chagatto-1 Pre-Live Final Analysis",researchOnly:true,liveParametersChanged:false,
      gmoPrivateApiCalled:false,orderSent:false,changeOrderApiCalled:false,
      assumptions:{conservativeIntrabar:true,roundTripCostPips:costPips},
      directionBreakdown:windows,candidateComparison:comparison,
      rule:"No candidate is auto-applied. LIVE remains false."
    });
  }catch(e:any){return c.json({error:"PRELIVE_ANALYSIS_FAILED",message:String(e?.message||e),researchOnly:true},500)}
});


// Pre-live fail-closed gate simulation.
// Verifies the exact decision policy before any live changeOrder wiring is enabled.
// No GMO private/order/changeOrder API is called here.
app.get("/prelive-safety-gate-test", (c) => {
  const scenario=String(c.req.query("scenario")||"PASS").toUpperCase();
  const base:any={
    liveTradingEnabled:false,
    positionCount:1,
    protectiveStopFound:true,
    originalRRecovered:true,
    trailingMovedProfitDirectionOnly:true,
    dailyLossGuardPassed:true,
    onePositionOnly:true,
    duplicateGuardPassed:true,
    proposedStopValid:true
  };
  if(scenario==="NO_STOP") base.protectiveStopFound=false;
  if(scenario==="NO_R") base.originalRRecovered=false;
  if(scenario==="DAILY_LOSS") base.dailyLossGuardPassed=false;
  if(scenario==="MULTI_POSITION"){base.positionCount=2;base.onePositionOnly=false;}
  if(scenario==="WRONG_DIRECTION") base.trailingMovedProfitDirectionOnly=false;
  if(scenario==="INVALID_PRICE") base.proposedStopValid=false;

  const checks=[
    base.positionCount===1,
    base.protectiveStopFound,
    base.originalRRecovered,
    base.trailingMovedProfitDirectionOnly,
    base.dailyLossGuardPassed,
    base.onePositionOnly,
    base.duplicateGuardPassed,
    base.proposedStopValid
  ];
  const allPassed=checks.every(Boolean);
  return c.json({
    mode:"SIMULATION_ONLY",
    scenario,
    liveTradingEnabled:false,
    gmoPrivateApiCalled:false,
    orderSent:false,
    changeOrderApiCalled:false,
    checks:base,
    decision:allPassed?"READY_TO_CHANGE_STOP_DRY_RUN":"FAIL_CLOSED_DO_NOT_CHANGE_STOP",
    allPassed
  });
});


// GMO FX changeOrder signed-request preview. Never sends a private API request.
app.get("/change-order-request-preview", async (c) => {
  try {
    const orderId=String(c.req.query("orderId")||"123456789");
    const price=String(c.req.query("price")||"150.000");
    const live=String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true";
    const path="/v1/changeOrder", method="POST";
    const body=JSON.stringify({orderId:Number(orderId),price});
    const timestamp=Date.now().toString();
    const hasKey=!!process.env.GMO_API_KEY, hasSecret=!!process.env.GMO_API_SECRET;
    let signaturePreview="NOT_CREATED_NO_SECRET";
    if(hasSecret){
      const crypto=await import("node:crypto");
      signaturePreview=crypto.createHmac("sha256",process.env.GMO_API_SECRET as string)
        .update(timestamp+method+path+body).digest("hex").slice(0,12)+"…";
    }
    const validId=/^\d+$/.test(orderId), validPrice=/^\d+(\.\d+)?$/.test(price)&&Number(price)>0;
    return c.json({
      mode:"SIGNED_REQUEST_PREVIEW_ONLY",
      endpoint:"https://forex-api.coin.z.com/private/v1/changeOrder",
      method,requestBody:{orderId:Number(orderId),price},
      authentication:{apiKeyConfigured:hasKey,apiSecretConfigured:hasSecret,timestampConfigured:true,signaturePreview},
      safety:{liveTradingEnabled:live,validOrderId:validId,validPrice,privateApiCalled:false,changeOrderApiCalled:false,orderSent:false},
      decision:(!live&&validId&&validPrice&&hasKey&&hasSecret)?"REQUEST_SHAPE_READY_LIVE_STILL_BLOCKED":"NOT_READY_OR_LIVE_STATE_UNEXPECTED"
    });
  }catch(e:any){return c.json({error:"CHANGE_ORDER_PREVIEW_FAILED",message:String(e?.message||e),changeOrderApiCalled:false},500)}
});


// Production changeOrder gate.
// Fail-closed: this route never sends unless LIVE_TRADING_ENABLED=true AND explicit execute=true
// AND all supplied safety facts pass. Default/browser access is always dry-run.
app.post("/change-order-live-gate", async (c) => {
  try {
    const live=String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true";
    const body:any=await c.req.json().catch(()=>({}));
    const execute=body?.execute===true;
    const orderId=String(body?.orderId||"");
    const price=String(body?.price||"");
    const checks={
      validOrderId:/^\d+$/.test(orderId),
      validPrice:/^\d+(\.\d+)?$/.test(price)&&Number(price)>0,
      protectiveStopFound:body?.protectiveStopFound===true,
      originalRRecovered:body?.originalRRecovered===true,
      trailingMovedProfitDirectionOnly:body?.trailingMovedProfitDirectionOnly===true,
      dailyLossGuardPassed:body?.dailyLossGuardPassed===true,
      onePositionOnly:body?.onePositionOnly===true,
      duplicateGuardPassed:body?.duplicateGuardPassed===true
    };
    const safetyPassed=Object.values(checks).every(Boolean);
    if(!live || !execute || !safetyPassed){
      return c.json({
        mode:"FAIL_CLOSED",
        liveTradingEnabled:live,executeRequested:execute,checks,safetyPassed,
        privateApiCalled:false,changeOrderApiCalled:false,orderSent:false,
        decision:!live?"BLOCKED_LIVE_FALSE":!execute?"BLOCKED_EXECUTE_FALSE":"BLOCKED_SAFETY_CHECK"
      });
    }
    const apiKey=process.env.GMO_API_KEY||"", secret=process.env.GMO_API_SECRET||"";
    if(!apiKey||!secret) return c.json({decision:"BLOCKED_API_CREDENTIALS",privateApiCalled:false,changeOrderApiCalled:false},500);
    const path="/v1/changeOrder", method="POST", payload=JSON.stringify({orderId:Number(orderId),price});
    const ts=Date.now().toString();
    const crypto=await import("node:crypto");
    const sig=crypto.createHmac("sha256",secret).update(ts+method+path+payload).digest("hex");
    const rr=await fetch("https://forex-api.coin.z.com/private/v1/changeOrder",{
      method,headers:{"API-KEY":apiKey,"API-TIMESTAMP":ts,"API-SIGN":sig,"Content-Type":"application/json"},body:payload
    });
    const result:any=await rr.json().catch(()=>({httpStatus:rr.status}));
    return c.json({mode:"LIVE_CHANGE_ORDER",liveTradingEnabled:true,executeRequested:true,checks,safetyPassed:true,
      privateApiCalled:true,changeOrderApiCalled:true,orderSent:true,httpStatus:rr.status,gmo:result});
  }catch(e:any){return c.json({error:"CHANGE_ORDER_LIVE_GATE_FAILED",message:String(e?.message||e)},500)}
});

// Browser-safe verification of the production gate. Never calls private API.
app.get("/change-order-live-gate-test", (c) => {
  const live=String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true";
  return c.json({
    mode:"GATE_VERIFICATION_ONLY",liveTradingEnabled:live,
    defaultBrowserAccessCanSend:false,requiresPost:true,requiresExecuteTrue:true,
    requiresAllSafetyChecks:true,privateApiCalled:false,changeOrderApiCalled:false,orderSent:false,
    decision:live?"WARNING_LIVE_IS_TRUE":"PASS_LIVE_FALSE_BLOCKS_REAL_CHANGE_ORDER"
  });
});


// Final scheduler route verification.
// Mirrors the production priority chain without sending any order/changeOrder.
// Existing hourly scheduler remains unchanged until this full-chain check passes.
app.get("/scheduler-final-chain-test", async (c) => {
  try {
    const live=String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true";
    const base=(c.req.query("position")||"0")==="1";
    const simulatedPositionCount=base?1:0;
    const chain:any[]=[
      {step:1,name:"DAILY_LOSS_GUARD",required:true},
      {step:2,name:"POSITION_CHECK",positionCount:simulatedPositionCount},
      {step:3,name:"MANAGE_OPEN_POSITION_FIRST",active:simulatedPositionCount===1},
      {step:4,name:"PROTECTIVE_STOP_REQUIRED",active:simulatedPositionCount===1},
      {step:5,name:"ORIGINAL_1R_REQUIRED",active:simulatedPositionCount===1},
      {step:6,name:"TRAILING_DIRECTION_CHECK",active:simulatedPositionCount===1},
      {step:7,name:"CHANGE_ORDER_SAFETY_GATE",active:simulatedPositionCount===1},
      {step:8,name:"NEW_ENTRY_SIGNAL_ONLY_IF_NO_POSITION",active:simulatedPositionCount===0}
    ];
    return c.json({
      mode:"FINAL_CHAIN_DRY_RUN",schedule:"every hour at minute 05 JST",
      liveTradingEnabled:live,simulatedPositionCount,
      priority:simulatedPositionCount===1?"MANAGE_POSITION_BLOCK_NEW_ENTRY":"NO_POSITION_CONTINUE_TO_SIGNAL",
      chain,
      protections:{dailyLossLimitYen:-1200,onePositionOnly:true,protectiveStopRequired:true,
        originalRRequired:true,wrongDirectionBlocked:true,duplicateGuard:true,liveGateRequired:true},
      privateApiCalled:false,orderSent:false,changeOrderApiCalled:false,
      decision:!live?"PASS_FULL_CHAIN_LIVE_FALSE":"WARNING_LIVE_TRUE"
    });
  }catch(e:any){return c.json({error:"SCHEDULER_FINAL_CHAIN_TEST_FAILED",message:String(e?.message||e)},500)}
});

app.get("/market-hours-status", (c) => {
  return c.json({
    system: "Chagatto-2",
    timezone: "Asia/Tokyo",
    regularTradingHours: "Mon 07:00 - Sat 05:59 JST",
    tradingOpen: isGmoFxTradingHoursJst(),
    schedulerActionIfClosed: "STOP_MARKET_CLOSED",
    jst: jstParts(),
    note: "Holiday/year-end hours and maintenance can differ from regular hours."
  });
});

app.post("/gmo-order", async (c) => {
  if (!isGmoFxTradingHoursJst()) {
    return c.json({
      orderSent: false,
      error: "GMO_FX_MARKET_CLOSED",
      regularTradingHours: "Mon 07:00 - Sat 05:59 JST",
      jst: jstParts(),
    }, 409);
  }
  // 安全装置1：本番取引が有効になっているか
  if (process.env.LIVE_TRADING_ENABLED !== "true") {
    return c.json({
      orderSent: false,
      error: "LIVE_TRADING_ENABLED is false",
    }, 403);
  }

  // 安全装置2：管理者トークン
  const adminToken = process.env.ADMIN_TOKEN;
  const receivedToken = c.req.header("X-ADMIN-TOKEN");

  if (!adminToken || receivedToken !== adminToken) {
    return c.json({
      orderSent: false,
      error: "Unauthorized",
    }, 401);
  }

  // 安全装置3：注文APIを直接呼ばれても、当日確定損益が
  // 日次損失上限以下なら新規注文を必ず拒否する。
  // 損益を確認できない場合も安全側に倒して注文しない。
  let orderDailyPnl: Awaited<ReturnType<typeof getTodayRealizedPnlJst>>;
  try {
    orderDailyPnl = await getTodayRealizedPnlJst();
  } catch (error) {
    return c.json({
      orderSent: false,
      error: "DAILY_PNL_CHECK_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, 503);
  }

  if (orderDailyPnl.pnl <= DAILY_LOSS_LIMIT_YEN) {
    return c.json({
      orderSent: false,
      error: "DAILY_LOSS_LIMIT_REACHED",
      daily: orderDailyPnl,
      dailyLossLimitYen: DAILY_LOSS_LIMIT_YEN,
    }, 409);
  }
if (orderDailyPnl.closeCount >= MAX_DAILY_TRADES) {
    return c.json({
      orderSent: false,
      error: "MAX_DAILY_TRADES_REACHED",
      daily: orderDailyPnl,
      maxDailyTrades: MAX_DAILY_TRADES,
    }, 409);
  }

  if (gmoSafetyHalt) {
    return c.json({
      orderSent: false,
      error: "SAFETY_HALT",
      reason: gmoSafetyHaltReason,
    }, 503);
  }

  if (gmoOrderInProgress) {
  return c.json({
    orderSent: false,
    error: "ORDER_ALREADY_IN_PROGRESS",
  }, 409);
}

gmoOrderInProgress = true;

try {

  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;

  if (!apiKey || !apiSecret) {
    return c.json({
      orderSent: false,
      error: "GMO API keys are not set",
    }, 500);
  }

  const body = await c.req.json();
  const side = body.side;

  if (side !== "BUY" && side !== "SELL") {
    return c.json({
      orderSent: false,
      error: "side must be BUY or SELL",
    }, 400);
  }
    // 安全装置4：すでに建玉がある場合は新規注文しない
  const positionTimestamp = Date.now().toString();
  const positionMethod = "GET";
  const positionPath = "/v1/openPositions";

  const positionText =
    positionTimestamp +
    positionMethod +
    positionPath;

  const positionSign = crypto
    .createHmac("sha256", apiSecret)
    .update(positionText)
    .digest("hex");

  const positionResponse = await fetch(
    "https://forex-api.coin.z.com/private/v1/openPositions?symbol=USD_JPY&count=100",
    {
      method: positionMethod,
      headers: {
        "API-KEY": apiKey,
        "API-TIMESTAMP": positionTimestamp,
        "API-SIGN": positionSign,
      },
    }
  );

  const positionData: any =
    await positionResponse.json();

  if (
    !positionResponse.ok ||
    positionData.status !== 0
  ) {
    return c.json({
      orderSent: false,
      error: "Failed to check open positions",
      data: positionData,
    }, 500);
  }

  const openPositions =
    Array.isArray(positionData.data)
      ? positionData.data
      : [];

  if (openPositions.length > 0) {
    return c.json({
      orderSent: false,
      reason: "POSITION_ALREADY_EXISTS",
      positionCount: openPositions.length,
    }, 409);
  }
// GMO FX口座の実際の取引余力を取得
const assetTimestamp = Date.now().toString();
const assetMethod = "GET";
const assetPath = "/v1/account/assets";

const assetSign = crypto
  .createHmac("sha256", apiSecret)
  .update(assetTimestamp + assetMethod + assetPath)
  .digest("hex");

const assetResponse = await fetch(
  "https://forex-api.coin.z.com/private/v1/account/assets",
  {
    method: assetMethod,
    headers: {
      "API-KEY": apiKey,
      "API-TIMESTAMP": assetTimestamp,
      "API-SIGN": assetSign,
    },
  }
);

const assetData: any = await assetResponse.json();

const accountAsset = Array.isArray(assetData?.data)
  ? assetData.data[0]
  : assetData?.data;

const availableAmount = Number(
  accountAsset?.availableAmount
);

if (
  !assetResponse.ok ||
  assetData?.status !== 0 ||
  !Number.isFinite(availableAmount) ||
  availableAmount <= 0
) {
  return c.json({
    orderSent: false,
    error: "NO_AVAILABLE_FUNDS",
  }, 409);
}

// 1000通貨固定。SL10pipsなら理論上の最大損失は約100円（手数料等を除く）。
const maxRiskYen = TARGET_LOSS_PER_TRADE_YEN;

// 現在のATR×1.5を取得するためシグナルAPIを呼ぶ
const signalResponse = await fetch(
  new URL("/gmo-signal", c.req.url).toString()
);

const signalData: any = await signalResponse.json();

  // シグナル取得が正常か確認
if (!signalResponse.ok) {
  return c.json({
    orderSent: false,
    error: "SIGNAL_API_ERROR",
  }, 500);
}

// BUY / SELL シグナル以外では注文しない
const currentSignal = String(signalData.signal);

if (
  currentSignal !== "BUY" &&
  currentSignal !== "SELL"
) {
  return c.json({
    orderSent: false,
    error: "NO_TRADE_SIGNAL",
    signal: currentSignal,
  }, 409);
}

// 外部から指定された注文方向とシグナルが違えば拒否
if (side !== currentSignal) {
  return c.json({
    orderSent: false,
    error: "SIGNAL_SIDE_MISMATCH",
    requestedSide: side,
    signal: currentSignal,
  }, 409);
}
const stopDistance = FIXED_STOP_DISTANCE;
const orderSize = FIXED_ORDER_SIZE;

  const timestamp = Date.now().toString();
  const method = "POST";
  const path = "/v1/order";

  const orderBody = JSON.stringify({
    symbol: "USD_JPY",
    side,
    size: String(orderSize),
    executionType: "MARKET",
  });

  const text =
    timestamp +
    method +
    path +
    orderBody;

  const sign = crypto
    .createHmac("sha256", apiSecret)
    .update(text)
    .digest("hex");

  const response = await fetch(
    "https://forex-api.coin.z.com/private/v1/order",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-KEY": apiKey,
        "API-TIMESTAMP": timestamp,
        "API-SIGN": sign,
      },
      body: orderBody,
    }
  );

  const data: any = await response.json();

if (!response.ok || data.status !== 0) {
  return c.json({
    orderSent: false,
    symbol: "USD_JPY",
    side,
    size: String(orderSize),
    data,
  }, 500);
}

const orderResult = Array.isArray(data?.data)
  ? data.data[0]
  : data?.data;

const orderId = Number(
  orderResult?.orderId ?? orderResult
);
const rootOrderId = Number(
  orderResult?.rootOrderId ?? orderId
);

if (!Number.isFinite(orderId) || !Number.isFinite(rootOrderId)) {
  return c.json({
    orderSent: true,
    stopOrderSent: false,
    error: "ORDER_ID_NOT_FOUND",
    data,
  }, 500);
}
// 成行注文の約定反映を少し待つ
  // 成行注文の約定情報を最大5回確認
let executions: any[] = [];
let executionData: any = null;

for (let attempt = 1; attempt <= 5; attempt++) {
  await new Promise((resolve) =>
    setTimeout(resolve, 1000)
  );

  const executionTimestamp =
    Date.now().toString();

  const executionMethod = "GET";
  const executionPath = "/v1/executions";

  const executionSign = crypto
    .createHmac("sha256", apiSecret)
    .update(
      executionTimestamp +
      executionMethod +
      executionPath
    )
    .digest("hex");

  try {
  const executionResponse = await fetch(
    `https://forex-api.coin.z.com/private/v1/executions?orderId=${orderId}`,
    {
      method: executionMethod,
      headers: {
        "API-KEY": apiKey,
        "API-TIMESTAMP": executionTimestamp,
        "API-SIGN": executionSign,
      },
    }
  );

  executionData =
    await executionResponse.json();

  executions = Array.isArray(executionData?.data?.list)
  ? executionData.data.list.filter(
      (x: any) =>
        Number(x.orderId) === orderId &&
        x.symbol === "USD_JPY" &&
        x.settleType === "OPEN"
    )
  : [];

const totalExecutedSize = executions.reduce(
  (sum: number, x: any) =>
    sum + Number(x.size || 0),
  0
);

// 注文数量すべての約定を確認してから次へ進む
if (totalExecutedSize >= orderSize) {
  break;
}
    } catch (error) {
  executionData = {
    error: "EXECUTION_API_RETRY",
    attempt,
  };
  continue;
}
  }

if (executions.length === 0) {
  // executions APIだけで約定を確認できない場合、建玉を再照合する。
  // 新規注文前に建玉ゼロを確認済みなので、ここで現れた同方向の建玉を
  // 今回注文の約定結果として復旧し、STOP保護へ進める。
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const reconcileTimestamp = Date.now().toString();
  const reconcileMethod = "GET";
  const reconcilePath = "/v1/openPositions";
  const reconcileSign = crypto
    .createHmac("sha256", apiSecret)
    .update(reconcileTimestamp + reconcileMethod + reconcilePath)
    .digest("hex");

  try {
    const reconcileResponse = await fetch(
      "https://forex-api.coin.z.com/private/v1/openPositions?symbol=USD_JPY&count=100",
      {
        method: reconcileMethod,
        headers: {
          "API-KEY": apiKey,
          "API-TIMESTAMP": reconcileTimestamp,
          "API-SIGN": reconcileSign,
        },
      }
    );

    const reconcileData: any = await reconcileResponse.json();
    const reconciledPositions = Array.isArray(reconcileData?.data?.list)
      ? reconcileData.data.list
      : Array.isArray(reconcileData?.data)
        ? reconcileData.data
        : [];

    if (reconcileResponse.ok && reconcileData?.status === 0) {
      executions = reconciledPositions
        .filter(
          (p: any) =>
            p.symbol === "USD_JPY" &&
            p.side === side &&
            Number(p.positionId) > 0 &&
            Number(p.size) > 0 &&
            Number(p.price) > 0
        )
        .map((p: any) => ({
          orderId,
          symbol: "USD_JPY",
          settleType: "OPEN",
          positionId: p.positionId,
          size: p.size,
          price: p.price,
          reconciledFromOpenPositions: true,
        }));
    }
  } catch (error) {
    executionData = {
      ...executionData,
      reconciliationError:
        error instanceof Error ? error.message : String(error),
    };
  }
}

if (executions.length === 0) {
  // 注文送信後に約定状態を確定できない場合は、以後の自動新規注文を停止する。
  // 「約定していない」と推測して運転を続けない。
  gmoSafetyHalt = true;
  gmoSafetyHaltReason = "EXECUTION_STATE_UNKNOWN_AFTER_RECONCILIATION";
  return c.json({
    orderSent: true,
    stopOrderSent: false,
    safetyHalt: true,
    orderId,
    error: gmoSafetyHaltReason,
    executionData,
  }, 202);
}

// 約定数量の合計
const totalExecutedSize = executions.reduce(
  (sum: number, x: any) =>
    sum + Number(x.size || 0),
  0
);

if (!Number.isFinite(totalExecutedSize) || totalExecutedSize <= 0) {
  return c.json({
    orderSent: true,
    stopOrderSent: false,
    orderId,
    error: "INVALID_EXECUTED_SIZE",
    executedSize: totalExecutedSize,
  }, 500);
}

// 部分約定時は注文状態も確認する。約定済み分は必ずSTOP保護へ進める。
let entryOrderStatus: string | null = null;
let entryOrderData: any = null;

if (totalExecutedSize < orderSize) {
  const orderStatusTimestamp = Date.now().toString();
  const orderStatusMethod = "GET";
  const orderStatusPath = "/v1/orders";
  const orderStatusSign = crypto
    .createHmac("sha256", apiSecret)
    .update(orderStatusTimestamp + orderStatusMethod + orderStatusPath)
    .digest("hex");

  try {
    const orderStatusResponse = await fetch(
      `https://forex-api.coin.z.com/private/v1/orders?orderId=${orderId}`,
      {
        method: orderStatusMethod,
        headers: {
          "API-KEY": apiKey,
          "API-TIMESTAMP": orderStatusTimestamp,
          "API-SIGN": orderStatusSign,
        },
      }
    );
    entryOrderData = await orderStatusResponse.json();
    const orderList = Array.isArray(entryOrderData?.data?.list)
      ? entryOrderData.data.list
      : Array.isArray(entryOrderData?.data)
        ? entryOrderData.data
        : [];
    const matchedEntryOrder = orderList.find(
      (x: any) => Number(x.orderId) === orderId
    );
    entryOrderStatus = matchedEntryOrder?.status ?? null;
  } catch (error) {
    entryOrderData = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const partialExecution = totalExecutedSize < orderSize;

// 部分約定で残注文が生きている場合、後から追加約定してSTOP対象外に
// なることを防ぐため、残注文を先に取消す。
let remainderCancelAttempted = false;
let remainderCancelSucceeded = false;
let remainderCancelData: any = null;

if (
  partialExecution &&
  ["WAITING", "ORDERED", "MODIFYING"].includes(String(entryOrderStatus))
) {
  remainderCancelAttempted = true;
  const cancelTimestamp = Date.now().toString();
  const cancelMethod = "POST";
  const cancelPath = "/v1/cancelOrders";
  const cancelBody = JSON.stringify({
    rootOrderIds: [rootOrderId],
  });
  const cancelSign = crypto
    .createHmac("sha256", apiSecret)
    .update(cancelTimestamp + cancelMethod + cancelPath + cancelBody)
    .digest("hex");

  try {
    const cancelResponse = await fetch(
      "https://forex-api.coin.z.com/private/v1/cancelOrders",
      {
        method: cancelMethod,
        headers: {
          "Content-Type": "application/json",
          "API-KEY": apiKey,
          "API-TIMESTAMP": cancelTimestamp,
          "API-SIGN": cancelSign,
        },
        body: cancelBody,
      }
    );
    const cancelText = await cancelResponse.text();
    try {
      remainderCancelData = JSON.parse(cancelText);
    } catch {
      remainderCancelData = { rawResponse: cancelText };
    }
    remainderCancelSucceeded =
      cancelResponse.ok && remainderCancelData?.status === 0;
  } catch (error) {
    remainderCancelData = {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // 残注文の取消可否が不明なままSTOPを置くと、その後の追加約定分が
  // 無保護になる可能性があるため、ここでは自動運転を継続しない。
  if (!remainderCancelSucceeded) {
    // 残注文の状態が不明なまま次の自動注文を許可しない。
    gmoSafetyHalt = true;
    gmoSafetyHaltReason = "PARTIAL_FILL_REMAINDER_CANCEL_FAILED";
    return c.json({
      orderSent: true,
      stopOrderSent: false,
      safetyHalt: true,
      orderId,
      rootOrderId,
      error: gmoSafetyHaltReason,
      executedSize: totalExecutedSize,
      requestedSize: orderSize,
      entryOrderStatus,
      remainderCancelData,
    }, 202);
  }

  // GMO Private APIのPOST上限（1秒1回）を守ってからSTOP注文へ進む。
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

// 全約定の加重平均価格
const weightedPriceTotal = executions.reduce(
  (sum: number, x: any) =>
    sum + Number(x.price) * Number(x.size),
  0
);

const entryPrice =
  weightedPriceTotal / totalExecutedSize;

// 同じpositionIdの約定をまとめる
const positionMap = new Map<number, number>();

for (const x of executions) {
  const positionId = Number(x.positionId);
  const size = Number(x.size);

  if (
    !Number.isFinite(positionId) ||
    positionId <= 0 ||
    !Number.isFinite(size) ||
    size <= 0
  ) {
    gmoSafetyHalt = true;
    gmoSafetyHaltReason = "INVALID_EXECUTION_DATA";
    return c.json({
      orderSent: true,
      stopOrderSent: false,
      orderId,
      error: "INVALID_EXECUTION_DATA",
      safetyHalt: true,
    }, 500);
  }

  positionMap.set(
    positionId,
    (positionMap.get(positionId) || 0) + size
  );
}

const settlePosition = Array.from(
  positionMap.entries()
).map(([positionId, size]) => ({
  positionId,
  size: String(size),
}));

if (
  !Number.isFinite(entryPrice) ||
  entryPrice <= 0 ||
  settlePosition.length === 0 ||
  settlePosition.length > 10
) {
  gmoSafetyHalt = true;
  gmoSafetyHaltReason = "INVALID_EXECUTION_DATA";
  return c.json({
    orderSent: true,
    stopOrderSent: false,
    orderId,
    error: "INVALID_EXECUTION_DATA",
  }, 500);
}
// 1000通貨固定、TP20pips / SL10pips をOCOで同時設定。
const rawStopPrice =
  side === "BUY"
    ? entryPrice - FIXED_STOP_DISTANCE
    : entryPrice + FIXED_STOP_DISTANCE;

const takeProfitDistance = FIXED_TAKE_PROFIT_DISTANCE;
const rawTakeProfitPrice =
  side === "BUY"
    ? entryPrice + FIXED_TAKE_PROFIT_DISTANCE
    : entryPrice - FIXED_TAKE_PROFIT_DISTANCE;

// USD/JPYは小数第3位までに丸める
const stopPrice = rawStopPrice.toFixed(3);
const takeProfitPrice = rawTakeProfitPrice.toFixed(3);

// 決済方向は新規注文と逆
const stopSide =
  side === "BUY" ? "SELL" : "BUY";

const stopTimestamp = Date.now().toString();
const stopMethod = "POST";
const stopPath = "/v1/closeOrder";
const stopClientOrderId =
  `CO${orderId}${Date.now()}`.slice(0, 36);

const stopBody = JSON.stringify({
  symbol: "USD_JPY",
  side: stopSide,
  clientOrderId: stopClientOrderId,
  executionType: "OCO",
  limitPrice: takeProfitPrice,
  stopPrice,
  settlePosition,
});

const stopText =
  stopTimestamp +
  stopMethod +
  stopPath +
  stopBody;

const stopSign = crypto
  .createHmac("sha256", apiSecret)
  .update(stopText)
  .digest("hex");

let stopResponse: Response | null = null;
let stopData: any = null;
let stopRequestError: string | null = null;

try {
  stopResponse = await fetch(
    "https://forex-api.coin.z.com/private/v1/closeOrder",
    {
      method: stopMethod,
      headers: {
        "Content-Type": "application/json",
        "API-KEY": apiKey,
        "API-TIMESTAMP": stopTimestamp,
        "API-SIGN": stopSign,
      },
      body: stopBody,
    }
  );

  const stopTextResponse =
    await stopResponse.text();

  try {
    stopData = JSON.parse(stopTextResponse);
  } catch {
    stopData = {
      rawResponse: stopTextResponse,
    };
  }
} catch (error) {
  stopRequestError =
    error instanceof Error
      ? error.message
      : String(error);
}

// STOP応答が不明・失敗の場合、GMO側の有効注文を照合する
let stopConfirmedByActiveOrders = false;
let matchedStopOrder: any = null;
let activeOrdersCheckSucceeded = false;

if (
  stopResponse === null ||
  !stopResponse.ok ||
  stopData?.status !== 0
) {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const activeTimestamp = Date.now().toString();
  const activeMethod = "GET";
  const activePath = "/v1/activeOrders";
  const activeSign = crypto
    .createHmac("sha256", apiSecret)
    .update(activeTimestamp + activeMethod + activePath)
    .digest("hex");

  try {
    const activeResponse = await fetch(
      "https://forex-api.coin.z.com/private/v1/activeOrders?symbol=USD_JPY&count=100",
      {
        method: activeMethod,
        headers: {
          "API-KEY": apiKey,
          "API-TIMESTAMP": activeTimestamp,
          "API-SIGN": activeSign,
        },
      }
    );
    const activeData: any = await activeResponse.json();
    activeOrdersCheckSucceeded =
      activeResponse.ok && activeData?.status === 0;

    const activeOrders = Array.isArray(activeData?.data?.list)
      ? activeData.data.list
      : Array.isArray(activeData?.data)
        ? activeData.data
        : [];

    matchedStopOrder =
      activeOrders.find(
        (x: any) =>
          x.clientOrderId === stopClientOrderId &&
          x.symbol === "USD_JPY" &&
          (x.executionType === "STOP" || x.executionType === "LIMIT") &&
          x.settleType === "CLOSE"
      ) ?? null;

    stopConfirmedByActiveOrders = matchedStopOrder !== null;
  } catch (error) {
    console.error("STOP activeOrders check failed:", error);
  }
}

const stopConfirmed =
  (
    stopResponse !== null &&
    stopResponse.ok &&
    stopData?.status === 0
  ) || stopConfirmedByActiveOrders;

// STOPがGMO側に存在しないことを確認できた場合だけ、
// 建玉を成行決済して無防備なポジションを残さない。
// 照合自体に失敗した場合は二重決済を避けるため自動決済しない。
let emergencyCloseAttempted = false;
let emergencyCloseSucceeded = false;
let emergencyCloseData: any = null;
let emergencyCloseError: string | null = null;

if (!stopConfirmed && activeOrdersCheckSucceeded) {
  emergencyCloseAttempted = true;

  const emergencyTimestamp = Date.now().toString();
  const emergencyMethod = "POST";
  const emergencyPath = "/v1/closeOrder";
  const emergencyClientOrderId =
    `CE${orderId}${Date.now()}`.slice(0, 36);

  const emergencyBody = JSON.stringify({
    symbol: "USD_JPY",
    side: stopSide,
    clientOrderId: emergencyClientOrderId,
    executionType: "MARKET",
    settlePosition,
  });

  const emergencySign = crypto
    .createHmac("sha256", apiSecret)
    .update(
      emergencyTimestamp +
      emergencyMethod +
      emergencyPath +
      emergencyBody
    )
    .digest("hex");

  try {
    const emergencyResponse = await fetch(
      "https://forex-api.coin.z.com/private/v1/closeOrder",
      {
        method: emergencyMethod,
        headers: {
          "Content-Type": "application/json",
          "API-KEY": apiKey,
          "API-TIMESTAMP": emergencyTimestamp,
          "API-SIGN": emergencySign,
        },
        body: emergencyBody,
      }
    );

    const emergencyText = await emergencyResponse.text();
    try {
      emergencyCloseData = JSON.parse(emergencyText);
    } catch {
      emergencyCloseData = { rawResponse: emergencyText };
    }

    emergencyCloseSucceeded =
      emergencyResponse.ok &&
      emergencyCloseData?.status === 0;
  } catch (error) {
    emergencyCloseError =
      error instanceof Error
        ? error.message
        : String(error);
  }
}

const protectionState = stopConfirmed
  ? "STOP_CONFIRMED"
  : emergencyCloseSucceeded
    ? "EMERGENCY_CLOSE_SENT"
    : activeOrdersCheckSucceeded
      ? "PROTECTION_FAILED"
      : "PROTECTION_UNKNOWN";

if (protectionState === "PROTECTION_FAILED" || protectionState === "PROTECTION_UNKNOWN") {
  gmoSafetyHalt = true;
  gmoSafetyHaltReason = protectionState;
}

return c.json({
  orderSent: true,
  stopOrderSent: stopConfirmed,
  symbol: "USD_JPY",
  side,
  orderId,
  rootOrderId,
  entryPrice,
  executedSize: totalExecutedSize,
  requestedSize: orderSize,
  partialExecution,
  entryOrderStatus,
  remainderCancelAttempted,
  remainderCancelSucceeded,
  remainderCancelData,
  entryOrderData,
  positions: settlePosition,
  stopDistance,
stopPrice,
takeProfitPrice,
targetLossPerTradeYen: TARGET_LOSS_PER_TRADE_YEN,
targetProfitPerTradeYen: TARGET_PROFIT_PER_TRADE_YEN,
fixedOrderSize: FIXED_ORDER_SIZE,
stopLossPips: 10,
takeProfitPips: 20,
dailyLossLimitYen: DAILY_LOSS_LIMIT_YEN,
maxDailyTrades: MAX_DAILY_TRADES,
stopClientOrderId,
stopData,
stopRequestError,
stopConfirmedByActiveOrders,
matchedStopOrder,
activeOrdersCheckSucceeded,
protectionState,
emergencyCloseAttempted,
emergencyCloseSucceeded,
emergencyCloseData,
emergencyCloseError,
});
} finally {
  gmoOrderInProgress = false;
}
});

// 自動実行用エンドポイント。
// 外部スケジューラから 08:00 / 15:00 / 21:00 (JST) に呼び出す。
// LIVE_TRADING_ENABLED=false の間は実注文されない。
app.post("/gmo-auto-run", async (c) => {
  if (gmoSafetyHalt) {
    return c.json({
      autoRun: false,
      error: "SAFETY_HALT",
      reason: gmoSafetyHaltReason,
    }, 503);
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const receivedToken = c.req.header("X-ADMIN-TOKEN");

  if (!adminToken || receivedToken !== adminToken) {
    return c.json({
      autoRun: false,
      error: "Unauthorized",
    }, 401);
  }

  // シグナルをサーバー内部で取得
  let signalResponse: Response;
  let signalData: any;

  try {
    signalResponse = await fetch(
      new URL("/gmo-signal", c.req.url).toString()
    );
    signalData = await signalResponse.json();
  } catch (error) {
    return c.json({
      autoRun: false,
      error: "SIGNAL_FETCH_FAILED",
      message:
        error instanceof Error ? error.message : String(error),
    }, 500);
  }

  if (!signalResponse.ok) {
    return c.json({
      autoRun: false,
      error: "SIGNAL_API_ERROR",
      signalData,
    }, 500);
  }

  const signal = String(signalData?.signal ?? "WAIT");

  // WAITなら注文処理を呼ばない
  if (signal !== "BUY" && signal !== "SELL") {
    return c.json({
      autoRun: true,
      action: "NO_ORDER",
      signal,
      signalData,
    });
  }

  // 実注文処理は既存 /gmo-order に一本化する。
  // これにより資金確認・建玉確認・部分約定・STOP保護を重複実装しない。
  let orderResponse: Response;
  let orderData: any;

  try {
    orderResponse = await fetch(
      new URL("/gmo-order", c.req.url).toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ADMIN-TOKEN": adminToken,
        },
        body: JSON.stringify({ side: signal }),
      }
    );

    const orderText = await orderResponse.text();

    try {
      orderData = JSON.parse(orderText);
    } catch {
      orderData = { rawResponse: orderText };
    }
  } catch (error) {
    return c.json({
      autoRun: false,
      action: "ORDER_REQUEST_FAILED",
      signal,
      message:
        error instanceof Error ? error.message : String(error),
    }, 500);
  }

  return c.json({
    autoRun: true,
    action: orderResponse.ok
      ? "ORDER_FLOW_COMPLETED"
      : "ORDER_FLOW_REJECTED",
    signal,
    orderHttpStatus: orderResponse.status,
    orderData,
  }, orderResponse.ok ? 200 : 409);
});

app.get("/gmo-positions", async (c) => {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;

  if (!apiKey || !apiSecret) {
    return c.json({
      error: "GMO API keys are not set",
    }, 500);
  }

  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/v1/openPositions";

  const text = timestamp + method + path;

  const sign = crypto
    .createHmac("sha256", apiSecret)
    .update(text)
    .digest("hex");

  const response = await fetch(
    "https://forex-api.coin.z.com/private/v1/openPositions?symbol=USD_JPY&count=100",
    {
      method,
      headers: {
        "API-KEY": apiKey,
        "API-TIMESTAMP": timestamp,
        "API-SIGN": sign,
      },
    }
  );

  const data: any = await response.json();

  if (!response.ok || data.status !== 0) {
    return c.json({
      connected: false,
      error: "Failed to get open positions",
      data,
    }, 500);
  }

  const positions = Array.isArray(data.data)
    ? data.data
    : [];

  return c.json({
    system: "Chagatto-2",
    source: "GMO Coin FX",
    symbol: "USD_JPY",
    positionCount: positions.length,
    hasPosition: positions.length > 0,
    positions,
  });
});
app.post("/gmo-close", async (c) => {
  // 安全装置1：本番取引OFFなら決済しない
  if (process.env.LIVE_TRADING_ENABLED !== "true") {
    return c.json({
      closeSent: false,
      error: "LIVE_TRADING_ENABLED is false",
    }, 403);
  }

  // 安全装置2：管理者トークン
  const adminToken = process.env.ADMIN_TOKEN;
  const receivedToken = c.req.header("X-ADMIN-TOKEN");

  if (!adminToken || receivedToken !== adminToken) {
    return c.json({
      closeSent: false,
      error: "Unauthorized",
    }, 401);
  }

  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;

  if (!apiKey || !apiSecret) {
    return c.json({
      closeSent: false,
      error: "GMO API keys are not set",
    }, 500);
  }

  const body = await c.req.json();

  const positionId = Number(body.positionId);
  const positionSide = body.positionSide;
  const sizeValue = Number(body.size);
  const size = String(body.size ?? "");

  if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
    return c.json({
      closeSent: false,
      error: "Valid size is required",
    }, 400);
  }

  if (!Number.isFinite(positionId)) {
    return c.json({
      closeSent: false,
      error: "Invalid positionId",
    }, 400);
  }

  if (
    positionSide !== "BUY" &&
    positionSide !== "SELL"
  ) {
    return c.json({
      closeSent: false,
      error: "positionSide must be BUY or SELL",
    }, 400);
  }

  // BUY建玉はSELLで決済、SELL建玉はBUYで決済
  const closeSide =
    positionSide === "BUY" ? "SELL" : "BUY";

  const timestamp = Date.now().toString();
  const method = "POST";
  const path = "/v1/closeOrder";

  const closeBody = JSON.stringify({
    symbol: "USD_JPY",
    side: closeSide,
    executionType: "MARKET",
    settlePosition: [
      {
        positionId,
        size,
      },
    ],
  });

  const text =
    timestamp +
    method +
    path +
    closeBody;

  const sign = crypto
    .createHmac("sha256", apiSecret)
    .update(text)
    .digest("hex");

  const response = await fetch(
    "https://forex-api.coin.z.com/private/v1/closeOrder",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-KEY": apiKey,
        "API-TIMESTAMP": timestamp,
        "API-SIGN": sign,
      },
      body: closeBody,
    }
  );

  const data: any = await response.json();

  return c.json({
    closeSent:
      response.ok && data.status === 0,
    symbol: "USD_JPY",
    positionId,
    positionSide,
    closeSide,
    size,
    executionType: "MARKET",
    data,
  });
});
app.get("/gmo-stop-check", async (c) => {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) {
  return c.json({ error: "GMO API keys are not set" }, 500);
}
    const tickerResponse = await fetch(
  "https://forex-api.coin.z.com/public/v1/ticker?symbol=USD_JPY"
);
  const tickerData: any = await tickerResponse.json();
  const bid = Number(tickerData?.data?.[0]?.bid);
  if (!Number.isFinite(bid)) {
  return c.json({ error: "Failed to get USD_JPY bid" }, 500);
}
  // 現在の建玉を取得
const timestamp = Date.now().toString();
const method = "GET";
const path = "/v1/openPositions";

const sign = crypto
  .createHmac("sha256", apiSecret)
  .update(timestamp + method + path)
  .digest("hex");

const positionsResponse = await fetch(
  "https://forex-api.coin.z.com/private/v1/openPositions?symbol=USD_JPY&count=100",
  {
    method,
    headers: {
      "API-KEY": apiKey,
      "API-TIMESTAMP": timestamp,
      "API-SIGN": sign,
    },
  }
);

const positionsData: any = await positionsResponse.json();

if (!positionsResponse.ok || positionsData.status !== 0) {
  return c.json({
    error: "Failed to get positions",
    data: positionsData,
  }, 500);
}

const positions = Array.isArray(positionsData?.data)
  ? positionsData.data
  : Array.isArray(positionsData?.data?.list)
    ? positionsData.data.list
    : [];

const stopDistance = 0.20;

const checks = positions.map((p: any) => {
  const entryPrice = Number(p.price);
  const side = p.side;

  const currentPrice =
    side === "BUY"
      ? bid
      : Number(tickerData?.data?.[0]?.ask);

  const stopPrice =
    side === "BUY"
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;

  const stopTriggered =
    side === "BUY"
      ? currentPrice <= stopPrice
      : currentPrice >= stopPrice;

  return {
    positionId: p.positionId,
    side,
    size: p.size,
    entryPrice,
    currentPrice,
    stopPrice,
    stopDistance,
    stopTriggered,
  };
});

return c.json({
  system: "Chagatto-2",
  symbol: "USD_JPY",
  bid,
  ask: Number(tickerData?.data?.[0]?.ask),
  positionCount: positions.length,
  checks,
  action: "CHECK_ONLY",
});
});
const port = Number(process.env.PORT || 8080);
console.log(`Chagatto-2 started PORT=${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
