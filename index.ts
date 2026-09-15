import { Hono } from "hono";

const app = new Hono();

type Side = "BUY" | "SELL" | "WAIT";

type Candle = {
  close: number;
};

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const v = values.slice(-period);
  return v.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);
  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
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

function decide(closes: number[]) {
  if (closes.length < 60) {
    return {
      side: "WAIT" as Side,
      score: 0,
      reason: "データ蓄積中",
    };
  }

  const fast = ema(closes, 9);
  const middle = ema(closes, 21);
  const slow = ema(closes, 50);
  const r = rsi(closes, 14);
  const shortSma = sma(closes, 10);

  if (
    fast === null ||
    middle === null ||
    slow === null ||
    r === null ||
    shortSma === null
  ) {
    return {
      side: "WAIT" as Side,
      score: 0,
      reason: "指標計算待ち",
    };
  }

  const price = closes[closes.length - 1];

  let buyScore = 0;
  let sellScore = 0;

  // トレンド
  if (fast > middle) buyScore += 2;
  if (fast < middle) sellScore += 2;

  if (middle > slow) buyScore += 2;
  if (middle < slow) sellScore += 2;

  // 現在価格
  if (price > shortSma) buyScore += 1;
  if (price < shortSma) sellScore += 1;

  // RSI
  if (r >= 52 && r <= 68) buyScore += 2;
  if (r <= 48 && r >= 32) sellScore += 2;

  // 過熱時は追いかけない
  if (r >= 72) buyScore -= 3;
  if (r <= 28) sellScore -= 3;

  let side: Side = "WAIT";
  let score = Math.max(buyScore, sellScore);

  // 条件が十分そろった時だけエントリー候補
  if (buyScore >= 6 && buyScore >= sellScore + 2) {
    side = "BUY";
  }

  if (sellScore >= 6 && sellScore >= buyScore + 2) {
    side = "SELL";
  }

  return {
    side,
    score,
    buyScore,
    sellScore,
    price,
    ema9: Number(fast.toFixed(3)),
    ema21: Number(middle.toFixed(3)),
    ema50: Number(slow.toFixed(3)),
    rsi: Number(r.toFixed(1)),
    reason:
      side === "WAIT"
        ? "条件不足のため見送り"
        : "複数条件一致",
  };
}

app.get("/", (c) => {
  return c.json({
    name: "チャガット2号",
    version: "2.0",
    status: "稼働中",
    mode: "検証モード",
    message: "勝率だけでなく累計損益を重視して検証します",
  });
});

app.post("/signal", async (c) => {
  try {
    const body = await c.req.json();

    const candles: Candle[] = body.candles ?? [];

    const closes = candles
      .map((x) => Number(x.close))
      .filter((x) => Number.isFinite(x));

    const result = decide(closes);

    return c.json({
      system: "チャガット2号",
      ...result,
    });
  } catch (error) {
    return c.json(
      {
        system: "チャガット2号",
        side: "WAIT",
        error:
          error instanceof Error
            ? error.message
            : "不明なエラー",
      },
      500
    );
  }
});

export default {
  port: Number(process.env.PORT || 3000),
  fetch: app.fetch,
};
