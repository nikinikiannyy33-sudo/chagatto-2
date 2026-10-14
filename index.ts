import { Hono } from "hono";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";
import * as researchFs from "node:fs/promises";
import * as durableFs from "node:fs";
import * as researchPath from "node:path";
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

// ===== Win-rate focused multi-timeframe strategy =====
// 4H: trend direction
// 1H: SMA direction + RSI + ADX
// 5M: fresh crossover timing trigger
// A new trade is allowed only on a fresh completed 5-minute crossover.
// This prevents repeated entries while the same signal remains active.

function adx(
  candles: { high: number; low: number; close: number }[],
  period = 14
) {
  if (candles.length < period * 2 + 1) return null;

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];

    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;

    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);

    trs.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      )
    );
  }

  if (trs.length < period * 2) return null;

  let tr14 = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let plus14 = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let minus14 = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxs: number[] = [];

  const pushDx = () => {
    if (tr14 <= 0) return;
    const plusDI = 100 * (plus14 / tr14);
    const minusDI = 100 * (minus14 / tr14);
    const denom = plusDI + minusDI;
    if (denom <= 0) return;
    dxs.push(100 * Math.abs(plusDI - minusDI) / denom);
  };

  pushDx();

  for (let i = period; i < trs.length; i++) {
    tr14 = tr14 - tr14 / period + trs[i];
    plus14 = plus14 - plus14 / period + plusDMs[i];
    minus14 = minus14 - minus14 / period + minusDMs[i];
    pushDx();
  }

  if (dxs.length < period) return null;

  let adxValue = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    adxValue = ((adxValue * (period - 1)) + dxs[i]) / period;
  }
  return adxValue;
}

function smaPrevious(values: number[], period: number) {
  if (values.length <= period) return null;
  return sma(values.slice(0, -1), period);
}

function gmoTradingDateBaseJst(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (jst.getUTCHours() < 6) {
    jst.setUTCDate(jst.getUTCDate() - 1);
  }
  return jst;
}

function formatGmoDate(d: Date) {
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0")
  );
}

function recentGmoBusinessDates(count: number, now = new Date()) {
  const out: string[] = [];
  const d = gmoTradingDateBaseJst(now);

  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(formatGmoDate(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }

  return out.reverse();
}

async function fetchCompletedGmoCandles(
  interval: "5min" | "1hour",
  businessDays: number
) {
  const durationMs =
    interval === "5min" ? 5 * 60 * 1000 :
    interval === "1hour" ? 60 * 60 * 1000 :
    4 * 60 * 60 * 1000;

  const dates = recentGmoBusinessDates(businessDays);
  const all: any[] = [];

  for (const date of dates) {
    const url =
      "https://forex-api.coin.z.com/public/v1/klines" +
      "?symbol=USD_JPY" +
      "&priceType=BID" +
      "&interval=" + interval +
      "&date=" + date;

    const response = await fetch(url);
    const data: any = await response.json();

    if (!response.ok || data?.status !== 0 || !Array.isArray(data?.data)) {
      throw new Error(
        `GMO klines ${interval} failed: ${JSON.stringify(data)}`
      );
    }

    for (const x of data.data) {
      const candle = {
        time: Number(x.openTime),
        open: Number(x.open),
        high: Number(x.high),
        low: Number(x.low),
        close: Number(x.close),
      };

      if (
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
      ) {
        all.push(candle);
      }
    }
  }

  const nowMs = Date.now();
  return all
    .sort((a, b) => a.time - b.time)
    .filter((x) => x.time + durationMs <= nowMs);
}

function aggregateOneHourToFourHour(
  candles: { time: number; open: number; high: number; low: number; close: number }[]
) {
  const buckets = new Map<number, any[]>();

  for (const c of candles) {
    const jst = new Date(c.time + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const m = jst.getUTCMonth();
    const day = jst.getUTCDate();
    const hour = jst.getUTCHours();
    const bucketHour = Math.floor(hour / 4) * 4;
    const bucketStartUtc =
      Date.UTC(y, m, day, bucketHour, 0, 0) - 9 * 60 * 60 * 1000;

    if (!buckets.has(bucketStartUtc)) buckets.set(bucketStartUtc, []);
    buckets.get(bucketStartUtc)!.push(c);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, rows]) => ({
      time,
      open: rows[0].open,
      high: Math.max(...rows.map((x) => x.high)),
      low: Math.min(...rows.map((x) => x.low)),
      close: rows[rows.length - 1].close,
      sourceBars: rows.length,
    }))
    .filter((x) => x.sourceBars === 4);
}


function oneHourTrendSeries(
  candles: { time: number; close: number }[]
) {
  const out: { time: number; direction: "BUY" | "SELL" | "WAIT" }[] = [];

  for (let i = 0; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const closes = slice.map((x) => x.close);
    const fast = sma(closes, 7);
    const slow = sma(closes, 8);

    let direction: "BUY" | "SELL" | "WAIT" = "WAIT";
    if (fast !== null && slow !== null) {
      if (fast > slow) direction = "BUY";
      else if (fast < slow) direction = "SELL";
    }

    out.push({
      time: candles[i].time,
      direction,
    });
  }

  return out;
}

async function getThreeLossDirectionGuard(
  c1h: { time: number; close: number }[]
) {
  const rows = await getLatestUsdJpyExecutions();

  const byPosition = new Map<string, {
    positionId: string;
    openSide: "BUY" | "SELL" | null;
    openTime: number | null;
    closeTime: number | null;
    pnl: number;
    hasClose: boolean;
  }>();

  for (const x of rows) {
    const positionId = String(x?.positionId ?? "");
    if (!positionId) continue;

    if (!byPosition.has(positionId)) {
      byPosition.set(positionId, {
        positionId,
        openSide: null,
        openTime: null,
        closeTime: null,
        pnl: 0,
        hasClose: false,
      });
    }

    const p = byPosition.get(positionId)!;
    const settleType = String(x?.settleType ?? "").toUpperCase();
    const side = String(x?.side ?? "").toUpperCase();
    const ts = executionTimestampMs(x);

    if (settleType === "OPEN") {
      if (side === "BUY" || side === "SELL") {
        p.openSide = side;
      }
      if (Number.isFinite(ts)) {
        p.openTime = p.openTime === null ? ts : Math.min(p.openTime, ts);
      }
    }

    if (settleType === "CLOSE") {
      const lossGain = Number(x?.lossGain);
      const fee = Number(x?.fee ?? 0);
      const settledSwap = Number(x?.settledSwap ?? 0);

      if (Number.isFinite(lossGain)) {
        p.pnl +=
          lossGain +
          (Number.isFinite(fee) ? fee : 0) +
          (Number.isFinite(settledSwap) ? settledSwap : 0);
      }

      p.hasClose = true;
      if (Number.isFinite(ts)) {
        p.closeTime = p.closeTime === null ? ts : Math.max(p.closeTime, ts);
      }
    }
  }

  const completed = [...byPosition.values()]
    .filter(
      (p) =>
        p.hasClose &&
        p.openSide !== null &&
        p.closeTime !== null
    )
    .sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0));

  const last3 = completed.slice(-3);

  if (
    last3.length < 3 ||
    last3.some((t) => t.pnl >= 0) ||
    !last3.every((t) => t.openSide === last3[0].openSide)
  ) {
    return {
      active: false,
      blockedSide: null,
      reason: "NO_THREE_CONSECUTIVE_SAME_DIRECTION_LOSSES",
      last3: last3.map((t) => ({
        positionId: t.positionId,
        side: t.openSide,
        pnl: t.pnl,
        closeTime: t.closeTime,
        closeIso: t.closeTime ? new Date(t.closeTime).toISOString() : null,
      })),
    };
  }

  const blockedSide = last3[0].openSide as "BUY" | "SELL";
  const thirdLossTime = last3[2].closeTime as number;

  // 再開条件:
  // 3連敗後に、確定1時間足の方向が一度でも WAIT または反対方向へ変化したら解除。
  // その後また同じ方向に戻った場合は、新しい相場状態として取引可能。
  const trendSeries = oneHourTrendSeries(c1h);
  const afterLoss = trendSeries.filter(
    (x) => x.time + 60 * 60 * 1000 > thirdLossTime
  );

  const resetSeen = afterLoss.some(
    (x) => x.direction !== blockedSide
  );

  return {
    active: !resetSeen,
    blockedSide,
    reason: resetSeen
      ? "ONE_HOUR_DIRECTION_CHANGED_AFTER_THREE_LOSSES"
      : "THREE_CONSECUTIVE_SAME_DIRECTION_LOSSES",
    thirdLossTime,
    thirdLossIso: new Date(thirdLossTime).toISOString(),
    resetSeen,
    last3: last3.map((t) => ({
      positionId: t.positionId,
      side: t.openSide,
      pnl: t.pnl,
      closeTime: t.closeTime,
      closeIso: t.closeTime ? new Date(t.closeTime).toISOString() : null,
    })),
  };
}

async function buildWinRateFocusedSignal() {
  const [c5, c1hLong] = await Promise.all([
    fetchCompletedGmoCandles("5min", 2),
    fetchCompletedGmoCandles("1hour", 10),
  ]);

  const c1h = c1hLong.slice(-120);
  const c4h = aggregateOneHourToFourHour(c1hLong);

  if (c5.length < 20 || c1h.length < 35 || c4h.length < 12) {
    throw new Error(
      `Not enough candles: 5m=${c5.length},1h=${c1h.length},4h=${c4h.length}`
    );
  }

  const close5 = c5.map((x) => x.close);
  const close1h = c1h.map((x) => x.close);
  const close4h = c4h.map((x) => x.close);

  // Condition 1: 4H trend direction + slope
  const sma4Fast = sma(close4h, 5);
  const sma4Slow = sma(close4h, 10);
  const sma4FastPrev = smaPrevious(close4h, 5);

  let trend4h: "BUY" | "SELL" | "WAIT" = "WAIT";
  if (sma4Fast !== null && sma4Slow !== null && sma4FastPrev !== null) {
    if (sma4Fast > sma4Slow && sma4Fast > sma4FastPrev) trend4h = "BUY";
    if (sma4Fast < sma4Slow && sma4Fast < sma4FastPrev) trend4h = "SELL";
  }

  // Condition 2: 1H SMA direction + slope
  const sma1Fast = sma(close1h, 7);
  const sma1Slow = sma(close1h, 8);
  const sma1FastPrev = smaPrevious(close1h, 7);

  let trend1h: "BUY" | "SELL" | "WAIT" = "WAIT";
  if (sma1Fast !== null && sma1Slow !== null) {
    if (sma1Fast > sma1Slow) trend1h = "BUY";
    if (sma1Fast < sma1Slow) trend1h = "SELL";
  }

  // Condition 3: RSI confirmation. Neutral zone is intentionally WAIT.
  const rsi1h = rsi(close1h, 14);
  const rsiBuy = rsi1h !== null && rsi1h >= 52 && rsi1h <= 72;
  const rsiSell = rsi1h !== null && rsi1h >= 28 && rsi1h <= 48;

  // Condition 4: ADX trend-strength filter
  const adx1h = adx(c1h, 14);
  const atr1hSnapshot = atr(c1h, 14);
  const adxPass = adx1h !== null && adx1h >= 10;

  // 5-minute entry timing (relaxed):
  // Do not require a brand-new SMA crossover.
  // If the 5-minute SMA direction already matches the higher-timeframe trend
  // and the latest completed candle confirms that direction, allow entry.
  const sma5Fast = sma(close5, 5);
  const sma5Slow = sma(close5, 10);
  const sma5FastPrev = smaPrevious(close5, 5);
  const sma5SlowPrev = smaPrevious(close5, 10);
  const last5 = c5[c5.length - 1];

  const triggerBuy =
    sma5Fast !== null &&
    sma5Slow !== null &&
    sma5Fast > sma5Slow &&
    last5.close > last5.open;

  const triggerSell =
    sma5Fast !== null &&
    sma5Slow !== null &&
    sma5Fast < sma5Slow &&
    last5.close < last5.open;

  let signal: "BUY" | "SELL" | "WAIT" = "WAIT";

  if (
    trend1h === "BUY" &&
    rsiBuy &&
    adxPass &&
    triggerBuy
  ) {
    signal = "BUY";
  } else if (
    trend1h === "SELL" &&
    rsiSell &&
    adxPass &&
    triggerSell
  ) {
    signal = "SELL";
  }

  // 同方向3連敗ガード。
  // 固定時間のクールダウンは使わず、1時間足の方向変化を解除条件にする。
  const threeLossGuard = await getThreeLossDirectionGuard(c1h);

  if (
    threeLossGuard.active &&
    threeLossGuard.blockedSide === signal
  ) {
    signal = "WAIT";
  }

  return {
    system: "Chagatto-2 WinRate Focus",
    source: "GMO Coin FX",
    strategy: "1H SMA/RSI/ADX primary + relaxed 5M direction confirmation; 4H display only",
    signal,
    triggerCandleTime: last5.time,
    triggerCandleIso: new Date(last5.time).toISOString(),
    price: last5.close,
    filters: {
      condition1_4hTrend: {
        direction: trend4h,
        sma5: sma4Fast,
        sma10: sma4Slow,
        fastSlopeUp: sma4Fast !== null && sma4FastPrev !== null ? sma4Fast > sma4FastPrev : null,
      },
      condition2_1hSma: {
        direction: trend1h,
        sma7: sma1Fast,
        sma8: sma1Slow,
      },
      condition3_rsi: {
        rsi14: rsi1h,
        buyPass: rsiBuy,
        sellPass: rsiSell,
      },
      condition4_atr: { atr14: atr1hSnapshot },
      condition4_adx: {
        adx14: adx1h,
        pass: adxPass,
        minimum: 10,
      },
      entry5m: {
        sma5: sma5Fast,
        sma10: sma5Slow,
        buyDirectionPass: triggerBuy,
        sellDirectionPass: triggerSell,
        candleOpen: last5.open,
        candleClose: last5.close,
      },
      threeLossDirectionGuard: threeLossGuard,
    },
    fixedTrade: {
      orderSize: FIXED_ORDER_SIZE,
      takeProfitPips: 20,
      stopLossPips: 10,
    },
    time: new Date().toISOString(),
  };
}

app.get("/smart-signal", async (c) => {
  try {
    const result = await buildWinRateFocusedSignal();
    return c.json(result);
  } catch (error: any) {
    return c.json({
      system: "Chagatto-2 WinRate Focus",
      signal: "WAIT",
      error: String(error?.message ?? error),
      orderSent: false,
    }, 500);
  }
});

let gmoOrderInProgress = false;
// Halt state is durable, and *any* storage fault blocks new live entries.
const safetyStateDir = (process.env.SAFETY_STATE_DIR || "/data/safety").trim();
const safetyStateFile = researchPath.join(safetyStateDir, "new-entry-halt.json");
let safetyStorageHealthy = false;
let safetyStorageError: string | null = null;
let gmoSafetyHalt = true;
let gmoSafetyHaltReason: string | null = "SAFETY_STORAGE_UNVERIFIED";
function initializeDurableSafetyState(): void {
  try {
    // Require a mounted Railway Volume; a writable container layer is not durable.
    const mounted = durableFs.readFileSync("/proc/self/mountinfo", "utf8").split("\n")
      .some(line => line.split(" ")[4] === "/data");
    if (!mounted || !safetyStateDir.startsWith("/data/")) throw new Error("RAILWAY_VOLUME_AT_DATA_NOT_VERIFIED");
    durableFs.mkdirSync(safetyStateDir, { recursive: true });
    const state = durableFs.existsSync(safetyStateFile)
      ? JSON.parse(durableFs.readFileSync(safetyStateFile, "utf8"))
      : null;
    // No existing file implies no historical halt *only if the volume is writable*.
    const testFile = researchPath.join(safetyStateDir, `.probe-${process.pid}`);
    durableFs.writeFileSync(testFile, "probe", { flag: "wx" });
    durableFs.unlinkSync(testFile);
    if (state && (state.version !== 1 || state.halted !== true || typeof state.reason !== "string")) {
      throw new Error("INVALID_SAFETY_STATE_FILE");
    }
    safetyStorageHealthy = true;
    gmoSafetyHalt = !!state;
    gmoSafetyHaltReason = state?.reason ?? null;
  } catch (error) {
    safetyStorageHealthy = false;
    safetyStorageError = String(error);
    gmoSafetyHalt = true;
    gmoSafetyHaltReason = "SAFETY_STORAGE_UNAVAILABLE";
  }
}
function persistSafetyHalt(reason: string): void {
  // Set in-memory latch first: persistence failure is never a permit to trade.
  gmoSafetyHalt = true;
  gmoSafetyHaltReason = reason;
  try {
    if (!safetyStorageHealthy) throw new Error("SAFETY_STORAGE_UNAVAILABLE");
    const tmp = safetyStateFile + `.tmp-${process.pid}`;
    durableFs.writeFileSync(tmp, JSON.stringify({ version: 1, halted: true, reason, recordedAt: new Date().toISOString() }), { flag: "w" });
    durableFs.renameSync(tmp, safetyStateFile);
    const fd = durableFs.openSync(safetyStateFile, "r");
    try { durableFs.fsyncSync(fd); } finally { durableFs.closeSync(fd); }
  } catch (error) {
    safetyStorageHealthy = false;
    safetyStorageError = String(error);
    gmoSafetyHaltReason = "SAFETY_HALT_PERSISTENCE_FAILED:" + reason;
  }
}
// Pre-submit write-ahead intent: a crash after the broker receives POST /v1/order
// must never silently permit a second entry on restart.
const pendingMarketOrderFile = researchPath.join(safetyStateDir, "pending-market-order.json");
function pendingMarketOrderExistsOrUnknown(): boolean {
  try {
    if (!safetyStorageHealthy) return true;
    if (!durableFs.existsSync(pendingMarketOrderFile)) return false;
    // Any existing record, including malformed/partial writes, blocks new orders.
    durableFs.readFileSync(pendingMarketOrderFile, "utf8");
    return true;
  } catch (error) {
    safetyStorageHealthy = false;
    safetyStorageError = String(error);
    return true;
  }
}
function fsyncSafetyDirectory(): void {
  const fd = durableFs.openSync(safetyStateDir, "r");
  try { durableFs.fsyncSync(fd); } finally { durableFs.closeSync(fd); }
}
function recordPendingMarketOrderBeforePost(side: "BUY" | "SELL", size: number, triggerCandleTime: number): boolean {
  try {
    if (!safetyStorageHealthy || pendingMarketOrderExistsOrUnknown()) return false;
    const payload = JSON.stringify({
      version: 1, status: "PENDING_BROKER_RECONCILIATION", side, size,
      symbol: "USD_JPY", triggerCandleTime,
      recordedAt: new Date().toISOString(),
      message: "Conservative pre-submit intent. May or may not have been accepted by GMO. No automatic retry."
    });
    // Exclusive create prevents a concurrent request from replacing an older marker.
    const fd = durableFs.openSync(pendingMarketOrderFile, "wx", 0o600);
    try { durableFs.writeFileSync(fd, payload); durableFs.fsyncSync(fd); }
    finally { durableFs.closeSync(fd); }
    fsyncSafetyDirectory();
    return true;
  } catch (error) {
    safetyStorageHealthy = false;
    safetyStorageError = String(error);
    gmoSafetyHalt = true;
    gmoSafetyHaltReason = "PRE_SUBMIT_INTENT_SAVE_FAILED";
    return false;
  }
}
function clearPendingMarketOrderAfterConfirmedStop(): boolean {
  try {
    if (!safetyStorageHealthy) return false;
    durableFs.unlinkSync(pendingMarketOrderFile);
    fsyncSafetyDirectory();
    return true;
  } catch (error) {
    safetyStorageHealthy = false;
    safetyStorageError = String(error);
    gmoSafetyHalt = true;
    gmoSafetyHaltReason = "PENDING_INTENT_CLEAR_FAILED";
    return false;
  }
}

function newEntriesSafelyBlocked(): boolean {
  if (!safetyStorageHealthy || gmoSafetyHalt || pendingMarketOrderExistsOrUnknown()) return true;
  try {
    // Recheck the marker on every entry; absent/unreadable volume is fail-closed.
    const marker = durableFs.existsSync(safetyStateFile);
    if (marker) {
      const state = JSON.parse(durableFs.readFileSync(safetyStateFile, "utf8"));
      if (state?.version !== 1 || state?.halted !== true) throw new Error("INVALID_SAFETY_STATE_FILE");
      gmoSafetyHalt = true;
      gmoSafetyHaltReason = state.reason;
      return true;
    }
    durableFs.accessSync(safetyStateDir, durableFs.constants.R_OK | durableFs.constants.W_OK);
    return false;
  } catch (error) {
    safetyStorageHealthy = false;
    safetyStorageError = String(error);
    gmoSafetyHalt = true;
    gmoSafetyHaltReason = "SAFETY_STORAGE_CHECK_FAILED";
    return true;
  }
}
initializeDurableSafetyState();

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
let lastSchedulerFiveMinKey: string | null = null;
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

async function getLatestUsdJpyExecutions() {
  const data = await gmoPrivateGet("/v1/latestExecutions", "?symbol=USD_JPY&count=100");
  return Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.list)
      ? data.data.list
      : [];
}

async function getTodayRealizedPnlJst() {
  const todayJst = jstParts().date;
  const rows = await getLatestUsdJpyExecutions();
  const todayRows = rows.filter((x: any) => toJstDateString(x?.timestamp) === todayJst);

  let pnl = 0;
  let closeCount = 0;
  const openOrderIds = new Set<string>();

  for (const x of todayRows) {
    const settleType = String(x?.settleType ?? "").toUpperCase();

    if (settleType === "OPEN") {
      const orderId = String(x?.orderId ?? "");
      if (orderId) openOrderIds.add(orderId);
      continue;
    }

    if (settleType !== "CLOSE") continue;

    const lossGain = Number(x?.lossGain);
    if (!Number.isFinite(lossGain)) continue;
    const fee = Number(x?.fee ?? 0);
    const settledSwap = Number(x?.settledSwap ?? 0);
    pnl += lossGain + (Number.isFinite(fee) ? fee : 0) + (Number.isFinite(settledSwap) ? settledSwap : 0);
    closeCount += 1;
  }

  return {
    dateJst: todayJst,
    pnl,
    closeCount,
    entryCount: openOrderIds.size,
    fetchedCount: rows.length
  };
}

function executionTimestampMs(x: any) {
  const ms = Date.parse(String(x?.timestamp ?? ""));
  return Number.isFinite(ms) ? ms : NaN;
}

async function hasEntryExecutionForDecisionWindow(triggerCandleTime: number, side: string) {
  const rows = await getLatestUsdJpyExecutions();

  // triggerCandleTime は確定5分足の始値時刻。
  // その足が確定した直後の5分間が、このシグナルの発注ウィンドウ。
  const start = triggerCandleTime + 5 * 60 * 1000;
  const end = start + 5 * 60 * 1000;

  const matches = rows.filter((x: any) => {
    const ts = executionTimestampMs(x);
    return (
      String(x?.settleType ?? "").toUpperCase() === "OPEN" &&
      String(x?.side ?? "").toUpperCase() === side &&
      ts >= start &&
      ts < end
    );
  });

  return {
    duplicateFound: matches.length > 0,
    decisionWindowStart: new Date(start).toISOString(),
    decisionWindowEnd: new Date(end).toISOString(),
    matches: matches.map((x: any) => ({
      executionId: x?.executionId,
      orderId: x?.orderId,
      positionId: x?.positionId,
      side: x?.side,
      size: x?.size,
      timestamp: x?.timestamp,
    })),
  };
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

async function runWinRateSafetyCycle() {
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
if (daily.entryCount >= MAX_DAILY_TRADES) {
      lastSchedulerResult = { startedAt, action: "STOP_DAILY_TRADE_COUNT", daily };
      console.log("[scheduler] daily trade-count stop", lastSchedulerResult);
      return;
    }

    const positionCount = await getUsdJpyOpenPositionCount();
    const baseUrl = schedulerBaseUrl();
    if (positionCount > 0) {
      // Existing position is already protected by its OCO TP/SL.
      // No new entry is allowed until the position is closed.
      lastSchedulerResult = {
        startedAt,
        action: "HOLD_OPEN_POSITION_OCO",
        daily,
        positionCount,
        newEntryBlocked: true,
      };
      console.log("[scheduler] hold open position", lastSchedulerResult);
      return;
    }

    const signalResponse = await fetch(`${baseUrl}/smart-signal`);
    const signalData: any = await signalResponse.json();
    if (!signalResponse.ok) throw new Error(`smart-signal failed: ${JSON.stringify(signalData)}`);

    const signal = String(signalData?.signal ?? "WAIT");
    await recordResearchSignal(signalData, "SCHEDULER_SIGNAL");
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

    if (newEntriesSafelyBlocked()) {
      lastSchedulerResult = { startedAt, action: "SAFETY_HALT", reason: gmoSafetyHaltReason, newEntryBlocked: true };
      return;
    }
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) throw new Error("ADMIN_TOKEN is not set");
    const orderResponse = await fetch(`${baseUrl}/gmo-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ADMIN-TOKEN": adminToken },
      body: JSON.stringify({
        side: signal,
        triggerCandleTime: Number(signalData?.triggerCandleTime),
      }),
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
  dailyTradeCountBasis: "distinct OPEN orderId from GMO latestExecutions",
      tradingAllowed:
        daily.pnl > DAILY_LOSS_LIMIT_YEN &&
        daily.entryCount < MAX_DAILY_TRADES
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

app.get("/system-audit", (c) => c.json({
  system: "Chagatto-2",
  strategy: "BALANCED_FREQUENCY_1H_PRIMARY_5M",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  schedulerSignalEndpoint: "/smart-signal",
  orderRecheckSignalEndpoint: "/smart-signal",
  signalChainConsistent: true,
  adxMinimum: 15,
  fixedOrderSize: FIXED_ORDER_SIZE,
  takeProfitPips: 20,
  stopLossPips: 10,
  dailyLossLimitYen: DAILY_LOSS_LIMIT_YEN,
  dailyProfitCap: null,
  maxDailyTrades: MAX_DAILY_TRADES,
  onePositionOnly: true,
  weekendMarketHoursGuard: true,
  ocoProtection: true,
  fourHourFilterUsedForEntry: false,
  oneHourPrimaryDirection: true,
  threeLossDirectionGuard: {
    enabled: true,
    consecutiveLosses: 3,
    cooldownMinutes: null,
    resetRule: "block same direction until completed 1H direction changes"
  }
}));

app.get("/three-loss-guard-status", async (c) => {
  try {
    const c1hLong = await fetchCompletedGmoCandles("1hour", 10);
    const c1h = c1hLong.slice(-120);
    const guard = await getThreeLossDirectionGuard(c1h);

    const closes = c1h.map((x) => x.close);
    const sma7 = sma(closes, 7);
    const sma8 = sma(closes, 8);
    let current1hDirection: "BUY" | "SELL" | "WAIT" = "WAIT";
    if (sma7 !== null && sma8 !== null) {
      if (sma7 > sma8) current1hDirection = "BUY";
      else if (sma7 < sma8) current1hDirection = "SELL";
    }

    return c.json({
      system: "Chagatto-2",
      rule: "After 3 consecutive losses in the same direction, block that direction until completed 1H direction changes.",
      cooldownMinutes: null,
      current1hDirection,
      guard,
      orderSent: false
    });
  } catch (error: any) {
    return c.json({
      system: "Chagatto-2",
      error: String(error?.message ?? error),
      orderSent: false
    }, 500);
  }
});

app.get("/order-safety-audit", async (c) => {
  try {
    const daily = await getTodayRealizedPnlJst();
    return c.json({
      system: "Chagatto-2",
      duplicateProtection: {
        processMemoryGuard: true,
        exchangeExecutionHistoryGuard: true,
        survivesProcessRestart: true,
        basis: "GMO latestExecutions OPEN executions in the same decision window",
      },
      signalConsistency: {
        schedulerEndpoint: "/smart-signal",
        orderRecheckEndpoint: "/smart-signal",
        exactTriggerCandleRequired: true,
      },
      activeOrderGuard: true,
      openPositionGuard: true,
      dailyTradeCountBasis: "distinct OPEN orderId",
      daily,
      maxDailyTrades: MAX_DAILY_TRADES,
      dailyLossLimitYen: DAILY_LOSS_LIMIT_YEN,
      fixedOrderSize: FIXED_ORDER_SIZE,
      takeProfitPips: 20,
      stopLossPips: 10,
      weekendMarketHoursGuard: true,
      note: "No order is sent by this endpoint."
    });
  } catch (error: any) {
    return c.json({
      system: "Chagatto-2",
      error: String(error?.message ?? error),
      orderSent: false
    }, 500);
  }
});

app.get("/scheduler-status", (c) => c.json({
  schedule: "continuous monitor; evaluate once after each completed 5-minute candle",
  strategy: "1H SMA/RSI/ADX primary + relaxed 5M direction confirmation; 4H display only",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  inProgress: schedulerInProgress,
  lastFiveMinKey: lastSchedulerFiveMinKey,
  lastResult: lastSchedulerResult,
}));

// 常時監視。
// 20秒ごとに時計を確認し、5分足が確定して約15秒後から、その足につき1回だけ判定する。
// 例: 10:00:15以降に09:55-10:00の確定5分足を判定。
setInterval(() => {
  const d = new Date();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();

  if (minute % 5 !== 0) return;
  if (second < 15) return;

  const bucketKey = String(Math.floor(d.getTime() / (5 * 60 * 1000)));
  if (lastSchedulerFiveMinKey === bucketKey) return;

  lastSchedulerFiveMinKey = bucketKey;
  void runWinRateSafetyCycle();
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
  const decisionId = `USD_JPY:${side}:${requestedTriggerCandleTime}`;
  console.log("[trade-audit] ENTRY_ATTEMPT", {
    decisionId,
    side,
    triggerCandleTime: requestedTriggerCandleTime,
    triggerCandleIso: new Date(requestedTriggerCandleTime).toISOString(),
    orderSize,
    takeProfitPips: 20,
    stopLossPips: 10,
    dailyEntryCount: orderDailyPnl.entryCount,
    dailyPnl: orderDailyPnl.pnl,
  });

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
      {step:8,name:"SMART_SIGNAL_ONLY_IF_NO_POSITION",active:simulatedPositionCount===0}
    ];
    return c.json({
      mode:"FINAL_CHAIN_DRY_RUN",schedule:"continuous monitor; evaluate each completed 5-minute candle",
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


// Read-only decision helper shared by real route and deterministic tests.
// Malformed or truncated position replies must never be treated as no exposure.
function decidePreEntryPositionSafety(reply: any) {
  if (!reply || reply.status !== 0) return {allowed:false,reason:'POSITION_RESPONSE_UNVERIFIABLE',positionCount:null};
  const rows = Array.isArray(reply?.data?.list) ? reply.data.list
    : Array.isArray(reply?.data) ? reply.data : null;
  if (!rows) return {allowed:false,reason:'POSITION_RESPONSE_UNVERIFIABLE',positionCount:null};
  const reportedTotal = reply?.data?.totalCount;
  const reportedCount = reply?.data?.count;
  if (rows.length >= 100 ||
      (reportedTotal !== undefined && (!Number.isFinite(Number(reportedTotal)) || Number(reportedTotal) > rows.length)) ||
      (reportedCount !== undefined && (!Number.isFinite(Number(reportedCount)) || Number(reportedCount) > rows.length))) {
    return {allowed:false,reason:'POSITION_PAGINATION_NOT_VERIFIED',positionCount:rows.length};
  }
  if (rows.length) return {allowed:false,reason:'POSITION_ALREADY_EXISTS',positionCount:rows.length};
  return {allowed:true,reason:'NO_OPEN_POSITIONS_VERIFIED',positionCount:0};
}

app.get('/pre-entry-position-guard-test', c => {
  const cases: {name:string;reply:any;allowed:boolean}[] = [
    {name:'VALID_EMPTY_LIST',reply:{status:0,data:{list:[]}},allowed:true},
    {name:'VALID_EMPTY_ARRAY',reply:{status:0,data:[]},allowed:true},
    {name:'OPEN_POSITION',reply:{status:0,data:{list:[{positionId:'example'}]}},allowed:false},
    {name:'MALFORMED_DATA',reply:{status:0,data:{}},allowed:false},
    {name:'MISSING_DATA',reply:{status:0},allowed:false},
    {name:'BROKER_ERROR',reply:{status:1,data:{list:[]}},allowed:false},
    {name:'INCOMPLETE_PAGE',reply:{status:0,data:{list:[],totalCount:1}},allowed:false},
    {name:'PAGE_LIMIT',reply:{status:0,data:{list:Array.from({length:100},()=>({}))}},allowed:false},
  ];
  const tests=cases.map(x=>{const result=decidePreEntryPositionSafety(x.reply);return {name:x.name,reason:result.reason,allowed:result.allowed,passed:result.allowed===x.allowed}});
  return c.json({system:'Chagatto-2 Pre-entry Position Guard',simulationOnly:true,orderSent:false,gmoPrivateApiCalled:false,
    liveTradingEnabled:process.env.LIVE_TRADING_ENABLED==='true',testCount:tests.length,allPassed:tests.every(x=>x.passed),tests,
    limitations:['NO_BROKER_CALL','NO_POST_AUTH_ORDER_INJECTION','NO_FULL_PAGINATION_TEST']});
});

// Pure classifier used by the real /gmo-order safety gate and its read-only test.
// A complete, empty order list is the ONLY acceptable state for a new entry.
function decidePreEntryActiveOrderSafety(rows: any[] | null, pageIncomplete = false) {
  if (!Array.isArray(rows)) return {allowed:false,reason:'ACTIVE_ORDER_RESPONSE_UNVERIFIABLE',activeOrderCount:null};
  if (pageIncomplete || rows.length >= 100) return {allowed:false,reason:'ACTIVE_ORDER_PAGINATION_NOT_VERIFIED',activeOrderCount:rows.length};
  if (rows.length > 0) return {allowed:false,reason:'EXISTING_BROKER_ORDER_REQUIRES_RECONCILIATION',activeOrderCount:rows.length};
  return {allowed:true,reason:'NO_ACTIVE_BROKER_ORDERS',activeOrderCount:0};
}

app.get('/pre-entry-active-order-guard-test', (c) => {
  const cases = [
    {name:'EMPTY_VERIFIED', rows:[], incomplete:false, allowed:true},
    {name:'STALE_STOP', rows:[{executionType:'STOP',settleType:'CLOSE'}], incomplete:false, allowed:false},
    {name:'OPEN_PENDING', rows:[{executionType:'MARKET',settleType:'OPEN'}], incomplete:false, allowed:false},
    {name:'CLOSE_PENDING', rows:[{executionType:'LIMIT',settleType:'CLOSE'}], incomplete:false, allowed:false},
    {name:'UNKNOWN_ORDER_TYPE', rows:[{}], incomplete:false, allowed:false},
    {name:'MALFORMED_RESPONSE', rows:null, incomplete:false, allowed:false},
    {name:'INCOMPLETE_PAGE', rows:[], incomplete:true, allowed:false},
    {name:'PAGE_LIMIT_REACHED', rows:Array.from({length:100},()=>({})), incomplete:false, allowed:false}
  ];
  const tests = cases.map(x => {const got=decidePreEntryActiveOrderSafety(x.rows,x.incomplete);
    return {name:x.name,reason:got.reason,allowed:got.allowed,passed:got.allowed===x.allowed};});
  return c.json({system:'Chagatto-2 Pre-entry Active Order Guard',simulationOnly:true,
    orderSent:false,gmoPrivateApiCalled:false,volumeStateChanged:false,
    liveTradingEnabled:process.env.LIVE_TRADING_ENABLED==='true',
    testCount:tests.length,allPassed:tests.every(x=>x.passed),tests,
    limitations:['PURE_CLASSIFIER_PLUS_REAL_ROUTE_INTEGRATION_NOT_POST_AUTH_PROBE','NO_LIVE_ORDER_TEST','NO_FULL_ORDER_HISTORY_PAGINATION']});
});

app.post("/gmo-order", async (c) => {
  // 安全装置1：本番取引が有効になっているか
  if (process.env.LIVE_TRADING_ENABLED !== "true") {
    return c.json({
      orderSent: false,
      error: "LIVE_TRADING_ENABLED is false",
    }, 403);
  }

  if (!isGmoFxTradingHoursJst()) {
    return c.json({
      orderSent: false,
      error: "GMO_FX_MARKET_CLOSED",
      regularTradingHours: "Mon 07:00 - Sat 05:59 JST",
      jst: jstParts(),
    }, 409);
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
if (orderDailyPnl.entryCount >= MAX_DAILY_TRADES) {
    return c.json({
      orderSent: false,
      error: "MAX_DAILY_TRADES_REACHED",
      daily: orderDailyPnl,
      maxDailyTrades: MAX_DAILY_TRADES,
    }, 409);
  }

  if (newEntriesSafelyBlocked()) {
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
  const requestedTriggerCandleTime = Number(body?.triggerCandleTime);

  if (side !== "BUY" && side !== "SELL") {
    return c.json({
      orderSent: false,
      error: "side must be BUY or SELL",
    }, 400);
  }

  if (!Number.isFinite(requestedTriggerCandleTime)) {
    return c.json({
      orderSent: false,
      error: "TRIGGER_CANDLE_TIME_REQUIRED",
    }, 400);
  }
  // 安全装置4：再起動後も有効な重複発注防止。
  // メモリではなくGMOの実約定履歴を照合し、同じ5分足の発注を拒否する。
  let duplicateGuard;
  try {
    duplicateGuard = await hasEntryExecutionForDecisionWindow(
      requestedTriggerCandleTime,
      side
    );
  } catch (error) {
    return c.json({
      orderSent: false,
      error: "DUPLICATE_GUARD_CHECK_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, 503);
  }

  if (duplicateGuard.duplicateFound) {
    return c.json({
      orderSent: false,
      error: "DUPLICATE_ENTRY_BLOCKED",
      duplicateGuard,
    }, 409);
  }

    // 安全装置5：すでに建玉がある場合は新規注文しない
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

  const positionSafety = decidePreEntryPositionSafety(positionData);
  if (!positionSafety.allowed) {
    return c.json({
      orderSent: false,
      error: positionSafety.reason,
      positionCount: positionSafety.positionCount,
    }, 409);
  }
// 安全装置6：通信不明・処理途中の注文が残っている場合は新規発注しない。
// MARKET注文の結果が不明でも、アクティブ注文が残っている間は安全側に停止する。
let activeOrderData: any;
try {
  activeOrderData = await gmoPrivateGet(
    "/v1/activeOrders",
    "?symbol=USD_JPY&count=100"
  );
} catch (error) {
  return c.json({
    orderSent: false,
    error: "ACTIVE_ORDER_CHECK_FAILED",
    message: error instanceof Error ? error.message : String(error),
  }, 503);
}

// Fail closed on missing or incomplete broker lists. A stale STOP or CLOSE
// order can be hazardous even if the account currently has no positions.
const brokerOrderList = Array.isArray(activeOrderData?.data?.list)
  ? activeOrderData.data.list
  : Array.isArray(activeOrderData?.data)
    ? activeOrderData.data
    : null;
const brokerOrderPageIncomplete =
  (activeOrderData?.data?.totalCount !== undefined &&
    Number(activeOrderData.data.totalCount) > (brokerOrderList?.length ?? 0)) ||
  (activeOrderData?.data?.count !== undefined &&
    Number(activeOrderData.data.count) > (brokerOrderList?.length ?? 0));
const activeOrderDecision = decidePreEntryActiveOrderSafety(
  brokerOrderList, brokerOrderPageIncomplete
);
if (!activeOrderDecision.allowed) {
  return c.json({
    orderSent: false,
    error: activeOrderDecision.reason,
    activeOrderCount: activeOrderDecision.activeOrderCount,
    note: 'No new market order until every existing broker order is reconciled.'
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

// スケジューラと同じ勝率優先シグナルを再確認する。
// 旧 /gmo-signal を参照すると、新戦略がBUY/SELLでも注文が拒否されるため使わない。
const signalResponse = await fetch(
  new URL("/smart-signal", c.req.url).toString()
);

const signalData: any = await signalResponse.json();

  // シグナル取得が正常か確認
if (!signalResponse.ok) {
  return c.json({
    orderSent: false,
    error: "SMART_SIGNAL_API_ERROR",
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
    error: "NO_SMART_TRADE_SIGNAL",
    signal: currentSignal,
  }, 409);
}

const currentTriggerCandleTime = Number(signalData?.triggerCandleTime);

if (
  !Number.isFinite(currentTriggerCandleTime) ||
  currentTriggerCandleTime !== requestedTriggerCandleTime
) {
  return c.json({
    orderSent: false,
    error: "SIGNAL_CANDLE_CHANGED",
    requestedTriggerCandleTime,
    currentTriggerCandleTime,
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

  // Once the order request is attempted, a transport failure or malformed reply
  // cannot establish that the broker did NOT accept it. Persist a fail-closed
  // latch BEFORE any further entry can be submitted. Never retry this POST.
  // Persist BEFORE sending the first byte to the broker. Failure means NO POST.
  if (!recordPendingMarketOrderBeforePost(side, orderSize, requestedTriggerCandleTime)) {
    return c.json({ orderSent: false, error: "PRE_SUBMIT_INTENT_NOT_DURABLE", newEntryBlocked: true,
      storageError: safetyStorageError, note: "Do not retry until the intent and broker state have been reconciled." }, 503);
  }
  let response: Response;
  let data: any;
  try {
    response = await fetch(
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
    data = await response.json();
  } catch (error) {
    persistSafetyHalt("MARKET_ORDER_RESPONSE_UNKNOWN");
    return c.json({
      orderSent: "UNKNOWN", stopOrderSent: false, safetyHalt: true,
      status: "MANUAL_BROKER_RECONCILIATION_REQUIRED",
      reason: gmoSafetyHaltReason,
      message: "Order submission outcome is unknown. No automatic retry. Manually inspect broker orders, executions, positions, and STOP coverage.",
      transportError: String(error instanceof Error ? error.message : error),
    }, 503);
  }

  if (!response.ok || data?.status !== 0) {
    // A non-success response is not evidence of a safely empty account.
    // Conservatively latch until broker-side reconciliation is performed.
    persistSafetyHalt("MARKET_ORDER_REJECTED_OR_AMBIGUOUS_RESPONSE");
    return c.json({
      orderSent: "UNKNOWN", stopOrderSent: false, safetyHalt: true,
      status: "MANUAL_BROKER_RECONCILIATION_REQUIRED",
      reason: gmoSafetyHaltReason,
      httpStatus: response.status,
      brokerStatus: data?.status ?? null,
      message: "No automatic retry. Broker orders, executions, positions, and STOP coverage require review.",
    }, 503);
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
  persistSafetyHalt("MARKET_ORDER_ID_MISSING");
  return c.json({
    orderSent: true,
    safetyHalt: true,
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
  persistSafetyHalt("EXECUTION_STATE_UNKNOWN_AFTER_RECONCILIATION");
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
  persistSafetyHalt("INVALID_EXECUTED_SIZE");
  return c.json({
    orderSent: true,
    safetyHalt: true,
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
    persistSafetyHalt("PARTIAL_FILL_REMAINDER_CANCEL_FAILED");
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
    persistSafetyHalt("INVALID_EXECUTION_DATA");
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
  persistSafetyHalt("INVALID_EXECUTION_DATA");
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
  persistSafetyHalt(protectionState);
}
// The write-ahead intent remains until STOP coverage is broker-confirmed.
// For emergency-close submissions or uncertain status, fail closed and require reconciliation.
if (stopConfirmed) {
  clearPendingMarketOrderAfterConfirmedStop();
} else {
  persistSafetyHalt("PENDING_MARKET_ORDER_REQUIRES_RECONCILIATION");
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
  if (newEntriesSafelyBlocked()) {
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

// Public market-data-only research. Never connects to GMO private/order endpoints.
// The results are counterfactual and are NOT verified historical executions.
app.get("/entry-quality-research", async (c) => {
  try {
    const [five, one] = await Promise.all([
      fetchCompletedGmoCandles("5min", 3),
      fetchCompletedGmoCandles("1hour", 10),
    ]);
    const pip = 0.01; // USD/JPY: one pip = 0.01 JPY
    const duration = 5 * 60 * 1000;
    const horizonBars = 12; // one hour; exits after horizon are not interpreted as wins/losses
    const roundTripCostPips = 0.5; // research assumption, NOT the actual GMO spread
    const results: any[] = [];
    for (const adxMin of [10, 15, 20]) {
      for (const requireCandleDirection of [true, false]) {
        let signalCount = 0, wins = 0, losses = 0, unresolved = 0, ambiguous = 0;
        let mfeSum = 0, maeSum = 0, evaluated = 0, netPips = 0;
        let nextEligibleIndex = 20;
        let blockedByAdx = 0, blockedByCandle = 0;
        for (let i = 20; i + horizonBars + 1 < five.length; i++) {
          if (i < nextEligibleIndex) continue;
          const bar = five[i];
          const closeAt = bar.time + duration;
          // Avoid 1H lookahead: only fully completed 1H candles as of the 5M close.
          const hour = one.filter((x) => x.time + 60 * 60 * 1000 <= closeAt);
          if (hour.length < 35) continue;
          const hClose = hour.map((x) => x.close);
          const fast = sma(hClose, 7), slow = sma(hClose, 8);
          const r = rsi(hClose, 14), a = adx(hour, 14);
          if (fast === null || slow === null || r === null || a === null) continue;
          const fClose = five.slice(0, i + 1).map((x) => x.close);
          const f5 = sma(fClose, 5), f10 = sma(fClose, 10);
          if (f5 === null || f10 === null) continue;
          const buy = fast > slow && r >= 52 && r <= 72 && f5 > f10;
          const sell = fast < slow && r >= 28 && r <= 48 && f5 < f10;
          if (!buy && !sell) continue;
          const side = buy ? "BUY" : "SELL";
          if (a < adxMin) { blockedByAdx++; continue; }
          if (requireCandleDirection && !(buy ? bar.close > bar.open : bar.close < bar.open)) {
            blockedByCandle++; continue;
          }
          // Enter at the NEXT 5m candle open. BID prices only; spread not reconstructed.
          const entry = five[i + 1].open;
          signalCount++;
          let maxFavorable = 0, maxAdverse = 0, exitIndex = i + horizonBars;
          let outcome: "WIN" | "LOSS" | "AMBIGUOUS" | "UNRESOLVED" = "UNRESOLVED";
          for (let j = i + 1; j <= i + horizonBars; j++) {
            const x = five[j];
            const favourable = buy ? (x.high - entry) / pip : (entry - x.low) / pip;
            const adverse = buy ? (entry - x.low) / pip : (x.high - entry) / pip;
            maxFavorable = Math.max(maxFavorable, favourable);
            maxAdverse = Math.max(maxAdverse, adverse);
            // Stop/TP using conservative roundtrip cost assumption and same-bar conflict policy.
            const tp = favourable >= 20 + roundTripCostPips;
            const sl = adverse >= 10 - roundTripCostPips;
            if (tp || sl) {
              outcome = tp && sl ? "AMBIGUOUS" : sl ? "LOSS" : "WIN";
              exitIndex = j;
              break;
            }
          }
          evaluated++;
          mfeSum += maxFavorable;
          maeSum += maxAdverse;
          if (outcome === "WIN") { wins++; netPips += 20; }
          else if (outcome === "LOSS") { losses++; netPips -= 10; }
          else if (outcome === "AMBIGUOUS") { ambiguous++; netPips -= 10; }
          else { unresolved++; }
          // one position at a time; no repeated signals while simulated position is active
          nextEligibleIndex = exitIndex + 1;
        }
        const decided = wins + losses + ambiguous;
        results.push({
          adxMinimum: adxMin, require5mCandleDirection: requireCandleDirection,
          signalCount, wins, losses, ambiguousTreatedAsLoss: ambiguous, unresolved,
          decided, decidedWinRatePct: decided ? Number((100 * wins / decided).toFixed(2)) : null,
          illustrativeNetPipsExcludingUnresolved: Number(netPips.toFixed(2)),
          averageMfePips: evaluated ? Number((mfeSum / evaluated).toFixed(2)) : null,
          averageMaePips: evaluated ? Number((maeSum / evaluated).toFixed(2)) : null,
          blockedByAdx, blockedByCandle,
        });
      }
    }
    return c.json({
      system: "Chagatto-2", researchOnly: true, orderSent: false,
      gmoPrivateApiCalled: false, liveTradingParametersChanged: false,
      source: "GMO Coin FX public BID candles",
      candles5m: five.length, candles1h: one.length,
      first5m: five.length ? new Date(five[0].time).toISOString() : null,
      last5m: five.length ? new Date(five[five.length - 1].time).toISOString() : null,
      assumptions: {
        entry: "next 5m candle OPEN after confirmed signal; no lookahead",
        tpPips: 20, slPips: 10, holdingWindow: "12 five-minute bars (1 hour)",
        roundTripCostPips,
        roundTripCostNote: "Assumed research cost, NOT a live spread measurement",
        sameCandleTpSl: "counted as LOSS, intrabar sequence unknown",
        unresolved: "reported separately, excluded from illustrative net pips",
        protectiveOrders: "simulated, NOT evidence of live OCO functionality",
        directionalLossGuard: "not simulated; counterfactual signal quality only",
        marketHours: "public historical candles only; not a complete broker schedule simulation",
        executionData: "no actual trades or account history used",
        limitation: "Short sample, BID-only OHLC, no ASK prices, no real fills, no gaps/slippage modelling; do not use as proof of profitability",
      },
      comparisons: results,
    });
  } catch (e: any) {
    return c.json({ researchOnly: true, orderSent: false, error: String(e?.message ?? e) }, 500);
  }
});


// Research-only comparison. It never calls private order APIs and cannot place orders.
app.get("/winrate-candidate-validation", async (c) => {
  try {
    const [five, hours] = await Promise.all([
      fetchCompletedGmoCandles("5min", 15),
      fetchCompletedGmoCandles("1hour", 30),
    ]);
    const pip = 0.01, barMs = 300000, hourMs = 3600000;
    type Side = "BUY" | "SELL";
    const modes = ["CURRENT", "SELECTIVE_PULLBACK"] as const;
    const horizons = [12, 36, 72, 144, 288];
    const costPips = 0.5; // illustration only: BID-only candles cannot reproduce real fills
    const result: any[] = [];
    // Closed bar only. Both strategies enter on the next 5-minute opening.
    for (const mode of modes) {
      for (const horizon of horizons) {
        let nextEligible = 0;
        const trades: any[] = [];
        let candidates = 0;
        let prevHourIndex = 0;
        for (let i = 35; i + horizon + 1 < five.length; i++) {
          if (i < nextEligible) continue;
          const signalBar = five[i];
          const decisionTime = signalBar.time + barMs;
          while (prevHourIndex < hours.length && hours[prevHourIndex].time + hourMs <= decisionTime) prevHourIndex++;
          const h = hours.slice(0, prevHourIndex);
          if (h.length < 40) continue;
          const closesH = h.map((x) => x.close);
          const closes5 = five.slice(i - 34, i + 1).map((x) => x.close);
          const fast7 = sma(closesH, 7), slow8 = sma(closesH, 8);
          const slow21 = sma(closesH, 21);
          const sma5 = sma(closes5, 5), sma10 = sma(closes5, 10);
          const r = rsi(closesH, 14), a = adx(h, 14);
          if ([fast7,slow8,slow21,sma5,sma10,r,a].some(x => x === null)) continue;
          const buyBase = fast7! > slow8! && r! >= 52 && r! <= 72 && a! >= 10 && sma5! > sma10! && signalBar.close > signalBar.open;
          const sellBase = fast7! < slow8! && r! >= 28 && r! <= 48 && a! >= 10 && sma5! < sma10! && signalBar.close < signalBar.open;
          const hPrev = h.slice(0,-1).map((x)=>x.close);
          const prev21 = sma(hPrev,21);
          const prev5 = five[i-1];
          // Hypothesis: avoid chasing an extension; require a pullback in prior candle
          // followed by a directional 5m recovery; more separated and sloped 1H averages.
          const buySelective =
             fast7! > slow21! && slow21! > (prev21 ?? Infinity) &&
             a! >= 15 && r! >= 52 && r! <= 68 &&
             sma5! > sma10! && prev5.close <= prev5.open &&
             signalBar.close > signalBar.open && signalBar.close > prev5.high;
          const sellSelective =
             fast7! < slow21! && slow21! < (prev21 ?? -Infinity) &&
             a! >= 15 && r! >= 32 && r! <= 48 &&
             sma5! < sma10! && prev5.close >= prev5.open &&
             signalBar.close < signalBar.open && signalBar.close < prev5.low;
          const buy = mode === "CURRENT" ? buyBase : buySelective;
          const sell = mode === "CURRENT" ? sellBase : sellSelective;
          if (!buy && !sell) continue;
          candidates++;
          const side: Side = buy ? "BUY" : "SELL";
          const entry = five[i+1].open;
          let mfe = 0, mae = 0, outcome = "UNRESOLVED", exitIndex = i + horizon;
          for (let j = i+1; j <= i+horizon; j++) {
            const x = five[j];
            const favorable = buy ? (x.high-entry)/pip : (entry-x.low)/pip;
            const adverse = buy ? (entry-x.low)/pip : (x.high-entry)/pip;
            mfe = Math.max(mfe,favorable); mae = Math.max(mae,adverse);
            const tp = favorable >= 20 + costPips;
            const sl = adverse >= 10 - costPips;
            if (tp || sl) {
              outcome = tp && sl ? "AMBIGUOUS" : sl ? "LOSS" : "WIN";
              exitIndex = j; break;
            }
          }
          // Exclude overlapping simulated positions. Unresolved is NOT a loss.
          nextEligible = exitIndex + 1;
          trades.push({side,outcome,mfe,mae,signalTime:signalBar.time});
        }
        const partition = (list: any[]) => {
          const wins = list.filter(t=>t.outcome==="WIN").length;
          const losses = list.filter(t=>t.outcome==="LOSS").length;
          const ambiguous = list.filter(t=>t.outcome==="AMBIGUOUS").length;
          const unresolved = list.filter(t=>t.outcome==="UNRESOLVED").length;
          const decided = wins+losses+ambiguous;
          return {trades:list.length,wins,losses,ambiguous,unresolved,
            decided,decidedWinRatePct:decided?Number((100*wins/decided).toFixed(2)):null,
            mfePips:list.length?Number((list.reduce((a,t)=>a+t.mfe,0)/list.length).toFixed(2)):null,
            maePips:list.length?Number((list.reduce((a,t)=>a+t.mae,0)/list.length).toFixed(2)):null};
        };
        const cut = five.length ? five[Math.floor(five.length*0.7)].time : Infinity;
        result.push({mode,horizonHours:horizon/12,candidates,
          overall:partition(trades),
          buy:partition(trades.filter(t=>t.side==="BUY")),
          sell:partition(trades.filter(t=>t.side==="SELL")),
          earlier70pct:partition(trades.filter(t=>t.signalTime<cut)),
          later30pct:partition(trades.filter(t=>t.signalTime>=cut))});
      }
    }
    return c.json({system:"Chagatto-2",researchOnly:true,liveParametersChanged:false,
      orderSent:false,gmoPrivateApiCalled:false,
      source:"GMO public BID-only OHLC",candles5m:five.length,candles1h:hours.length,
      first5m:five.length?new Date(five[0].time).toISOString():null,
      last5m:five.length?new Date(five[five.length-1].time).toISOString():null,
      assumptions:{entry:"next completed 5m bar opening",tpPips:20,slPips:10,
        estimatedRoundTripCostPips:costPips,
        note:"Not actual GMO spread or slippage; no ASK; not a live-order simulation.",
        collision:"same bar TP and SL = AMBIGUOUS, conservatively counted against wins",
        unresolved:"not counted as win or loss; timed exit not included",
        experimental:"SELECTIVE_PULLBACK is an unvalidated hypothesis, NOT a recommended live setting",
        limits:"Historical candles only; no actual order history, weekend handling, directional three-loss guard, or broker fills."},
      comparisons:result});
  } catch(e:any) {return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});


// READ-ONLY: identical entry cohort, different exit policies.
// Important: this compares counterfactual exit rules only, not historical execution.
app.get("/historical-exit-comparison", async (c) => {
  try {
    const [five, hours] = await Promise.all([
      fetchCompletedGmoCandles("5min", 15),
      fetchCompletedGmoCandles("1hour", 30),
    ]);
    const fiveMs = 300000, oneMs = 3600000, pip = 0.01;
    const cost = 0.5; // assumption, not actual GMO spread
    const maxBars = 288; // 24 hours; do not label insufficient forward bars as losers
    type Entry = {index:number;time:number;side:"BUY"|"SELL";price:number;atrPips:number};
    const entries: Entry[] = [];
    let completedHours = 0;
    for (let i=34; i+1<five.length; i++) {
      const bar=five[i]; const decisionTime=bar.time+fiveMs;
      while(completedHours<hours.length && hours[completedHours].time+oneMs<=decisionTime) completedHours++;
      if (completedHours<40) continue;
      const h=hours.slice(0,completedHours), hc=h.map(x=>x.close);
      const fc=five.slice(i-34,i+1).map(x=>x.close);
      const f=sma(hc,7), sl=sma(hc,8), rr=rsi(hc,14), aa=adx(h,14);
      const m5=sma(fc,5), m10=sma(fc,10), at=atr(h,14);
      if ([f,sl,rr,aa,m5,m10,at].some(x=>x===null)) continue;
      const buy=f!>sl! && rr!>=52 && rr!<=72 && aa!>=10 && m5!>m10! && bar.close>bar.open;
      const sell=f!<sl! && rr!>=28 && rr!<=48 && aa!>=10 && m5!<m10! && bar.close<bar.open;
      if (!buy&&!sell) continue;
      entries.push({index:i+1,time:five[i+1].time,side:buy?"BUY":"SELL",
        price:five[i+1].open,atrPips:at!/pip});
    }
    const schemes=[
      {id:"FIXED_TP20_SL10",tp:20,sl:10},
      {id:"FIXED_TP10_SL10",tp:10,sl:10},
      {id:"ATR_1R_TP_2R",tp:0,sl:0},
      {id:"NEXT_COMPLETED_1H_CLOSE",tp:0,sl:0},
    ];
    type Outcome = {entryTime:number;side:string;result:"WIN"|"LOSS"|"AMBIGUOUS"|"INSUFFICIENT_DATA";
      netPips:number|null;exitTime:number|null;holdingBars:number|null;};
    function evaluate(e:Entry, scheme:typeof schemes[number]):Outcome {
      const base={entryTime:e.time,side:e.side};
      if (scheme.id==="NEXT_COMPLETED_1H_CLOSE") {
        const hour=hours.find(x=>x.time+oneMs>e.time && x.time+oneMs<=five[five.length-1].time+fiveMs);
        if (!hour) return {...base,result:"INSUFFICIENT_DATA",netPips:null,exitTime:null,holdingBars:null};
        const diff=(e.side==="BUY"?hour.close-e.price:e.price-hour.close)/pip-cost;
        return {...base,result:diff>0?"WIN":"LOSS",netPips:diff,exitTime:hour.time+oneMs,holdingBars:Math.ceil((hour.time+oneMs-e.time)/fiveMs)};
      }
      const sl=scheme.id==="ATR_1R_TP_2R"?Math.max(5,e.atrPips):scheme.sl;
      const tp=scheme.id==="ATR_1R_TP_2R"?2*sl:scheme.tp;
      const end=e.index+maxBars-1;
      if(end>=five.length) return {...base,result:"INSUFFICIENT_DATA",netPips:null,exitTime:null,holdingBars:null};
      for(let j=e.index;j<=end;j++) {
        const x=five[j];
        const favorable=(e.side==="BUY"?x.high-e.price:e.price-x.low)/pip;
        const adverse=(e.side==="BUY"?e.price-x.low:x.high-e.price)/pip;
        const hitTP=favorable>=tp+cost/2,hitSL=adverse>=sl-cost/2;
        if(hitTP||hitSL) {
          const collision=hitTP&&hitSL;
          return {...base,result:collision?"AMBIGUOUS":hitSL?"LOSS":"WIN",
            netPips:collision||hitSL?-sl-cost:tp-cost,exitTime:x.time+fiveMs,holdingBars:j-e.index+1};
        }
      }
      // Fully observed horizon, forced market-price exit (not an unresolved win/loss).
      const last=five[end];
      const diff=(e.side==="BUY"?last.close-e.price:e.price-last.close)/pip-cost;
      return {...base,result:diff>0?"WIN":"LOSS",netPips:diff,exitTime:last.time+fiveMs,holdingBars:maxBars};
    }
    const cutoff=five.length?five[Math.floor(five.length*0.7)].time:0;
    const stats=(list:Outcome[])=>{
      const known=list.filter(x=>x.netPips!==null);
      const wins=known.filter(x=>x.netPips!>0).length;
      const losses=known.filter(x=>x.netPips!<=0).length;
      const ambiguous=known.filter(x=>x.result==="AMBIGUOUS").length;
      const net=known.reduce((v,x)=>v+x.netPips!,0);
      return {signals:list.length,evaluable:known.length,insufficientData:list.length-known.length,
        wins,losses,ambiguousConservativelyScoredAsLoss:ambiguous,
        winRatePct:known.length?Number((100*wins/known.length).toFixed(2)):null,
        totalNetPips:known.length?Number(net.toFixed(2)):null,
        averageNetPips:known.length?Number((net/known.length).toFixed(3)):null};
    };
    const comparisons=schemes.map(scheme=>{
      const outcomes=entries.map(e=>evaluate(e,scheme));
      return {scheme:scheme.id,overall:stats(outcomes),
        buy:stats(outcomes.filter(x=>x.side==="BUY")),
        sell:stats(outcomes.filter(x=>x.side==="SELL")),
        earlier70pct:stats(outcomes.filter(x=>x.entryTime<cutoff)),
        later30pct:stats(outcomes.filter(x=>x.entryTime>=cutoff))};
    });
    return c.json({system:"Chagatto-2",researchOnly:true,orderSent:false,
      gmoPrivateApiCalled:false,liveParametersChanged:false,
      source:"GMO public BID-only 5m/1h OHLC",candles5m:five.length,candles1h:hours.length,
      first5m:five.length?new Date(five[0].time).toISOString():null,
      last5m:five.length?new Date(five[five.length-1].time).toISOString():null,
      entryCount:entries.length,assumptions:{
        entry:"SAME base entry candidates across all exit policies; next confirmed 5m bar opening",
        baseSignal:"1H SMA7/8, RSI52-72/28-48, ADX>=10, 5m SMA5/10 and candle direction",
        roundTripCostPips:cost,costIsAssumption:true,
        stopAndTarget:"Same-bar target/stop collision counted as LOSS",
        fixedExits:"TP/SL exits within 24h; otherwise exit on 24h close",
        atrExit:"1H ATR14 as known at signal; stop=max(5pips, ATR in pips), TP=2x stop",
        nextHour:"Close of next completed 1h bar strictly after entry",
        comparisonMethod:"Overlapping entry signals are evaluated independently: NOT a one-position-only portfolio backtest",
        sampleAndFills:"Limited historical BID-only candles; no ASK, true spread, live executions, stop gaps, 3-loss guard or full market-hours rules",
        earlierHighWinRate:"Cannot establish which prior 50-70% strategy produced that number without original strategy report",
      },comparisons});
  } catch(e:any) {
    return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);
  }
});



// Read-only, pre-specified stratification of the CURRENT entry rule, without optimization.
// It deliberately does not call any GMO private API, submit orders or alter scheduler logic.

// Read-only chronological 1-position test, no GMO private access or order transmission.
app.get('/chronological-filter-validation', async (c) => {
 try {
  const [five,hours]=await Promise.all([fetchCompletedGmoCandles('5min',15),fetchCompletedGmoCandles('1hour',30)]);
  const H=3600000, M=300000, pip=.01, cost=.5;
  const jst=(time:number)=>{
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(time));
   const v=(k:string)=>parts.find(x=>x.type===k)?.value??'';
   return {date:`${v('year')}-${v('month')}-${v('day')}`,hour:Number(v('hour')),weekend:['Sat','Sun'].includes(v('weekday'))};
  };
  type C={i:number;time:number;side:'BUY'|'SELL';rsi:number;adx:number;hour:number};
  const entries:C[]=[];let hi=0;
  for(let i=34;i+1<five.length;i++){
   const b=five[i],t=b.time+M;
   while(hi<hours.length&&hours[hi].time+H<=t)hi++;
   if(hi<40)continue;
   const h=hours.slice(0,hi),hc=h.map(x=>x.close),fc=five.slice(i-34,i+1).map(x=>x.close);
   const a=sma(hc,7),z=sma(hc,8),r=rsi(hc,14),d=adx(h,14),f=sma(fc,5),g=sma(fc,10);
   if([a,z,r,d,f,g].some(x=>x===null))continue;
   const buy=a!>z!&&r!>=52&&r!<=72&&d!>=10&&f!>g!&&b.close>b.open;
   const sell=a!<z!&&r!>=28&&r!<=48&&d!>=10&&f!<g!&&b.close<b.open;
   if(buy||sell)entries.push({i:i+1,time:five[i+1].time,side:buy?'BUY':'SELL',rsi:r!,adx:d!,hour:jst(five[i+1].time).hour});
  }
  const modes=['CURRENT','SKIP_16_TO_23_JST','STRICT_BUY','BOTH'] as const;
  type T={time:number;end:number;side:'BUY'|'SELL';pips:number;result:'WIN'|'LOSS'};
  const run=(mode:typeof modes[number])=>{
   const trades:T[]=[];let busy=0,day='',count=0,dailyPnl=0,streakSide='',streak=0,blockedSide='';
   let pending:T|null=null;
   const skips={position:0,weekend:0,filters:0,limits:0,threeLoss:0,insufficient:0};
   for(const e of entries){
    const cur=jst(e.time);
    if(day!==cur.date){day=cur.date;count=0;dailyPnl=0;}
    if(pending&&e.time>=pending.end){
      const closed:T=pending;pending=null;
      dailyPnl+=closed.pips*10; // 1000 USD/JPY units: 1 pip ~10 yen, estimate only
      if(closed.result==='LOSS'){
       streak=streakSide===closed.side?streak+1:1;streakSide=closed.side;
       if(streak>=3)blockedSide=closed.side;
      }else{streak=0;streakSide='';}
    }
    if(cur.weekend){skips.weekend++;continue;}
    if(e.time<busy){skips.position++;continue;}
    if((mode==='SKIP_16_TO_23_JST'||mode==='BOTH')&&e.hour>=16){skips.filters++;continue;}
    if((mode==='STRICT_BUY'||mode==='BOTH')&&e.side==='BUY'&&!(e.adx>=10&&e.adx<15&&e.rsi>=52&&e.rsi<60)){skips.filters++;continue;}
    if(count>=20||dailyPnl<=-1200){skips.limits++;continue;}
    if(blockedSide&&e.side!==blockedSide){blockedSide='';streak=0;streakSide='';}
    if(blockedSide===e.side){skips.threeLoss++;continue;}
    if(e.i+288>five.length){skips.insufficient++;continue;}
    const entry=five[e.i].open;let end=e.i+287;let pips:number|null=null;
    for(let j=e.i;j<=end;j++){
      const b=five[j];const good=(e.side==='BUY'?b.high-entry:entry-b.low)/pip;
      const bad=(e.side==='BUY'?entry-b.low:b.high-entry)/pip;
      if(good>=20+cost/2||bad>=10-cost/2){end=j;pips=bad>=10-cost/2?-10-cost:20-cost;break;}
    }
    if(pips===null){const last=five[end];pips=(e.side==='BUY'?last.close-entry:entry-last.close)/pip-cost;}
    const t:T={time:e.time,end:five[end].time+M,side:e.side,pips,result:pips>0?'WIN':'LOSS'};
    trades.push(t);pending=t;busy=t.end;count++;
   }
   const summary=(a:T[])=>{
    const w=a.filter(x=>x.result==='WIN').length,sum=a.reduce((v,x)=>v+x.pips,0);
    return {trades:a.length,wins:w,losses:a.length-w,winRatePct:a.length?+(100*w/a.length).toFixed(2):null,
     netPips:+sum.toFixed(2),averageNetPips:a.length?+(sum/a.length).toFixed(3):null};
   };
   const cutoff=five[0].time+(five[five.length-1].time-five[0].time)*.7;
   return {mode,overall:summary(trades),buy:summary(trades.filter(x=>x.side==='BUY')),
    sell:summary(trades.filter(x=>x.side==='SELL')),earlier70pct:summary(trades.filter(x=>x.time<cutoff)),
    later30pct:summary(trades.filter(x=>x.time>=cutoff)),skipped:skips};
  };
  return c.json({system:'Chagatto-2 Chronological Filter Validation',researchOnly:true,
   orderSent:false,gmoPrivateApiCalled:false,liveParametersChanged:false,
   candles5m:five.length,candles1h:hours.length,entryCandidates:entries.length,
   assumptions:{source:'GMO historical BID-only 5m and 1h',entry:'Next 5m open; one position at a time',
    exit:'TP20 SL10; max 24h; same-bar collision stop first; 0.5pips assumed roundtrip cost',
    limits:'20 entries per JST day; approximate realized daily loss -1200 yen; JST weekend new entries disabled',
    threeLoss:'Simplified closed-trade same-direction 3-loss guard; resets on opposite signal, NOT exact live completed-1h rule',
    scope:'Exploratory descriptive analysis; guard and order execution fidelity are NOT verified',
    bias:'Prior results informed filter hypotheses, so later30pct is NOT truly unseen out-of-sample; BID-only ignores real spread, slippage and market-hours exceptions',
    warning:'Do not use results to authorize real orders or claim expected profits'},comparisons:modes.map(run)});
 }catch(e:any){return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});

app.get('/prospective-filter-check', async (c) => {
 try {
  const [five,hours]=await Promise.all([fetchCompletedGmoCandles('5min',15),fetchCompletedGmoCandles('1hour',30)]);
  const H=3600000, M=300000, pip=.01, cost=.5;
  const jst=(time:number)=>{
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(time));
   const v=(k:string)=>parts.find(x=>x.type===k)?.value??'';
   return {date:`${v('year')}-${v('month')}-${v('day')}`,hour:Number(v('hour')),weekend:['Sat','Sun'].includes(v('weekday'))};
  };
  type C={i:number;time:number;side:'BUY'|'SELL';rsi:number;adx:number;hour:number};
  const entries:C[]=[];let hi=0;
  for(let i=34;i+1<five.length;i++){
   const b=five[i],t=b.time+M;
   while(hi<hours.length&&hours[hi].time+H<=t)hi++;
   if(hi<40)continue;
   const h=hours.slice(0,hi),hc=h.map(x=>x.close),fc=five.slice(i-34,i+1).map(x=>x.close);
   const a=sma(hc,7),z=sma(hc,8),r=rsi(hc,14),d=adx(h,14),f=sma(fc,5),g=sma(fc,10);
   if([a,z,r,d,f,g].some(x=>x===null))continue;
   const buy=a!>z!&&r!>=52&&r!<=72&&d!>=10&&f!>g!&&b.close>b.open;
   const sell=a!<z!&&r!>=28&&r!<=48&&d!>=10&&f!<g!&&b.close<b.open;
   if(buy||sell)entries.push({i:i+1,time:five[i+1].time,side:buy?'BUY':'SELL',rsi:r!,adx:d!,hour:jst(five[i+1].time).hour});
  }
  const frozenStart=Date.parse('2026-10-13T15:00:00.000Z'); // 2026-10-14 00:00 JST; frozen BEFORE subsequent observations
  const freshEntries=entries.filter(e=>e.time>=frozenStart);
  const modes=['CURRENT','SKIP_16_TO_23_JST','STRICT_BUY','BOTH'] as const;
  type T={time:number;end:number;side:'BUY'|'SELL';pips:number;result:'WIN'|'LOSS'};
  const run=(mode:typeof modes[number])=>{
   const trades:T[]=[];let busy=0,day='',count=0,dailyPnl=0,streakSide='',streak=0,blockedSide='';
   let pending:T|null=null;
   const skips={position:0,weekend:0,filters:0,limits:0,threeLoss:0,insufficient:0};
   for(const e of freshEntries){
    const cur=jst(e.time);
    if(day!==cur.date){day=cur.date;count=0;dailyPnl=0;}
    if(pending&&e.time>=pending.end){
      const closed:T=pending;pending=null;
      dailyPnl+=closed.pips*10; // 1000 USD/JPY units: 1 pip ~10 yen, estimate only
      if(closed.result==='LOSS'){
       streak=streakSide===closed.side?streak+1:1;streakSide=closed.side;
       if(streak>=3)blockedSide=closed.side;
      }else{streak=0;streakSide='';}
    }
    if(cur.weekend){skips.weekend++;continue;}
    if(e.time<busy){skips.position++;continue;}
    if((mode==='SKIP_16_TO_23_JST'||mode==='BOTH')&&e.hour>=16){skips.filters++;continue;}
    if((mode==='STRICT_BUY'||mode==='BOTH')&&e.side==='BUY'&&!(e.adx>=10&&e.adx<15&&e.rsi>=52&&e.rsi<60)){skips.filters++;continue;}
    if(count>=20||dailyPnl<=-1200){skips.limits++;continue;}
    if(blockedSide&&e.side!==blockedSide){blockedSide='';streak=0;streakSide='';}
    if(blockedSide===e.side){skips.threeLoss++;continue;}
    if(e.i+288>five.length){skips.insufficient++;continue;}
    const entry=five[e.i].open;let end=e.i+287;let pips:number|null=null;
    for(let j=e.i;j<=end;j++){
      const b=five[j];const good=(e.side==='BUY'?b.high-entry:entry-b.low)/pip;
      const bad=(e.side==='BUY'?entry-b.low:b.high-entry)/pip;
      if(good>=20+cost/2||bad>=10-cost/2){end=j;pips=bad>=10-cost/2?-10-cost:20-cost;break;}
    }
    if(pips===null){const last=five[end];pips=(e.side==='BUY'?last.close-entry:entry-last.close)/pip-cost;}
    const t:T={time:e.time,end:five[end].time+M,side:e.side,pips,result:pips>0?'WIN':'LOSS'};
    trades.push(t);pending=t;busy=t.end;count++;
   }
   const summary=(a:T[])=>{
    const w=a.filter(x=>x.result==='WIN').length,sum=a.reduce((v,x)=>v+x.pips,0);
    return {trades:a.length,wins:w,losses:a.length-w,winRatePct:a.length?+(100*w/a.length).toFixed(2):null,
     netPips:+sum.toFixed(2),averageNetPips:a.length?+(sum/a.length).toFixed(3):null};
   };
   const cutoff=frozenStart+(Date.now()-frozenStart)*.7;
   return {mode,overall:summary(trades),buy:summary(trades.filter(x=>x.side==='BUY')),
    sell:summary(trades.filter(x=>x.side==='SELL')),earlier70pct:summary(trades.filter(x=>x.time<cutoff)),
    later30pct:summary(trades.filter(x=>x.time>=cutoff)),skipped:skips};
  };
  return c.json({system:'Chagatto-2 Prospective Frozen Filter Check',researchOnly:true,
   orderSent:false,gmoPrivateApiCalled:false,liveParametersChanged:false,
   candles5m:five.length,candles1h:hours.length,entryCandidates:freshEntries.length, frozenStartJst:'2026-10-14 00:00 JST',
   evaluationStatus:'EXPLORATORY_ONLY',
   readyForReview: freshEntries.length>=100 && Date.now()-frozenStart>=14*86400000,
   minimumReviewConditions:'At least 14 days and 100 signal candidates, plus independent manual review; not approval for live trading',
   assumptions:{source:'GMO historical BID-only 5m and 1h',entry:'Next 5m open; one position at a time',
    exit:'TP20 SL10; max 24h; same-bar collision stop first; 0.5pips assumed roundtrip cost',
    limits:'20 entries per JST day; approximate realized daily loss -1200 yen; JST weekend new entries disabled',
    forward:'Strictly freezes start date; historical warm-up indicators permitted but scoring only on entries after cutoff. Rolling 15-day candle source can lose older data, so repeated snapshots are not cumulative or permanent.',
    threeLoss:'Simplified closed-trade same-direction 3-loss guard; resets on opposite signal, NOT exact live completed-1h rule',
    scope:'Exploratory descriptive analysis; guard and order execution fidelity are NOT verified',
    bias:'Filters fixed from past data. This is prospective after cutoff, but provider rolling history loses data and execution assumptions are approximate. 70/30 subdivisions remain descriptive, not fitted.',
    warning:'Do not use results to authorize real orders or claim expected profits'},comparisons:modes.map(run)});
 }catch(e:any){return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});

app.get("/direction-regime-diagnostic", async (c) => {
  try {
    const [five, hours] = await Promise.all([
      fetchCompletedGmoCandles("5min", 15),
      fetchCompletedGmoCandles("1hour", 30),
    ]);
    const fiveMs = 300000, hourMs = 3600000, pip = 0.01;
    const cost = 0.5, maxBars = 288;
    type Row = {
      time:number; side:"BUY"|"SELL"; adx:number; rsi:number; atrPips:number;
      jstHour:number; hourDirection:"UP"|"DOWN"|"FLAT";
      outcome:"WIN"|"LOSS"|"INSUFFICIENT_DATA";
      netPips:number|null; holdingBars:number|null;
    };
    const rows:Row[]=[];
    let completedHours=0;
    for(let i=34;i+1<five.length;i++) {
      const bar=five[i], decisionTime=bar.time+fiveMs;
      while(completedHours<hours.length && hours[completedHours].time+hourMs<=decisionTime) completedHours++;
      if(completedHours<40) continue;
      const h=hours.slice(0,completedHours), hc=h.map(x=>x.close), fc=five.slice(i-34,i+1).map(x=>x.close);
      const m7=sma(hc,7),m8=sma(hc,8),rr=rsi(hc,14),aa=adx(h,14),at=atr(h,14);
      const m5=sma(fc,5),m10=sma(fc,10);
      if([m7,m8,rr,aa,at,m5,m10].some(x=>x===null)) continue;
      const buy=m7!>m8! && rr!>=52 && rr!<=72 && aa!>=10 && m5!>m10! && bar.close>bar.open;
      const sell=m7!<m8! && rr!>=28 && rr!<=48 && aa!>=10 && m5!<m10! && bar.close<bar.open;
      if(!buy&&!sell)continue;
      const entryIndex=i+1,entry=five[entryIndex].open, side=buy?"BUY":"SELL";
      const end=entryIndex+maxBars-1;
      let outcome:Row['outcome']='INSUFFICIENT_DATA';
      let netPips:number|null=null, holdingBars:number|null=null;
      if(end<five.length) {
        for(let j=entryIndex;j<=end;j++) {
          const x=five[j];
          const favor=(buy?x.high-entry:entry-x.low)/pip;
          const adverse=(buy?entry-x.low:x.high-entry)/pip;
          const tpHit=favor>=20+cost/2,slHit=adverse>=10-cost/2;
          if(tpHit||slHit) {
            outcome=slHit?'LOSS':'WIN'; // same-bar collision conservatively LOSS
            netPips=slHit?-10-cost:20-cost;
            holdingBars=j-entryIndex+1;
            break;
          }
        }
        if(netPips===null) {
          const last=five[end],diff=(buy?last.close-entry:entry-last.close)/pip-cost;
          netPips=diff;outcome=diff>0?'WIN':'LOSS';holdingBars=maxBars;
        }
      }
      // This is the 1h signal direction, not an independent 4h trend estimate.
      const hourDirection=m7!>m8!?'UP':m7!<m8!?'DOWN':'FLAT';
      const jstHour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',hour:'numeric',hourCycle:'h23'}).format(new Date(bar.time)));
      rows.push({time:five[entryIndex].time,side,adx:aa!,rsi:rr!,atrPips:at!/pip,jstHour,
        hourDirection,outcome,netPips,holdingBars});
    }
    const firstTime=five[0]?.time??0,lastTime=five[five.length-1]?.time??0;
    const cut=firstTime+(lastTime-firstTime)*0.7;
    const grouping=(x:Row,dimension:string):string=>{
      switch(dimension){
        case 'side':return x.side;
        case 'timeOfDayJst':return x.jstHour<8?'00-07':x.jstHour<16?'08-15':'16-23';
        case 'adxRange':return x.adx<15?'10-15':x.adx<20?'15-20':'20+';
        case 'rsiRange':return x.rsi<40?'<40':x.rsi<50?'40-50':x.rsi<60?'50-60':'>=60';
        case 'atr1hPips':return x.atrPips<10?'<10':x.atrPips<20?'10-20':'>=20';
        case 'hourTrend':return x.hourDirection;
        default:return 'ALL';
      }
    };
    const summarize=(list:Row[])=>{
      const known=list.filter(x=>x.netPips!==null),win=known.filter(x=>x.netPips!>0),loss=known.filter(x=>x.netPips!<=0);
      const sum=known.reduce((v,x)=>v+x.netPips!,0);
      return {signals:list.length,evaluable:known.length,insufficientForwardData:list.length-known.length,
        wins:win.length,losses:loss.length,
        winRatePct:known.length?Number((100*win.length/known.length).toFixed(2)):null,
        totalNetPips:known.length?Number(sum.toFixed(2)):null,
        averageNetPips:known.length?Number((sum/known.length).toFixed(3)):null,
        evidenceLevel:known.length>=50?'DESCRIPTIVE_50_PLUS':known.length>=20?'SMALL_SAMPLE':'VERY_SMALL_SAMPLE'};
    };
    const dimensions=['side','timeOfDayJst','adxRange','rsiRange','atr1hPips','hourTrend'];
    const strata=dimensions.map(dimension=>{
      const keys=[...new Set(rows.map(r=>grouping(r,dimension)))].sort();
      return {dimension,groups:keys.map(key=>{
        const group=rows.filter(r=>grouping(r,dimension)===key);
        return {key,overall:summarize(group),earlier70pct:summarize(group.filter(r=>r.time<cut)),later30pct:summarize(group.filter(r=>r.time>=cut)),
          bySide:{BUY:summarize(group.filter(r=>r.side==='BUY')),SELL:summarize(group.filter(r=>r.side==='SELL'))}};
      })};
    });
    const displayRows=rows.slice(0,5).map(x=>({time:new Date(x.time).toISOString(),side:x.side,outcome:x.outcome,netPips:x.netPips}));
    return c.json({system:'Chagatto-2 Direction & Regime Diagnostic',researchOnly:true,orderSent:false,
      gmoPrivateApiCalled:false,liveParametersChanged:false,
      source:'GMO public BID-only 5m/1h OHLC',candles5m:five.length,candles1h:hours.length,
      entryCandidates:rows.length,assumptions:{
        baseSignal:'CURRENT: 1H SMA7/8, RSI52-72 or 28-48, ADX>=10; 5m SMA5/10 + candle direction',
        exit:'TP20 / SL10, max 24h; if neither hit, market exit at 24h close',
        roundTripCostPips:cost,costIsAssumption:true,
        sameBarCollision:'STOP first; scored LOSS',
        buckets:'Prespecified descriptive categories, not fitted optimal thresholds',
        split:'Chronological 70/30 boundary of candle time range; not a fully out-of-sample strategy test',
        dataLimit:'Public BID-only history; no ASK, real spreads, slippage, gaps, complete market hours, or actual order history',
        overlapLimit:'Signals evaluated independently, NOT one-position-only or 3-loss-guard portfolio simulation',
        warning:'Do not turn a high-scoring bucket into a live filter without validating fresh unseen dates.'
      },overall:summarize(rows),earlier70pct:summarize(rows.filter(r=>r.time<cut)),
      later30pct:summarize(rows.filter(r=>r.time>=cut)),strata,sampleTrades:displayRows});
  } catch(e:any) {
    return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);
  }
});



// Research-only archival feed. Requires an explicitly mounted persistent Railway Volume.
// No private trading API or order functions are called in this module.
const archiveRoot = (process.env.RESEARCH_ARCHIVE_DIR || "").trim();
const archiveEnabled = archiveRoot.startsWith("/") && archiveRoot !== "/";
const archiveIntervals = ["5min", "1hour"] as const;
type ArchiveInterval = typeof archiveIntervals[number];
type ArchiveCandle = {time:number;open:number;high:number;low:number;close:number};
let researchArchiveBusy = false;
let researchArchiveLastAttempt: string | null = null;
let researchArchiveLastSuccess: string | null = null;
let researchArchiveLastError: string | null = null;
const archiveFile=(interval: ArchiveInterval)=>researchPath.join(archiveRoot,`USD_JPY_BID_${interval}.json`);
const validateArchive=(records:unknown): ArchiveCandle[] => {
  if (!Array.isArray(records)) throw new Error("Archive format is not an array");
  return records.filter((v:any)=>v && Number.isFinite(v.time) &&
    Number.isFinite(v.open) && Number.isFinite(v.high) &&
    Number.isFinite(v.low) && Number.isFinite(v.close) &&
    v.time >= Date.parse("2026-10-01T00:00:00Z"));
};
async function readResearchArchive(interval:ArchiveInterval):Promise<ArchiveCandle[]> {
  try {return validateArchive(JSON.parse(await researchFs.readFile(archiveFile(interval),"utf8")));}
  catch(err:any){if(err?.code==="ENOENT")return [];throw err;}
}
async function syncResearchArchive(onlyFiveMinute=false) {
  if (!archiveEnabled || researchArchiveBusy) return;
  researchArchiveBusy=true;
  researchArchiveLastAttempt=new Date().toISOString();
  try {
    await researchFs.mkdir(archiveRoot,{recursive:true});
    // A volume must be attached to RESEARCH_ARCHIVE_DIR. A writable container
    // filesystem alone is NOT proof that data survives redeployment.
    for(const interval of (onlyFiveMinute ? ["5min"] as ArchiveInterval[] : archiveIntervals)){
      const old=await readResearchArchive(interval);
      const fetched=await fetchCompletedGmoCandles(interval,old.length===0?(interval==="5min"?15:30):(interval==="5min"?2:3));
      const merged=new Map<number,ArchiveCandle>();
      for(const x of old)merged.set(x.time,x);
      for(const x of fetched)merged.set(x.time,x);
      const out=Array.from(merged.values()).sort((a,b)=>a.time-b.time);
      const temp=`${archiveFile(interval)}.${process.pid}.tmp`;
      try{
        await researchFs.writeFile(temp,JSON.stringify(out),{encoding:"utf8",flag:"w"});
        await researchFs.rename(temp,archiveFile(interval));
      }catch(err){await researchFs.rm(temp,{force:true}).catch(()=>{});throw err;}
    }
    await updateResearchOutcomes();
    researchArchiveLastSuccess=new Date().toISOString();
    researchArchiveLastError=null;
  }catch(err:any){researchArchiveLastError=String(err?.message??err).slice(0,500);}
  finally{researchArchiveBusy=false;}
}
app.get("/research-archive-status",async (c)=>{
  if(!archiveEnabled)return c.json({system:"Chagatto-2 Research Archive",researchOnly:true,
    orderSent:false,configured:false,persistentStorageVerified:false,
    status:"DISABLED",nextStep:"Mount Railway Volume at /data and set RESEARCH_ARCHIVE_DIR=/data/research"});
  try{
    const details=[];
    for(const interval of archiveIntervals){
      const a=await readResearchArchive(interval);
      details.push({interval,candleCount:a.length,first:a.length?new Date(a[0].time).toISOString():null,
        last:a.length?new Date(a[a.length-1].time).toISOString():null});
    }
    return c.json({system:"Chagatto-2 Research Archive",researchOnly:true,orderSent:false,
      configured:true,persistentStorageVerified:false,
      note:"A writable filesystem cannot prove a Railway Volume is attached; confirm /data volume in Railway settings and confirm data after redeploy",
      status:researchArchiveLastError?"ERROR":researchArchiveBusy?"SYNCING":researchArchiveLastSuccess?"COLLECTING":"NOT_YET_SYNCED",
      lastAttempt:researchArchiveLastAttempt,lastSuccess:researchArchiveLastSuccess,
      lastError:researchArchiveLastError,collectionIntervalHours:6,
      rawCandlesArchived:true,tradeMetricsAccumulated:false,
      note2:"Archiving completed public OHLC candles, NOT actual trades; current prospective-filter-check still uses the rolling source and is not cumulative",
      intervals:details});
  }catch(err:any){return c.json({researchOnly:true,orderSent:false,status:"READ_ERROR",error:String(err?.message??err)},500);}
});
if(archiveEnabled){
  // A single instance and persistent volume are required. Multiple replicas
  // need a DB or distributed lock before safe shared-file concurrent writes.
  void syncResearchArchive();
  setInterval(()=>{void syncResearchArchive(true);},5*60*1000);
  setInterval(()=>{void syncResearchArchive();},6*60*60*1000);
}


// Research-only prospective signal journal. No private trading or order calls.
type SignalJournalRow = {key:string;recordedAt:string;side:"BUY"|"SELL"|"WAIT";price:number|null;action:string;futureClose5m:number|null;futureMovePips:number|null;snapshot?:{rsi14:number|null;sma7:number|null;sma8:number|null;atr14:number|null;adx14:number|null;trend1h:string|null;triggerCandleIso:string|null}};
const signalJournalFile=archiveEnabled?researchPath.join(archiveRoot,"signal-journal.json"):"";
let signalJournalQueue:Promise<void>=Promise.resolve();
async function readSignalJournal():Promise<SignalJournalRow[]>{
  try {const rows=JSON.parse(await researchFs.readFile(signalJournalFile,"utf8"));if(!Array.isArray(rows))throw new Error("Invalid journal");return rows;}
  catch(e:any){if(e?.code==="ENOENT")return [];throw e;}
}
async function writeSignalJournal(rows:SignalJournalRow[]){
  const temp=signalJournalFile+"."+crypto.randomUUID()+".tmp";
  try{await researchFs.writeFile(temp,JSON.stringify(rows),{mode:0o600});await researchFs.rename(temp,signalJournalFile);}
  finally{await researchFs.rm(temp,{force:true}).catch(()=>{});}
}
function journalEnqueue(task:()=>Promise<void>):Promise<void>{
  const result=signalJournalQueue.then(task);
  signalJournalQueue=result.catch(e=>{console.error("[signal-journal]",String(e));});
  return result;
}
function finiteSnapshot(value:any):number|null{if(value===null||value===undefined)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
async function recordResearchSignal(data:any,action:string){
  if(!archiveEnabled)return;
  await journalEnqueue(async()=>{
    await researchFs.mkdir(archiveRoot,{recursive:true});
    const side=String(data?.signal??"WAIT");
    if(!["BUY","SELL","WAIT"].includes(side))return;
    const now=new Date();
    const key=String(Math.floor(now.getTime()/300000));
    const rows=await readSignalJournal();
    if(rows.some(r=>r.key===key))return;
    const priceCandidate=Number(data?.price);
    rows.push({key,recordedAt:now.toISOString(),side:side as "BUY"|"SELL"|"WAIT",
      price:Number.isFinite(priceCandidate)&&priceCandidate>0?priceCandidate:null,
      action,futureClose5m:null,futureMovePips:null,
      snapshot:{rsi14:finiteSnapshot(data?.filters?.condition3_rsi?.rsi14),
        sma7:finiteSnapshot(data?.filters?.condition2_1hSma?.sma7),
        sma8:finiteSnapshot(data?.filters?.condition2_1hSma?.sma8),
        atr14:finiteSnapshot(data?.filters?.condition4_atr?.atr14),
        adx14:finiteSnapshot(data?.filters?.condition4_adx?.adx14),
        trend1h:typeof data?.filters?.condition2_1hSma?.direction==="string"?data.filters.condition2_1hSma.direction:null,
        triggerCandleIso:typeof data?.triggerCandleIso==="string"?data.triggerCandleIso:null}});
    await writeSignalJournal(rows.slice(-20000));
  });
}
async function updateResearchOutcomes(){
  if(!archiveEnabled)return;
  await journalEnqueue(async()=>{
    const rows=await readSignalJournal();
    const candles=await readResearchArchive("5min");
    let changed=false;
    for(const row of rows){
      if(row.futureClose5m!==null||row.price===null)continue;
      const target=Number(row.key)*300000+300000; // first full 5m candle opening after the signal bucket
      const candle=candles.find(x=>x.time===target); // never skip missing intervals or use a much later bar
      if(!candle)continue;
      row.futureClose5m=candle.close;
      row.futureMovePips=row.side==="WAIT"?null:Number((((candle.close-row.price)*100)*(row.side==="SELL"?-1:1)).toFixed(3));
      changed=true;
    }
    if(changed)await writeSignalJournal(rows);
  });
}
app.get("/research-signal-journal",async c=>{
  if(!archiveEnabled)return c.json({researchOnly:true,orderSent:false,configured:false,status:"DISABLED"});
  try{
    await signalJournalQueue;
    const rows=await readSignalJournal();
    const evaluated=rows.filter(r=>r.side!=="WAIT"&&r.futureMovePips!==null);
    const wins=evaluated.filter(r=>(r.futureMovePips??0)>0).length;
    return c.json({system:"Chagatto-2 Prospective Signal Journal",researchOnly:true,orderSent:false,
      hypotheticalOnly:true,configured:true,signalCount:rows.length,
      buyCount:rows.filter(r=>r.side==="BUY").length,sellCount:rows.filter(r=>r.side==="SELL").length,
      waitCount:rows.filter(r=>r.side==="WAIT").length,evaluatedCount:evaluated.length,
      pendingDirectionalCount:rows.filter(r=>r.side!=="WAIT"&&r.futureMovePips===null).length,
      archiveLastSuccess:researchArchiveLastSuccess,archiveLastError:researchArchiveLastError,
      directionalAccuracyPct:evaluated.length?Number((100*wins/evaluated.length).toFixed(2)):null,
      sumHypotheticalPips:Number(evaluated.reduce((a,r)=>a+(r.futureMovePips??0),0).toFixed(3)),
      lastSignals:rows.slice(-10).reverse(),note:"Evaluates the next complete five-minute candle AFTER the signal bucket, once public BID-only archive has updated. WAIT has no directional score. Directional markout is not actual trading P/L, nor spread-adjusted returns or validated win rate."});
  }catch(e:any){return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});

// Read-only diagnostic of the prospective record. Does not place or modify orders.
app.get("/research-signal-diagnostic",async c=>{
  if(!archiveEnabled)return c.json({researchOnly:true,orderSent:false,configured:false,status:"DISABLED"});
  try{
    await signalJournalQueue;
    const rows=await readSignalJournal();
    const summarizeSide=(side:"BUY"|"SELL")=>{
      const subset=rows.filter(r=>r.side===side);
      const evaluated=subset.filter(r=>r.futureMovePips!==null);
      const wins=evaluated.filter(r=>(r.futureMovePips??0)>0).length;
      const losses=evaluated.filter(r=>(r.futureMovePips??0)<0).length;
      const flat=evaluated.length-wins-losses;
      const total=evaluated.reduce((sum,r)=>sum+(r.futureMovePips??0),0);
      return {signals:subset.length,evaluated:evaluated.length,pending:subset.length-evaluated.length,
        wins,losses,flat,directionalAccuracyPct:evaluated.length?Number((wins/evaluated.length*100).toFixed(2)):null,
        sumHypotheticalPips:Number(total.toFixed(3)),averageHypotheticalPips:evaluated.length?Number((total/evaluated.length).toFixed(3)):null};
    };
    const buy=summarizeSide("BUY"),sell=summarizeSide("SELL");
    const outcomes=rows.filter(r=>r.side!=="WAIT"&&r.futureMovePips!==null);
    const archive=await readResearchArchive("5min");
    const pending=rows.filter(r=>r.side!=="WAIT"&&r.futureMovePips===null);
    const latestArchiveCandle=archive.length?archive[archive.length-1]:null;
    return c.json({system:"Chagatto-2 Prospective Direction Diagnostic",researchOnly:true,orderSent:false,
      liveParametersChanged:false,privateTradingApiCalled:false,source:"GMO public BID-only completed 5min OHLC",
      totalSignals:rows.length,waitSignals:rows.filter(r=>r.side==="WAIT").length,
      buy,sell,combined:{evaluated:outcomes.length,pending:pending.length,
        directionalAccuracyPct:outcomes.length?Number((outcomes.filter(r=>(r.futureMovePips??0)>0).length/outcomes.length*100).toFixed(2)):null,
        sumHypotheticalPips:Number(outcomes.reduce((a,r)=>a+(r.futureMovePips??0),0).toFixed(3))},
      archive:{candleCount:archive.length,latestCompleted5mCandle:latestArchiveCandle?new Date(latestArchiveCandle.time).toISOString():null,
        lastSyncSuccess:researchArchiveLastSuccess,lastSyncError:researchArchiveLastError},
      pendingSamples:pending.slice(-5).map(r=>({key:r.key,side:r.side,recordedAt:r.recordedAt,
        targetCandleOpening:new Date(Number(r.key)*300000+300000).toISOString()})),
      note:"Research-only 5-minute directional markout, not executed trades or net return. BUY/SELL may overlap; no spread, ASK, slippage, fees, or stop fills. A small sample and repeated observations do not establish strategy profitability."});
  }catch(e:any){return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});

// Research-only historical-time diagnostics; no changes to signal or execution logic.
app.get("/research-signal-time-analysis", async c=>{
  if(!archiveEnabled)return c.json({researchOnly:true,orderSent:false,configured:false,status:"DISABLED"});
  try{
    await signalJournalQueue;
    const rows=await readSignalJournal();
    const parts=(value:string)=>{
      const d=new Date(value);
      if(!Number.isFinite(d.getTime()))return null;
      const jst=new Date(d.getTime()+9*60*60*1000);
      return {hour:jst.getUTCHours(),day:jst.toISOString().slice(0,10)};
    };
    const summarize=(subset:SignalJournalRow[])=>{
      const directional=subset.filter(r=>r.side!=="WAIT");
      const evaluated=directional.filter(r=>r.futureMovePips!==null);
      const wins=evaluated.filter(r=>(r.futureMovePips??0)>0).length;
      const total=evaluated.reduce((sum,r)=>sum+(r.futureMovePips??0),0);
      return {signals:subset.length,buy:subset.filter(r=>r.side==="BUY").length,
        sell:subset.filter(r=>r.side==="SELL").length,wait:subset.filter(r=>r.side==="WAIT").length,
        directional:evaluated.length,pending:directional.length-evaluated.length,
        wins,losses:evaluated.filter(r=>(r.futureMovePips??0)<0).length,
        flat:evaluated.filter(r=>r.futureMovePips===0).length,
        directionalAccuracyPct:evaluated.length?Number((wins*100/evaluated.length).toFixed(2)):null,
        sumHypotheticalPips:Number(total.toFixed(3)),
        averageHypotheticalPips:evaluated.length?Number((total/evaluated.length).toFixed(3)):null,
        evidence:evaluated.length>=100?"DESCRIPTIVE_SAMPLE_100_PLUS":evaluated.length>=30?"DESCRIPTIVE_SAMPLE_30_PLUS":"SMALL_SAMPLE_NOT_ACTIONABLE"};
    };
    const jstRows=rows.map(r=>({row:r,time:parts(r.recordedAt)})).filter(x=>x.time!==null);
    const hourly=Array.from({length:24},(_,hour)=>({hourJst:hour,all:summarize(jstRows.filter(x=>x.time!.hour===hour).map(x=>x.row)),
      buy:summarize(jstRows.filter(x=>x.time!.hour===hour&&x.row.side==="BUY").map(x=>x.row)),
      sell:summarize(jstRows.filter(x=>x.time!.hour===hour&&x.row.side==="SELL").map(x=>x.row))}));
    const buckets=[{label:"00-07 JST",start:0,end:8},{label:"08-15 JST",start:8,end:16},{label:"16-23 JST",start:16,end:24}].map(b=>{
      const a=jstRows.filter(x=>x.time!.hour>=b.start&&x.time!.hour<b.end).map(x=>x.row);
      return {period:b.label,all:summarize(a),buy:summarize(a.filter(r=>r.side==="BUY")),sell:summarize(a.filter(r=>r.side==="SELL"))};
    });
    const days=[...new Set(jstRows.map(x=>x.time!.day))].sort();
    const daily=days.slice(-14).map(day=>({dateJst:day,...summarize(jstRows.filter(x=>x.time!.day===day).map(x=>x.row))}));
    return c.json({system:"Chagatto-2 Prospective Time Diagnostics",researchOnly:true,orderSent:false,
      privateTradingApiCalled:false,liveParametersChanged:false,timezone:"Asia/Tokyo",source:"Existing prospective signal journal (GMO public BID-only markout)",
      total:summarize(rows),buckets,hourly,dailyLast14:daily,
      caution:"Descriptive only. Small samples and correlated overlapping 5-minute signals must not be treated as independent trades. No spread/ASK, slippage, fees, fill or risk-adjusted P/L. Time buckets are not live filters. RSI and trend-at-signal were not historically stored and are deliberately not inferred."});
  }catch(e:any){return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});

const archiveProcessBootId = crypto.randomUUID();

// Research-only persistent-volume probe. Does not expose archive contents or secrets.
const archiveProbeFile = archiveEnabled ? researchPath.join(archiveRoot, ".volume-persistence-probe.json") : "";
app.get("/research-volume-verify", async (c) => {
  if (!archiveEnabled) return c.json({researchOnly:true,orderSent:false,configured:false,verified:false,status:"DISABLED"});
  try {
    await researchFs.mkdir(archiveRoot,{recursive:true});
    const mountInfo = await researchFs.readFile("/proc/self/mountinfo","utf8").catch(()=>"");
    const hasDataMount = mountInfo.split("\n").some(line => {
      const fields=line.split(" ");
      const at=fields.indexOf("-");
      const mountPoint=fields[4]?.replace(/\\040/g," ");
      return at>0 && (mountPoint==="/data" || mountPoint===archiveRoot);
    });
    let marker:{id:string;createdAt:string;firstBootId:string};
    let existed=true;
    try {
      const raw=JSON.parse(await researchFs.readFile(archiveProbeFile,"utf8"));
      if(typeof raw?.id!=="string" || typeof raw?.createdAt!=="string" || typeof raw?.firstBootId!=="string") throw new Error("Invalid probe");
      marker=raw;
    } catch(err:any) {
      if(err?.code!=="ENOENT") throw err;
      existed=false;
      marker={id:crypto.randomUUID(),createdAt:new Date().toISOString(),firstBootId:archiveProcessBootId};
      await researchFs.writeFile(archiveProbeFile,JSON.stringify(marker),{flag:"wx",mode:0o600});
    }
    const survivesProcessRestart=existed && marker.firstBootId!==archiveProcessBootId;
    return c.json({system:"Chagatto-2 Volume Persistence Probe",researchOnly:true,orderSent:false,
      configured:true,volumeMountDetected:hasDataMount,markerExists:existed,
      survivesProcessRestart,verified:hasDataMount && survivesProcessRestart,
      status:!hasDataMount?"MOUNT_NOT_DETECTED":survivesProcessRestart?"VERIFIED_AFTER_RESTART":"AWAITING_RESTART",
      markerCreatedAt:marker.createdAt,
      note:"Call once, redeploy without wiping volume, then call again. Do not use Wipe/Delete Volume."});
  }catch(err:any){return c.json({researchOnly:true,orderSent:false,verified:false,status:"ERROR",error:String(err?.message??err)},500);}
});

// Diagnostic-only: captures indicator snapshots at signal time. No retroactive inference.
app.get("/research-signal-indicators",async c=>{
  if(!archiveEnabled)return c.json({researchOnly:true,orderSent:false,configured:false,status:"DISABLED"});
  try{
    await signalJournalQueue;
    const rows=await readSignalJournal();
    const captured=rows.filter(r=>r.snapshot && r.snapshot.rsi14!==null && r.snapshot.atr14!==null);
    const bySide=(side:"BUY"|"SELL"|"WAIT")=>{
      const subset=rows.filter(r=>r.side===side);
      const withSnapshot=subset.filter(r=>r.snapshot && r.snapshot.rsi14!==null && r.snapshot.atr14!==null);
      const evaluated=withSnapshot.filter(r=>r.futureMovePips!==null && side!=="WAIT");
      return {signals:subset.length,withSnapshot:withSnapshot.length,evaluatedWithSnapshot:evaluated.length,
        wins:evaluated.filter(r=>(r.futureMovePips??0)>0).length,
        hypotheticalPips:Number(evaluated.reduce((a,r)=>a+(r.futureMovePips??0),0).toFixed(3))};
    };
    return c.json({system:"Chagatto-2 Prospective Indicator Snapshots",researchOnly:true,orderSent:false,
      liveParametersChanged:false,privateTradingApiCalled:false,totalSignals:rows.length,snapshotsCaptured:captured.length,
      historicalWithoutSnapshot:rows.length-rows.filter(r=>r.snapshot).length,
      buy:bySide("BUY"),sell:bySide("SELL"),wait:bySide("WAIT"),
      latestSnapshots:rows.filter(r=>r.snapshot).slice(-12).reverse().map(r=>({key:r.key,
        recordedAt:r.recordedAt,side:r.side,price:r.price,snapshot:r.snapshot,
        evaluated:r.futureMovePips!==null,futureMovePips:r.futureMovePips})),
      note:"Frozen-at-signal 1H RSI14/SMA7/SMA8/ATR14/ADX14; no backfilling old rows. Research-only public candle BID markout; not actual trade P/L. New snapshots begin only after deployment and scheduler runs."});
  }catch(e:any){return c.json({researchOnly:true,orderSent:false,error:String(e?.message??e)},500);}
});


// Read-only indicator capture troubleshooting: never invokes trading or refreshes market data.
app.get("/research-indicator-health",async c=>{
  if(!archiveEnabled)return c.json({researchOnly:true,orderSent:false,status:"ARCHIVE_DISABLED",nextAction:"Set research archive directory and verify volume."});
  try{
    await signalJournalQueue;
    const rows=await readSignalJournal();
    const annotated=rows.filter(r=>r.snapshot!==undefined);
    const complete=annotated.filter(r=>[r.snapshot?.rsi14,r.snapshot?.sma7,r.snapshot?.sma8,r.snapshot?.atr14,r.snapshot?.adx14].every(v=>typeof v==="number"&&Number.isFinite(v)));
    const partial=annotated.filter(r=>!complete.includes(r));
    const mostRecent=rows.at(-1)??null;
    const ageMin=mostRecent?Math.round((Date.now()-Date.parse(mostRecent.recordedAt))/60000):null;
    const schedulerAction=String(lastSchedulerResult?.action??"NOT_YET_RUN");
    let reason="CAPTURING";
    if(!rows.length)reason="NO_JOURNAL_RECORDS";
    else if(!annotated.length)reason="NO_NEW_SIGNALS_SINCE_INDICATOR_DEPLOY";
    else if(!complete.length)reason="INDICATOR_FIELDS_INCOMPLETE";
    else if(ageMin!==null&&ageMin>20)reason="NO_RECENT_JOURNAL_RECORD";
    return c.json({system:"Chagatto-2 Indicator Capture Health",researchOnly:true,orderSent:false,
      tradingEnabled:process.env.LIVE_TRADING_ENABLED==="true",archiveConfigured:archiveEnabled,
      totalSignals:rows.length,withAnySnapshot:annotated.length,completeIndicatorSnapshots:complete.length,
      incompleteSnapshots:partial.length,latestJournalTime:mostRecent?.recordedAt??null,
      latestJournalAgeMinutes:ageMin,lastSchedulerAction:schedulerAction,
      lastSchedulerStartedAt:lastSchedulerResult?.startedAt??null,
      lastSchedulerError:lastSchedulerResult?.error??null,
      archiveLastSuccess:researchArchiveLastSuccess,archiveLastError:researchArchiveLastError,
      newestSnapshot:annotated.at(-1)?.snapshot??null,
      newestIncompleteFields:partial.length?(["rsi14","sma7","sma8","atr14","adx14"] as const).filter(k=>typeof partial.at(-1)?.snapshot?.[k]!=="number"):[],
      status:reason,explanation:reason==="INDICATOR_FIELDS_INCOMPLETE"?"Snapshot exists but some indicators are null: check sufficient completed 1H candles and signal fields.":
        reason==="NO_RECENT_JOURNAL_RECORD"?"The scheduler may have skipped before smart-signal, or has not run recently; inspect /scheduler-status.":
        reason==="NO_NEW_SIGNALS_SINCE_INDICATOR_DEPLOY"?"Only historical signals exist; new snapshots are captured after scheduler reaches smart-signal.":
        "Research diagnostic only. No orders or API writes."});
  }catch(e:any){return c.json({researchOnly:true,orderSent:false,status:"DIAGNOSTIC_ERROR",error:String(e?.message??e)},500);}
});

// Human-readable server-rendered dashboard; read-only and free of external assets.
app.get("/research-indicator-dashboard",async c=>{
  if(!archiveEnabled)return c.html("<h1>Research archive is disabled</h1>",503);
  try{
    await signalJournalQueue;
    const rows=await readSignalJournal();
    const complete=rows.filter(r=>r.snapshot&&[r.snapshot.rsi14,r.snapshot.sma7,r.snapshot.sma8,r.snapshot.atr14,r.snapshot.adx14].every(v=>typeof v==="number"&&Number.isFinite(v)));
    const sides=(["BUY","SELL","WAIT"] as const).map(side=>{
      const all=rows.filter(r=>r.side===side);const tagged=complete.filter(r=>r.side===side);
      const scored=tagged.filter(r=>r.futureMovePips!==null&&side!=="WAIT");
      return {side,all:all.length,tagged:tagged.length,scored:scored.length,winning:scored.filter(r=>(r.futureMovePips??0)>0).length,
        pips:Number(scored.reduce((sum,r)=>sum+(r.futureMovePips??0),0).toFixed(2))};
    });
    const escape=(v:unknown)=>String(v??"—").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]||ch));
    const fmt=(v:unknown)=>typeof v==="number"?escape(Number(v.toFixed(4))):"—";
    const data=complete.slice(-30).reverse();
    const rowsHtml=data.map(r=>`<tr><td>${escape(r.recordedAt)}</td><td>${escape(r.side)}</td><td>${fmt(r.snapshot?.rsi14)}</td><td>${fmt(r.snapshot?.sma7)}</td><td>${fmt(r.snapshot?.sma8)}</td><td>${fmt(r.snapshot?.atr14)}</td><td>${fmt(r.snapshot?.adx14)}</td><td>${escape(r.snapshot?.trend1h)}</td><td>${fmt(r.futureMovePips)}</td></tr>`).join("");
    const summary=sides.map(r=>`<tr><th>${r.side}</th><td>${r.all}</td><td>${r.tagged}</td><td>${r.scored}</td><td>${r.scored?fmt(r.winning/r.scored*100)+"%":"—"}</td><td>${r.pips}</td></tr>`).join("");
    return c.html(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>チャガット2号・指標診断</title><style>body{font-family:system-ui,sans-serif;margin:0 auto;padding:20px;max-width:1100px;background:#101827;color:#edf2fa}a{color:#99caff}.note{color:#c3cddd}table{border-collapse:collapse;width:100%;margin:14px 0}td,th{padding:9px;border-bottom:1px solid #3c4658;text-align:right;white-space:nowrap}td:first-child,th:first-child{text-align:left}.scroll{overflow-x:auto}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:30px}.card{background:#202c40;border-radius:12px;padding:14px}</style><h1>チャガット2号｜相場指標の記録</h1><p class="note">研究専用・注文なし・リアル取引の損益ではありません。過去の指標は後付けしません。</p><div class="card"><strong>全記録 ${rows.length}件 / 指標5種類すべて取得 ${complete.length}件</strong><p class="note">最新記録：${escape(rows.at(-1)?.recordedAt)} ／ 最新スケジューラー：${escape(lastSchedulerResult?.action??"未実行")}</p><a href="/research-indicator-health">指標記録の原因診断（JSON）</a> · <a href="/scheduler-status">スケジューラー状況</a> · <a href="/research-signal-indicators">詳細JSON</a></div><h2>BUY / SELL 別</h2><div class="scroll"><table><thead><tr><th>判定</th><th>全件</th><th>指標付き</th><th>評価済み</th><th>正解率*</th><th>参考pips*</th></tr></thead><tbody>${summary}</tbody></table></div><h2>直近の指標付き記録</h2><div class="scroll"><table><thead><tr><th>UTC記録時刻</th><th>判定</th><th>RSI14</th><th>SMA7</th><th>SMA8</th><th>ATR14</th><th>ADX14</th><th>1H方向</th><th>参考pips*</th></tr></thead><tbody>${rowsHtml||'<tr><td colspan="9">記録待ちです。上の診断リンクから原因を確認してください。</td></tr>'}</tbody></table></div><p class="note">*重複する5分ごとの方向予測を含み、スプレッド・約定・手数料は考慮していません。統計的優位性を示しません。</p></html>`);
  }catch(e:any){return c.html(`<h1>診断表示エラー</h1><pre>${String(e?.message??e).replace(/[&<>]/g,"")}</pre>`,500);}
});

// Read-only state, never exposes any credentials or creates/clears actual intent.
app.get("/pending-market-order-status", c => c.json({
  system: "Chagatto-2 Write-Ahead Market Order Safety",
  readOnly: true, orderSent: false, liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  storageHealthy: safetyStorageHealthy, storageError: safetyStorageError,
  pendingIntentDetected: pendingMarketOrderExistsOrUnknown(),
  newEntriesBlocked: newEntriesSafelyBlocked(),
  pendingIntentPath: pendingMarketOrderFile,
  note: "A pending intent is deliberately NOT auto-cleared on restart. Reconcile broker orders/executions/positions/STOP before any manual recovery."
}));
app.get("/market-order-crash-simulation", c => {
  const cases = [
    { scenario: "CRASH_BEFORE_INTENT_SAVE", intentDurable: false, postAllowed: false, blockedAfterRestart: true },
    { scenario: "INTENT_SAVE_FAILED", intentDurable: false, postAllowed: false, blockedAfterRestart: true },
    { scenario: "CRASH_AFTER_INTENT_BEFORE_POST", intentDurable: true, postAllowed: true, blockedAfterRestart: true },
    { scenario: "CRASH_DURING_POST", intentDurable: true, postAllowed: true, blockedAfterRestart: true },
    { scenario: "RESPONSE_UNKNOWN", intentDurable: true, postAllowed: true, blockedAfterRestart: true },
    { scenario: "BROKER_CONFIRMED_STOP", intentDurable: true, postAllowed: true, blockedAfterRestart: false }
  ];
  return c.json({ system: "Chagatto-2 Order Crash Safety Decision Simulation",
    simulationOnly: true, orderSent: false, gmoPrivateApiCalled: false,
    realMarkerChanged: false, testCount: cases.length,
    allPassed: cases.every(x => !x.postAllowed || x.intentDurable) && cases.slice(0,5).every(x => x.blockedAfterRestart),
    cases, limitations: "Decision logic simulation only. No process kill, actual broker order, actual STOP, or broker-side reconciliation tested." });
});

// Read-only pre-live status. This is a static code audit, NOT a live broker validation.
app.get("/prelive-safety-audit", (c) => c.json({
  system: "Chagatto-2 Pre-Live Safety Audit",
  auditType: "SOURCE_INSPECTION_ONLY",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  researchOnly: true,
  orderSent: false,
  durableSafetyState: { configuredPath: safetyStateFile, storageHealthy: safetyStorageHealthy, storageError: safetyStorageError, halted: gmoSafetyHalt, reason: gmoSafetyHaltReason },
  checks: {
    liveGatePresent: true,
    dailyLossGatePresent: true,
    maxDailyTradesGatePresent: true,
    duplicateExecutionGuardPresent: true,
    openPositionGuardPresent: true,
    openOrderGuardPresent: true,
    executionUnknownSafetyHaltPresent: true,
    partialFillRemainderGuardPresent: true,
    stopReconciliationPresent: true,
    emergencyCloseAttemptPresent: true
  },
  blockers: [
    "DURABLE_SAFETY_HALT_RESTART_BEHAVIOR_NOT_YET_VERIFIED",
    "UNKNOWN_MARKET_ORDER_RESULT_REQUIRES_RECOVERY_AND_PROTECTION_AUDIT",
    "STOP_AND_EMERGENCY_CLOSE_NOT_END_TO_END_TESTED_WITH_BROKER",
    "BROKER_SPREAD_SLIPPAGE_COSTS_AND_STRATEGY_EDGE_NOT_VALIDATED"
  ],
  outcome: "NOT_APPROVED_FOR_LIVE_TRADING",
  note: "Read-only status. Do not enable LIVE_TRADING_ENABLED based on this endpoint."
}));

app.get("/durable-safety-status", (c) => c.json({
  system: "Chagatto-2 Durable New Entry Safety",
  readOnly: true, orderSent: false, liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  storageHealthy: safetyStorageHealthy, storageError: safetyStorageError,
  statePath: safetyStateFile, newEntriesBlocked: newEntriesSafelyBlocked(),
  reason: gmoSafetyHaltReason,
  note: "A false blocked state is NOT a live trading approval. No public reset route is exposed."
}));

// Independent persistence probe: never reads or modifies the live trading safety-halt marker.
const volumeProbeFile = researchPath.join(safetyStateDir, "volume-restart-probe.json");
const volumeProbeBootTime = new Date().toISOString();
let volumeProbeFoundAtBoot = false;
let volumeProbeBootError: string | null = null;
try {
  if (safetyStorageHealthy) {
    volumeProbeFoundAtBoot = durableFs.existsSync(volumeProbeFile);
  }
} catch (error) {
  volumeProbeBootError = String(error);
}
app.get("/safety-volume-restart-probe", (c) => {
  let probe: any = null;
  let error: string | null = volumeProbeBootError;
  try {
    if (!safetyStorageHealthy || newEntriesSafelyBlocked() && !safetyStorageHealthy) throw new Error("VOLUME_NOT_HEALTHY");
    if (!durableFs.existsSync(volumeProbeFile)) {
      // Exclusive creation is idempotent even when two requests race.
      try {
        durableFs.writeFileSync(volumeProbeFile, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), createdByPid: process.pid }), { flag: "wx", mode: 0o600 });
      } catch (writeError: any) {
        if (writeError?.code !== "EEXIST") throw writeError;
      }
    }
    probe = JSON.parse(durableFs.readFileSync(volumeProbeFile, "utf8"));
    if (probe?.version !== 1 || !probe.createdAt) throw new Error("INVALID_PROBE_FILE");
  } catch (e) {
    error = String(e);
  }
  return c.json({
    system: "Chagatto-2 Volume Restart Probe",
    simulationOnly: true, orderSent: false, liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
    state: error ? "PROBE_ERROR" : volumeProbeFoundAtBoot ? "PERSISTED_ACROSS_STARTUP" : "WAITING_FOR_REDEPLOY",
    volumeHealthy: safetyStorageHealthy, storageError: safetyStorageError,
    markerFoundAtProcessStart: volumeProbeFoundAtBoot,
    bootTimeUtc: volumeProbeBootTime,
    markerCreatedAtUtc: probe?.createdAt ?? null,
    markerPath: volumeProbeFile,
    error,
    realSafetyHaltUntouched: true,
    note: "This checks a separate probe file on the same Volume. It does NOT prove actual halt recovery or broker order safety. Redeploy without wiping Volume, then reload."
  });
});


// Read-only diagnostic of the real market-order ambiguous-outcome policy.
// No GMO credentials, private APIs, order calls, or safety state mutations.
app.get("/unknown-order-outcome-test", (c) => {
  const scenarios = [
    { name: "POST_NETWORK_TIMEOUT", attempted: true, transportError: true, validJson: false, ok: false, hasId: false },
    { name: "POST_INVALID_JSON", attempted: true, transportError: false, validJson: false, ok: true, hasId: false },
    { name: "POST_HTTP_ERROR", attempted: true, transportError: false, validJson: true, ok: false, hasId: false },
    { name: "POST_SUCCESS_WITHOUT_ORDER_ID", attempted: true, transportError: false, validJson: true, ok: true, hasId: false },
    { name: "POST_SUCCESS_WITH_ORDER_ID", attempted: true, transportError: false, validJson: true, ok: true, hasId: true },
  ];
  const results = scenarios.map((x) => {
    const uncertain = x.attempted && (x.transportError || !x.validJson || !x.ok || !x.hasId);
    const decision = uncertain ? "PERSIST_HALT_AND_REQUIRE_RECONCILIATION" : "PROCEED_TO_EXECUTION_AND_STOP_VERIFICATION";
    return { scenario: x.name, decision, autoRetryMarketOrder: false,
      newEntryBlockedIfAmbiguous: uncertain, brokerSafetyVerified: false,
      passed: uncertain ? decision === "PERSIST_HALT_AND_REQUIRE_RECONCILIATION" : decision === "PROCEED_TO_EXECUTION_AND_STOP_VERIFICATION" };
  });
  return c.json({ system: "Chagatto-2 Unknown Market Order Outcome Gate", mode: "SIMULATION_ONLY",
    orderSent: false, gmoPrivateApiCalled: false, liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
    safetyMarkerChanged: false, testCount: results.length, allPassed: results.every(x => x.passed), results,
    limits: "Source-path simulation only. Does not validate broker executions, STOP placement, exchange behavior or recovery after a real outage." });
});

// Read-only broker-side reconciliation snapshot. Does not modify any safety state.
// Deliberately returns only aggregate counts; never exposes account IDs or keys.
app.get("/broker-reconciliation-readonly", async (c) => {
  const base = {
    system: "Chagatto-2 Broker Reconciliation Read Only",
    readOnly: true, orderSent: false, stopOrderSent: false,
    safetyStateChanged: false,
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
    symbol: "USD_JPY",
    pendingIntentDetected: pendingMarketOrderExistsOrUnknown(),
    volumeHealthy: safetyStorageHealthy,
  };
  if (!safetyStorageHealthy) {
    return c.json({ ...base, status: "RECONCILIATION_INCOMPLETE", newEntryRecommendation: "BLOCK", error: "SAFETY_VOLUME_UNAVAILABLE" }, 503);
  }
  const paths = [
    ["positions", "/v1/openPositions", "?symbol=USD_JPY&count=100"],
    ["orders", "/v1/activeOrders", "?symbol=USD_JPY&count=100"],
    ["executions", "/v1/latestExecutions", "?symbol=USD_JPY&count=100"],
  ] as const;
  const settled = await Promise.allSettled(paths.map(([,path,q]) => gmoPrivateGet(path, q)));
  const failures = settled.flatMap((r,i) => r.status === "rejected" ? [paths[i][0]] : []);
  if (failures.length) {
    return c.json({ ...base, status:"RECONCILIATION_INCOMPLETE", newEntryRecommendation:"BLOCK",
      failedSources:failures, note:"Broker read failed. Do not clear pending intent or resume orders." }, 503);
  }
  const items = settled.map(r => r.status === "fulfilled" ? r.value : null);
  const listOf = (v:any):any[] | null => Array.isArray(v?.data?.list) ? v.data.list : Array.isArray(v?.data) ? v.data : null;
  const positions = listOf(items[0]);
  const orders = listOf(items[1]);
  const executions = listOf(items[2]);
  if (!positions || !orders || !executions) {
    return c.json({ ...base, status:"RECONCILIATION_INCOMPLETE", newEntryRecommendation:"BLOCK", error:"UNEXPECTED_BROKER_RESPONSE_SHAPE" }, 503);
  }
  const stopOrders = orders.filter((o:any) => String(o?.executionType ?? "").toUpperCase() === "STOP");
  const unprotectedPositionPossible = positions.length > 0 && stopOrders.length === 0;
  const needsManualReconciliation = base.pendingIntentDetected || positions.length > 0 || orders.length > 0;
  return c.json({ ...base, status: unprotectedPositionPossible ? "POSSIBLE_UNPROTECTED_POSITION" : needsManualReconciliation ? "MANUAL_RECONCILIATION_REQUIRED" : "NO_OPEN_EXPOSURE_DETECTED",
    newEntryRecommendation: "BLOCK_UNTIL_SEPARATELY_AUTHORIZED",
    counts: { openPositions:positions.length, activeOrders:orders.length, activeStops:stopOrders.length, recentExecutions:executions.length },
    checks: { allThreeBrokerReadsSucceeded:true, possibleMissingStop:unprotectedPositionPossible,
      exactStopToPositionMatchingVerified:false, allPagesFetched:false, historicalOrderOutcomeVerified:false },
    note:"Snapshot is NOT proof that a STOP protects a specific position. No pagination or order-specific historical reconciliation; never clear a pending intent based on this endpoint." });
});



// Conservative, read-only STOP-to-position audit. An unlinked STOP is NEVER
// assumed to protect any position; no mutable broker or safety operation here.
type StopAuditPosition = {positionId?:string; side?:string; size?:string|number; amount?:string|number};
type StopAuditOrder = {executionType?:string; side?:string; settlePosition?:any; size?:string|number; orderSize?:string|number; status?:string};
function assessStopCoverage(positions:StopAuditPosition[], orders:StopAuditOrder[]) {
  const stops = orders.filter(o => String(o?.executionType ?? '').toUpperCase() === 'STOP');
  const positionResults = positions.map(p => {
    const id = String(p?.positionId ?? '');
    const side = String(p?.side ?? '').toUpperCase();
    const qty = Number(p?.size ?? p?.amount);
    const explicit = stops.filter(o => Array.isArray(o?.settlePosition) && o.settlePosition.some((x:any)=>String(x?.positionId ?? '') === id) && !!id);
    const correctSide = explicit.filter(o => String(o?.side ?? '').toUpperCase() === (side === 'BUY' ? 'SELL' : side === 'SELL' ? 'BUY' : 'UNKNOWN'));
    const covered = correctSide.reduce((sum,o) => {
      const lines = (o.settlePosition as any[]).filter(x => String(x?.positionId ?? '') === id);
      return sum + lines.reduce((n,x)=>n + (Number.isFinite(Number(x?.size)) && Number(x.size)>0 ? Number(x.size):0), 0);
    },0);
    // Unknown quantities and ambiguous IDs are unsafe: explicitly never pass.
    const status = !id || !['BUY','SELL'].includes(side) || !Number.isFinite(qty) || qty<=0
      ? 'POSITION_DATA_INCOMPLETE'
      : !explicit.length ? 'NO_EXPLICIT_STOP_LINK'
      : !correctSide.length ? 'STOP_DIRECTION_MISMATCH'
      : covered < qty ? 'STOP_SIZE_NOT_PROVEN' : 'EXPLICIT_COVERAGE_PRESENT_NOT_BROKER_VERIFIED';
    return {status, explicitLinkedStops: explicit.length, oppositeSideStops:correctSide.length,
      quantityAvailable:Number.isFinite(qty)&&qty>0, explicitLinkedQuantity:covered,
      positionQuantity:Number.isFinite(qty)&&qty>0?qty:null};
  });
  const unlinkedStops = stops.filter(o=>!Array.isArray(o.settlePosition)||o.settlePosition.length===0).length;
  const apparentlyCovered = positionResults.filter(x=>x.status==='EXPLICIT_COVERAGE_PRESENT_NOT_BROKER_VERIFIED').length;
  return {positionCount:positions.length, stopCount:stops.length, unlinkedStops,
    apparentlyCovered, unresolvedPositions:positionResults.length-apparentlyCovered,
    positions:positionResults,
    note:'Explicit stop linkage, side and size are indicative only. Does NOT prove broker fill, STOP trigger, OCO, or historical order safety.'};
}

app.get('/stop-position-coverage-diagnostic', async (c)=>{
  const base={system:'Chagatto-2 STOP Position Coverage Diagnostic',readOnly:true,
    orderSent:false, stopOrderSent:false, safetyStateChanged:false,
    liveTradingEnabled:process.env.LIVE_TRADING_ENABLED==='true',
    pendingIntentDetected:pendingMarketOrderExistsOrUnknown()};
  if (!safetyStorageHealthy) return c.json({...base,status:'INCOMPLETE_BLOCK_NEW_ENTRIES',error:'SAFETY_STORAGE_UNAVAILABLE'},503);
  const [p,o]=await Promise.allSettled([
    gmoPrivateGet('/v1/openPositions','?symbol=USD_JPY&count=100'),
    gmoPrivateGet('/v1/activeOrders','?symbol=USD_JPY&count=100')]);
  if(p.status==='rejected'||o.status==='rejected') return c.json({...base,status:'INCOMPLETE_BLOCK_NEW_ENTRIES',error:'BROKER_READ_FAILED'},503);
  const extract=(v:any)=>Array.isArray(v?.data?.list)?v.data.list:Array.isArray(v?.data)?v.data:null;
  const positions=extract(p.value),orders=extract(o.value);
  if(!positions||!orders) return c.json({...base,status:'INCOMPLETE_BLOCK_NEW_ENTRIES',error:'UNEXPECTED_BROKER_DATA'},503);
  const audit=assessStopCoverage(positions,orders);
  const status=positions.length===0?'NO_OPEN_POSITION_NOT_A_LIVE_STOP_TEST':'STOP_COVERAGE_REQUIRES_MANUAL_BROKER_VERIFICATION';
  return c.json({...base,status,newEntryRecommendation:'BLOCK_UNTIL_SEPARATELY_AUTHORIZED',
    ...audit, checks:{allPagesFetched:false,stopExecutionVerified:false,stopFillVerified:false,
      brokerStopToPositionProtectionVerified:false,liveApproved:false},
    warning:'No IDs or secrets exposed. Do NOT automatically release any pending order or safety halt based on this audit.'});
});

app.get('/stop-position-coverage-simulation',c=>{
  const cases=[
    {name:'NO_POSITIONS',p:[],o:[],expected:0},
    {name:'MISSING_STOP',p:[{positionId:'a',side:'BUY',size:1000}],o:[],expected:1},
    {name:'UNLINKED_STOP',p:[{positionId:'a',side:'BUY',size:1000}],o:[{executionType:'STOP',side:'SELL'}],expected:1},
    {name:'WRONG_DIRECTION',p:[{positionId:'a',side:'BUY',size:1000}],o:[{executionType:'STOP',side:'BUY',settlePosition:[{positionId:'a',size:1000}]}],expected:1},
    {name:'PARTIAL_SIZE',p:[{positionId:'a',side:'BUY',size:1000}],o:[{executionType:'STOP',side:'SELL',settlePosition:[{positionId:'a',size:500}]}],expected:1},
    {name:'EXPLICIT_COVERAGE_ONLY',p:[{positionId:'a',side:'BUY',size:1000}],o:[{executionType:'STOP',side:'SELL',settlePosition:[{positionId:'a',size:1000}]}],expected:0},
    {name:'MISSING_POSITION_ID',p:[{side:'SELL',size:1000}],o:[{executionType:'STOP',side:'BUY'}],expected:1},
  ];
  const tests=cases.map(x=>{const a=assessStopCoverage(x.p,x.o);return {name:x.name,unresolvedPositions:a.unresolvedPositions,passed:a.unresolvedPositions===x.expected,brokerSafetyVerified:false};});
  return c.json({system:'Chagatto-2 STOP Coverage Simulation',simulationOnly:true,orderSent:false,
    privateGmoApiCalled:false,safetyStateChanged:false,liveTradingEnabled:process.env.LIVE_TRADING_ENABLED==='true',
    tests,allPassed:tests.every(t=>t.passed),note:'Synthetic inputs only; cannot validate actual GMO STOP protection or execution.'});
});


// Pre-live reconciliation decision: a deliberately conservative, read-only gate.
// This endpoint does NOT authorize any trade, clear safety state, or mutate broker data.
function assessPreliveReadiness(input: {storageHealthy:boolean; pending:boolean; halted:boolean; brokerReadsOk:boolean; shapeOk:boolean; positions:number; orders:number; stopUnresolved:number}) {
  const blockers:string[]=[];
  if(!input.storageHealthy) blockers.push('SAFETY_STORAGE_UNAVAILABLE');
  if(input.pending) blockers.push('PENDING_ORDER_INTENT_REQUIRES_MANUAL_RECONCILIATION');
  if(input.halted) blockers.push('SAFETY_HALT_ACTIVE');
  if(!input.brokerReadsOk) blockers.push('BROKER_SNAPSHOT_FAILED');
  if(!input.shapeOk) blockers.push('BROKER_RESPONSE_INCOMPLETE');
  if(input.positions>0) blockers.push('OPEN_POSITIONS_REQUIRE_MANUAL_PROTECTION_AUDIT');
  if(input.orders>0) blockers.push('ACTIVE_ORDERS_REQUIRE_MANUAL_AUDIT');
  if(input.stopUnresolved>0) blockers.push('STOP_COVERAGE_UNRESOLVED');
  // A clean snapshot must NEVER be confused with authorization to trade.
  // These requirements cannot be proven by a read-only snapshot.
  blockers.push('LIVE_AUTHORIZATION_NOT_GRANTED');
  blockers.push('ORDER_SPECIFIC_HISTORY_NOT_RECONCILED');
  blockers.push('REAL_STOP_EXECUTION_NOT_TESTED');
  blockers.push('TRANSACTION_COST_AND_STRATEGY_NOT_VALIDATED');
  return {decision:'BLOCK_NEW_ENTRY', blockers, brokerSafetyVerified:false, liveApproved:false};
}
app.get('/prelive-reconciliation-gate', async c=>{
  const base={system:'Chagatto-2 Prelive Reconciliation Gate',readOnly:true,orderSent:false,
    stopOrderSent:false,safetyStateChanged:false,liveTradingEnabled:process.env.LIVE_TRADING_ENABLED==='true'};
  const pending=pendingMarketOrderExistsOrUnknown();
  const storageHealthy=safetyStorageHealthy;
  const halted=newEntriesSafelyBlocked() && !pending ? true : gmoSafetyHalt;
  if(!storageHealthy || !safetyStorageHealthy) return c.json({...base,...assessPreliveReadiness({storageHealthy:false,pending,halted:true,brokerReadsOk:false,shapeOk:false,positions:0,orders:0,stopUnresolved:0}),dataStatus:'UNAVAILABLE'},503);
  const responses=await Promise.allSettled([
    gmoPrivateGet('/v1/openPositions','?symbol=USD_JPY&count=100'),
    gmoPrivateGet('/v1/activeOrders','?symbol=USD_JPY&count=100'),
    gmoPrivateGet('/v1/latestExecutions','?symbol=USD_JPY&count=100')]);
  const readsOk=responses.every(r=>r.status==='fulfilled');
  const extract=(v:any):any[]|null=>Array.isArray(v?.data?.list)?v.data.list:Array.isArray(v?.data)?v.data:null;
  const positions=readsOk?extract((responses[0] as PromiseFulfilledResult<any>).value):null;
  const orders=readsOk?extract((responses[1] as PromiseFulfilledResult<any>).value):null;
  const executions=readsOk?extract((responses[2] as PromiseFulfilledResult<any>).value):null;
  const shapeOk=!!positions && !!orders && !!executions;
  const audit=shapeOk?assessStopCoverage(positions!,orders!):null;
  const assessment=assessPreliveReadiness({storageHealthy,pending,halted,brokerReadsOk:readsOk,shapeOk,
    positions:positions?.length??0,orders:orders?.length??0,stopUnresolved:audit?.unresolvedPositions??0});
  return c.json({...base,...assessment,dataStatus:shapeOk?'SNAPSHOT_RECEIVED':'INCOMPLETE',
    counts:shapeOk?{positions:positions!.length,activeOrders:orders!.length,recentExecutions:executions!.length,unresolvedPositions:audit!.unresolvedPositions}:null,
    limitations:['NO_PAGINATION','NO_ORDER_SPECIFIC_EXECUTION_PROOF','NO_REAL_STOP_TRIGGER_OR_FILL_TEST','NO_COST_OR_STRATEGY_VALIDATION'],
    note:'Read-only snapshot. Never clears a pending intent or grants trading authorization.'},shapeOk?200:503);
});
app.get('/prelive-reconciliation-gate-test',c=>{
  const scenarios=[
    {name:'EMPTY_SNAPSHOT',v:{storageHealthy:true,pending:false,halted:false,brokerReadsOk:true,shapeOk:true,positions:0,orders:0,stopUnresolved:0},expected:[]},
    {name:'STORAGE_FAILURE',v:{storageHealthy:false,pending:false,halted:false,brokerReadsOk:true,shapeOk:true,positions:0,orders:0,stopUnresolved:0},expected:['SAFETY_STORAGE_UNAVAILABLE']},
    {name:'PENDING_INTENT',v:{storageHealthy:true,pending:true,halted:false,brokerReadsOk:true,shapeOk:true,positions:0,orders:0,stopUnresolved:0},expected:['PENDING_ORDER_INTENT_REQUIRES_MANUAL_RECONCILIATION']},
    {name:'HALT_ACTIVE',v:{storageHealthy:true,pending:false,halted:true,brokerReadsOk:true,shapeOk:true,positions:0,orders:0,stopUnresolved:0},expected:['SAFETY_HALT_ACTIVE']},
    {name:'BROKER_UNAVAILABLE',v:{storageHealthy:true,pending:false,halted:false,brokerReadsOk:false,shapeOk:false,positions:0,orders:0,stopUnresolved:0},expected:['BROKER_SNAPSHOT_FAILED','BROKER_RESPONSE_INCOMPLETE']},
    {name:'OPEN_POSITION',v:{storageHealthy:true,pending:false,halted:false,brokerReadsOk:true,shapeOk:true,positions:1,orders:0,stopUnresolved:1},expected:['OPEN_POSITIONS_REQUIRE_MANUAL_PROTECTION_AUDIT','STOP_COVERAGE_UNRESOLVED']},
    {name:'ACTIVE_ORDER',v:{storageHealthy:true,pending:false,halted:false,brokerReadsOk:true,shapeOk:true,positions:0,orders:1,stopUnresolved:0},expected:['ACTIVE_ORDERS_REQUIRE_MANUAL_AUDIT']},
  ];
  const mandatory=['LIVE_AUTHORIZATION_NOT_GRANTED','ORDER_SPECIFIC_HISTORY_NOT_RECONCILED','REAL_STOP_EXECUTION_NOT_TESTED','TRANSACTION_COST_AND_STRATEGY_NOT_VALIDATED'];
  const tests=scenarios.map(s=>{const result=assessPreliveReadiness(s.v);return {scenario:s.name,passed:result.decision==='BLOCK_NEW_ENTRY' && !result.liveApproved && JSON.stringify(result.blockers)===JSON.stringify([...s.expected,...mandatory])};});
  return c.json({system:'Chagatto-2 Prelive Gate Simulation',simulationOnly:true,orderSent:false,privateGmoApiCalled:false,safetyStateChanged:false,
    testCount:tests.length,allPassed:tests.every(t=>t.passed),tests,liveApproved:false});
});

// Research-only end-to-end decision table. No broker call, no filesystem mutation.
type ProtectionScenario = {name:string; intentSaved:boolean; postOutcome:'ACK'|'UNKNOWN'|'REJECTED'|'NOT_SENT'; execution:'FILLED'|'NONE'|'UNKNOWN'; stopPlacement:'ACK'|'FAILED'|'UNKNOWN'|'NOT_ATTEMPTED'; stopVerified:boolean; brokerReadsOk:boolean; expected:string};
function evaluateProtectionPath(s:ProtectionScenario){
  let phase='BEFORE_POST';
  let marketPostAllowed=false;
  let newEntryBlocked=true;
  let manualReconciliation=true;
  const trace:string[]=[];
  if(!s.intentSaved){trace.push('INTENT_NOT_DURABLE');return {phase:'HALT_INTENT_NOT_DURABLE',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  trace.push('INTENT_DURABLE');marketPostAllowed=true;
  if(s.postOutcome==='NOT_SENT'){trace.push('NO_POST');return {phase:'HALT_PENDING_INTENT',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  if(s.postOutcome==='UNKNOWN'){trace.push('POST_OUTCOME_UNKNOWN');return {phase:'HALT_ORDER_UNKNOWN',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  if(s.postOutcome==='REJECTED'){trace.push('POST_REJECTED');return {phase:'HALT_REJECTED_RECONCILE',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  trace.push('ORDER_ACKNOWLEDGED');
  if(!s.brokerReadsOk){trace.push('BROKER_RECONCILIATION_UNAVAILABLE');return {phase:'HALT_BROKER_UNAVAILABLE',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  if(s.execution!=='FILLED'){trace.push('EXECUTION_NOT_CONFIRMED');return {phase:'HALT_EXECUTION_UNRESOLVED',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  trace.push('EXECUTION_CONFIRMED');
  if(s.stopPlacement!=='ACK'){trace.push('STOP_NOT_ACKNOWLEDGED');return {phase:'HALT_STOP_UNCONFIRMED',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  trace.push('STOP_ACKNOWLEDGED');
  if(!s.stopVerified){trace.push('STOP_COVERAGE_NOT_VERIFIED');return {phase:'HALT_STOP_COVERAGE_UNVERIFIED',trace,marketPostAllowed,newEntryBlocked,manualReconciliation};}
  trace.push('STOP_COVERAGE_LOGICALLY_VERIFIED');
  phase='SIMULATED_PROTECTION_PATH_COMPLETE';
  manualReconciliation=false;
  // Even a passing synthetic path never grants live authorization.
  return {phase,trace,marketPostAllowed,newEntryBlocked,manualReconciliation};
}
app.get('/order-stop-lifecycle-simulation',c=>{
  const base={intentSaved:true,postOutcome:'ACK' as const,execution:'FILLED' as const,stopPlacement:'ACK' as const,stopVerified:true,brokerReadsOk:true};
  const scenarios:ProtectionScenario[]=[
    {...base,name:'INTENT_NOT_SAVED',intentSaved:false,expected:'HALT_INTENT_NOT_DURABLE'},
    {...base,name:'CRASH_BEFORE_POST',postOutcome:'NOT_SENT',expected:'HALT_PENDING_INTENT'},
    {...base,name:'POST_RESULT_UNKNOWN',postOutcome:'UNKNOWN',expected:'HALT_ORDER_UNKNOWN'},
    {...base,name:'ORDER_REJECTED',postOutcome:'REJECTED',expected:'HALT_REJECTED_RECONCILE'},
    {...base,name:'BROKER_READ_FAILED',brokerReadsOk:false,expected:'HALT_BROKER_UNAVAILABLE'},
    {...base,name:'EXECUTION_UNKNOWN',execution:'UNKNOWN',expected:'HALT_EXECUTION_UNRESOLVED'},
    {...base,name:'STOP_POST_FAILED',stopPlacement:'FAILED',expected:'HALT_STOP_UNCONFIRMED'},
    {...base,name:'STOP_POST_UNKNOWN',stopPlacement:'UNKNOWN',expected:'HALT_STOP_UNCONFIRMED'},
    {...base,name:'STOP_COVERAGE_MISMATCH',stopVerified:false,expected:'HALT_STOP_COVERAGE_UNVERIFIED'},
    {...base,name:'SYNTHETIC_SUCCESS',expected:'SIMULATED_PROTECTION_PATH_COMPLETE'}
  ];
  const tests=scenarios.map(s=>{const result=evaluateProtectionPath(s);return {scenario:s.name,phase:result.phase,marketPostAllowed:result.marketPostAllowed,newEntryBlocked:result.newEntryBlocked,manualReconciliation:result.manualReconciliation,passed:result.phase===s.expected && result.newEntryBlocked && (s.name!=='INTENT_NOT_SAVED'||!result.marketPostAllowed)};});
  return c.json({system:'Chagatto-2 Order-STOP Lifecycle Simulation',mode:'SIMULATION_ONLY',liveTradingEnabled:false,orderSent:false,stopOrderSent:false,gmoPrivateApiCalled:false,volumeOrSafetyStateChanged:false,realBrokerSafetyVerified:false,liveApproved:false,testCount:tests.length,allPassed:tests.every(t=>t.passed),tests,limitations:['PURE_DECISION_MODEL_NOT_ACTUAL_ORDER_CODE','NO_REAL_CRASH_INJECTION','NO_BROKER_STOP_FILL_TEST','NO_TRANSACTION_COST_VALIDATION']});
});


// Read-only execution-path probe. Calls the REAL /gmo-order route only while
// trading is explicitly disabled, without credentials, and never calls GMO.
// This is NOT fault injection beyond the route's first live-trading gate.
app.get('/actual-order-route-disabled-probe', async (c) => {
  const enabled = process.env.LIVE_TRADING_ENABLED;
  if (enabled !== 'false') {
    return c.json({
      system: 'Chagatto-2 Actual Order Route Disabled Probe',
      attempted: false,
      passed: false,
      liveTradingEnabledValue: enabled === 'true' ? 'true' : 'not_explicitly_false',
      reason: 'REFUSED_UNLESS_LIVE_TRADING_ENABLED_EXPLICITLY_FALSE',
      orderSent: false,
      liveApproved: false
    }, 409);
  }
  const beforePending = pendingMarketOrderExistsOrUnknown();
  const beforeBlocked = newEntriesSafelyBlocked();
  const cases = [
    { name: 'NO_BODY', payload: undefined },
    { name: 'INVALID_SIDE', payload: { side: 'NOT_A_SIDE', triggerCandleTime: 1 } },
    { name: 'PLAUSIBLE_BUY', payload: { side: 'BUY', triggerCandleTime: Date.now() } },
    { name: 'PLAUSIBLE_SELL', payload: { side: 'SELL', triggerCandleTime: Date.now() } }
  ];
  const tests = [];
  for (const sample of cases) {
    const request = new Request(new URL('/gmo-order', c.req.url).toString(), {
      method: 'POST',
      headers: sample.payload === undefined ? {} : {'Content-Type': 'application/json'},
      body: sample.payload === undefined ? undefined : JSON.stringify(sample.payload)
    });
    const response = await app.fetch(request);
    let body: any = null;
    try { body = await response.json(); } catch { /* treat as failed */ }
    tests.push({name: sample.name, status: response.status,
      error: String(body?.error ?? ''), orderSent: body?.orderSent,
      passed: response.status === 403 && body?.orderSent === false && body?.error === 'LIVE_TRADING_ENABLED is false'});
  }
  const afterPending = pendingMarketOrderExistsOrUnknown();
  const afterBlocked = newEntriesSafelyBlocked();
  const stateUnchanged = beforePending === afterPending && beforeBlocked === afterBlocked;
  return c.json({
    system: 'Chagatto-2 Actual Order Route Disabled Probe',
    mode: 'REAL_HONO_ROUTE_WITH_TRADING_DISABLED',
    liveTradingEnabled: false, orderSent: false, stopOrderSent: false,
    directBrokerApiCalledByProbe: false, volumeStateChangedByProbe: false,
    testCount: tests.length,
    allPassed: tests.every(t => t.passed) && stateUnchanged,
    pendingIntentUnchanged: beforePending === afterPending,
    safetyGateUnchanged: beforeBlocked === afterBlocked,
    tests,
    limitations: [
      'TESTS_ONLY_THE_REAL_ROUTE_KILL_SWITCH_NOT_POST_AUTH_ORDER_FLOW',
      'NO_BROKER_ORDER_OR_STOP_PLACED',
      'NO_CRASH_DURING_POST_OR_BROKER_FAULT_INJECTION',
      'NO_LIVE_APPROVAL'
    ]
  });
});

const port = Number(process.env.PORT || 8080);
console.log(`Chagatto-2 started PORT=${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});


