import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    system: "チャガット2号",
    status: "正常稼働中",
    mode: "FX検証システム",
    message: "チャガット2号のサーバーが正常に起動しています"
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok"
  });
});

const port = Number(process.env.PORT || 3000);

console.log(`チャガット2号 起動 PORT=${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0"
});
