/**
 * Cloudflare Pages Functions: /api/* handler
 *
 * 当使用 Cloudflare Pages 部署时，此文件会自动拦截并处理所有 /api/* 路由，
 * 直接访问绑定的 KV Namespace (VAULTS)，无需单独维护和配置独立 Cloudflare Worker。
 *
 * 所有路由逻辑都在 shared/apiHandler.js 中（与 worker.js 共用同一份实现，避免两份代码分叉）。
 */

import { handleApiRequest } from "../../shared/apiHandler.js";

export async function onRequest(context) {
  const response = await handleApiRequest(context.request, context.env);
  return response || new Response(JSON.stringify({ error: "API route not found." }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
