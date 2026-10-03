/**
 * Standalone Cloudflare Worker entry point for Text Vault.
 *
 * All API routes are implemented in shared/apiHandler.js so that Pages Functions
 * and this Worker never diverge.
 *
 * To build a bundled standalone worker.js suitable for copy-pasting into the
 * Cloudflare Worker dashboard, run `npm run build:worker`.
 */

import { handleApiRequest } from "./shared/apiHandler.js";

export default {
  async fetch(request, env, ctx) {
    try {
      // 首先尝试处理 API 请求
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }

      // 如果不是 API 请求，则转发到 Cloudflare Pages（前端静态托管）
      const pagesUrl = (env && env.PAGES_URL) || "https://text-vault-app.pages.dev";
      const url = new URL(request.url);
      const targetUrl = pagesUrl + url.pathname + url.search;

      const isGetOrHead = request.method === "GET" || request.method === "HEAD";
      const pageResponse = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: isGetOrHead ? null : request.body,
      });

      // SPA 回退支持：当直接在浏览器访问 /share/:id 或 /vaultname 时，若静态托管返回 404，则回退到 index.html
      if (pageResponse.status === 404 && request.method === "GET") {
        const accept = request.headers.get("accept") || "";
        if (accept.includes("text/html") || !url.pathname.includes(".")) {
          return fetch(pagesUrl + "/index.html", {
            method: "GET",
            headers: request.headers,
          });
        }
      }

      return pageResponse;
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  },
};
