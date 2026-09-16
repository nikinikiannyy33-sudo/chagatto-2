import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    system: "チャガット2号",
    status: "正常稼働中",
    mode: "FX検証システム",
    message: "チャガット2号のサーバーは正常に起動しています",
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    system: "チャガット2号",
  });
});

app.get("/test", (c) => {
  return c.json({
    system: "チャガット2号",
    test: "success",
    message: "通信テスト成功",
    time: new Date().toISOString(),
  });
});

const port = Number(process.env.PORT || 8080);

console.log(`チャガット2号 起動 PORT=${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
