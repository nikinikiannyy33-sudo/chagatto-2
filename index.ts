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
  const accountBalance = 50000;
const riskRate = 0.02;
const maxRiskYen = accountBalance * riskRate;

const stopDistance =
  atr14 !== null ? atr14 * 1.5 : null;

let orderSize = 0;

if (stopDistance !== null && stopDistance > 0) {
  const rawSize = maxRiskYen / stopDistance;

  // 100通貨単位に切り下げ
  orderSize = Math.floor(rawSize / 100) * 100;

  // 最低100通貨
  if (orderSize < 100) {
    orderSize = 100;
  }
}

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
let gmoSafetyHaltAt: string | null = null;
function activateGmoSafetyHalt(reason: string) {
  gmoSafetyHalt = true;
  gmoSafetyHaltReason = reason;
  gmoSafetyHaltAt = new Date().toISOString();
}
app.get("/gmo-safety-status", (c) => c.json({
  safetyHalt: gmoSafetyHalt,
  reason: gmoSafetyHaltReason,
  haltedAt: gmoSafetyHaltAt,
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  orderInProgress: gmoOrderInProgress,
}));
app.post("/gmo-order", async (c) => {
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
    return c.json({ orderSent: false, error: "Unauthorized" }, 401);
  }
  if (gmoSafetyHalt) {
    return c.json({ orderSent: false, error: "SAFETY_HALT_ACTIVE", reason: gmoSafetyHaltReason, haltedAt: gmoSafetyHaltAt }, 503);
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
    // 安全装置3：すでに建玉がある場合は新規注文しない
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

// 1回の最大リスク＝取引余力の2%
const riskRate = 0.02;
const maxRiskYen = availableAmount * riskRate;

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
const stopDistance = Number(signalData.stopDistance);

if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
  return c.json({
    orderSent: false,
    error: "Invalid stopDistance",
  }, 500);
}

// 損失上限から注文数量を計算
const rawSize = maxRiskYen / stopDistance;

// GMO FX USD/JPY の取引ルール
const minOrderSize = 10000;
const brokerMaxOrderSize = 500000;
const sizeStep = 1;

// リスクから注文数量を計算
const calculatedOrderSize =
  Math.floor(rawSize / sizeStep) * sizeStep;

// チャガット2号独自の安全上限
const internalMaxOrderSize = 10000;

const orderSize = Math.min(
  calculatedOrderSize,
  internalMaxOrderSize,
  brokerMaxOrderSize
);

// 最小注文数量に届かなければ注文しない
if (orderSize < minOrderSize) {
  return c.json({
    orderSent: false,
    error: "ORDER_SIZE_BELOW_MINIMUM",
    calculatedOrderSize,
    minOrderSize,
    maxRiskYen,
    stopDistance,
  }, 409);
}

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
  activateGmoSafetyHalt("EXECUTION_STATE_UNKNOWN_AFTER_RECONCILIATION");
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
  // 約定なしと断定はしない。注文状態が不明なため本番運用では要監視。
  return c.json({
    orderSent: true,
    stopOrderSent: false,
    orderId,
    error: "EXECUTION_STATE_UNKNOWN_AFTER_RECONCILIATION",
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
  activateGmoSafetyHalt("INVALID_EXECUTED_SIZE");
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
    activateGmoSafetyHalt("PARTIAL_FILL_REMAINDER_CANCEL_FAILED");
    return c.json({
      orderSent: true,
      stopOrderSent: false,
      orderId,
      rootOrderId,
      error: "PARTIAL_FILL_REMAINDER_CANCEL_FAILED",
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
    activateGmoSafetyHalt("INVALID_EXECUTION_DATA");
    return c.json({
      orderSent: true,
      stopOrderSent: false,
      orderId,
      error: "INVALID_EXECUTION_DATA",
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
  activateGmoSafetyHalt("INVALID_SETTLE_POSITION_DATA");
  return c.json({
    orderSent: true,
    stopOrderSent: false,
    orderId,
    error: "INVALID_EXECUTION_DATA",
  }, 500);
}
// 約定価格を基準にSTOP価格を固定
const rawStopPrice =
  side === "BUY"
    ? entryPrice - stopDistance
    : entryPrice + stopDistance;

// USD/JPYは小数第3位までに丸める
const stopPrice = rawStopPrice.toFixed(3);

// 決済方向は新規注文と逆
const stopSide =
  side === "BUY" ? "SELL" : "BUY";

const stopTimestamp = Date.now().toString();
const stopMethod = "POST";
const stopPath = "/v1/closeOrder";
const stopClientOrderId =
  `CS${orderId}${Date.now()}`.slice(0, 36);

const stopBody = JSON.stringify({
  symbol: "USD_JPY",
  side: stopSide,
  clientOrderId: stopClientOrderId,
  executionType: "STOP",
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
          x.executionType === "STOP" &&
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

if (!stopConfirmed) {
  activateGmoSafetyHalt(`PROTECTION_NOT_CONFIRMED:${protectionState}`);
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
  const adminToken = process.env.ADMIN_TOKEN;
  const receivedToken = c.req.header("X-ADMIN-TOKEN");

  if (!adminToken || receivedToken !== adminToken) {
    return c.json({ autoRun: false, error: "Unauthorized" }, 401);
  }
  if (gmoSafetyHalt) {
    return c.json({ autoRun: false, action: "NO_ORDER", error: "SAFETY_HALT_ACTIVE", reason: gmoSafetyHaltReason, haltedAt: gmoSafetyHaltAt }, 503);
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
