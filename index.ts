import { Hono } from "hono";
import { serve } from "@hono/node-server";

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
    }))
    .filter((item: any) => Number.isFinite(item.close));

  let trades = 0;
  let wins = 0;
  let losses = 0;
  let totalPips = 0;
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

    if (sma5 > sma10 && rsi14 < 70) {
      signal = "BUY";
    } else if (sma5 < sma10 && rsi14 > 30) {
      signal = "SELL";
    }

    if (signal === "WAIT") continue;

    const entry = candles[i].close;
    const exit = candles[i + 1].close;

    const pips =
      signal === "BUY"
        ? (exit - entry) * 100
        : (entry - exit) * 100;

    trades++;

    if (pips > 0) {
      wins++;
    } else if (pips < 0) {
      losses++;
    }

    totalPips += pips;
  }
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;

  return c.json({
    system: "Chagatto-2 Backtest",
    pair: "USDJPY",
    interval: "1h",
    trades,
    wins,
    losses,
    winRate,
    totalPips
  });
});

const port = Number(process.env.PORT || 8080);

console.log(`Chagatto-2 started PORT=${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
