import { runDailyInboxMail } from "./jobs/dailyInboxMail";

export default {
  // =====================
  // Cron（本番）
  // =====================
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyInboxMail(env));
  },

  // =====================
  // HTTP（手動テスト）
  // =====================
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/test/cron") {
      const result = await runDailyInboxMail(env);
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  }
};
