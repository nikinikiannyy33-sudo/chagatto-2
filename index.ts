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

app.get("/fx-test", (c) => {
  const prices = [
    147.10, 147.18, 147.25, 147.22, 147.30,
    147.35, 147.42, 147.38, 147.46, 147.52,
    147.58, 147.61, 147.66, 147.72, 147.69,
    147.76, 147.82, 147.88, 147.91, 147.96
  ];

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

const port = Number(process.env.PORT || 8080);

console.log(`Chagatto-2 started PORT=${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
