/**
 * Cloudflare Worker for Text Vault
 * 
 * 这个文件将原本的 Express 服务器改造为 Cloudflare Worker 兼容版本
 * 
 * 部署说明：
 * 1. 创建 KV Namespace 并绑定为 "VAULTS"
 * 2. 将此文件内容复制到 Cloudflare Worker 编辑器
 * 3. 修改底部的 Pages URL 为您的实际 Pages URL
 * 4. 保存并部署
 * 
 * API 端点：
 * - GET  /api/vault/:name/salts   - 获取保险库的 salt 值
 * - GET  /api/vault/:name/check   - 检查保险库名称是否可用
 * - POST /api/vault/:name/create  - 创建新保险库
 * - POST /api/vault/:name/get     - 获取保险库内容（需要密码验证）
 * - POST /api/vault/:name/update  - 更新保险库内容
 * - POST /api/vault/:name/delete  - 删除保险库
 */

// Helper to create SHA-256 hash
async function sha256(data) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to get vault from KV storage
async function getVault(env, name) {
  const vaultData = await env.VAULTS.get(name);
  return vaultData ? JSON.parse(vaultData) : null;
}

// Helper to save vault to KV storage
async function saveVault(env, name, vault) {
  await env.VAULTS.put(name, JSON.stringify(vault));
}

// Helper to validate vault name
function isValidVaultName(name) {
  return /^[a-zA-Z0-9]{1,10}$/.test(name);
}

// Helper to create JSON response
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Router for API endpoints
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // API: Check if vault exists and return salts
  if (method === 'GET' && path.match(/^\/api\/vault\/([^\/]+)\/salts$/)) {
    const name = path.match(/^\/api\/vault\/([^\/]+)\/salts$/)[1].toLowerCase();
    
    if (!isValidVaultName(name)) {
      return jsonResponse(
        { error: 'Invalid vault name. Must be alphanumeric and max 10 characters.' },
        400
      );
    }

    const vault = await getVault(env, name);
    if (vault) {
      return jsonResponse({
        exists: true,
        salt_enc: vault.salt_enc,
        salt_auth: vault.salt_auth,
      });
    } else {
      return jsonResponse({ exists: false });
    }
  }

  // API: Check if vault name is available
  if (method === 'GET' && path.match(/^\/api\/vault\/([^\/]+)\/check$/)) {
    const name = path.match(/^\/api\/vault\/([^\/]+)\/check$/)[1].toLowerCase();
    
    if (!isValidVaultName(name)) {
      return jsonResponse(
        { error: 'Invalid vault name. Must be alphanumeric and max 10 characters.' },
        400
      );
    }

    const vault = await getVault(env, name);
    return jsonResponse({ exists: !!vault });
  }

  // API: Create new vault
  if (method === 'POST' && path.match(/^\/api\/vault\/([^\/]+)\/create$/)) {
    const name = path.match(/^\/api\/vault\/([^\/]+)\/create$/)[1].toLowerCase();
    
    if (!isValidVaultName(name)) {
      return jsonResponse(
        { error: 'Invalid vault name. Must be alphanumeric and max 10 characters.' },
        400
      );
    }

    const body = await request.json();
    const { salt_enc, salt_auth, auth_hash_double, encrypted_data } = body;

    if (!salt_enc || !salt_auth || !auth_hash_double || !encrypted_data) {
      return jsonResponse({ error: 'Missing required properties.' }, 400);
    }

    const existingVault = await getVault(env, name);
    if (existingVault) {
      return jsonResponse({ error: 'Vault already exists.' }, 400);
    }

    const vault = {
      name,
      salt_enc,
      salt_auth,
      auth_hash_double,
      encrypted_data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveVault(env, name, vault);
    return jsonResponse({ success: true });
  }

  // API: Get vault contents
  if (method === 'POST' && path.match(/^\/api\/vault\/([^\/]+)\/get$/)) {
    const name = path.match(/^\/api\/vault\/([^\/]+)\/get$/)[1].toLowerCase();
    
    const body = await request.json();
    const { auth_hash } = body;

    if (!auth_hash) {
      return jsonResponse(
        { error: 'Authentication verification hash is required to retrieve vault.' },
        400
      );
    }

    const vault = await getVault(env, name);
    if (!vault) {
      return jsonResponse({ error: 'Vault not found.' }, 404);
    }

    const proof = await sha256(auth_hash);
    if (proof !== vault.auth_hash_double) {
      return jsonResponse(
        { error: 'Password verification failed. Access denied.' },
        401
      );
    }

    return jsonResponse({
      success: true,
      encrypted_data: vault.encrypted_data,
      salt_enc: vault.salt_enc,
      salt_auth: vault.salt_auth,
    });
  }

  // API: Update vault
  if (method === 'POST' && path.match(/^\/api\/vault\/([^\/]+)\/update$/)) {
    const name = path.match(/^\/api\/vault\/([^\/]+)\/update$/)[1].toLowerCase();
    
    const body = await request.json();
    const { auth_hash, encrypted_data, salt_enc, salt_auth, auth_hash_double } = body;

    const vault = await getVault(env, name);
    if (!vault) {
      return jsonResponse({ error: 'Vault not found.' }, 404);
    }

    if (!auth_hash) {
      return jsonResponse(
        { error: 'Missing verification proof. Update denied.' },
        401
      );
    }

    const proof = await sha256(auth_hash);
    if (proof !== vault.auth_hash_double) {
      return jsonResponse(
        { error: 'Verification failed. Access denied.' },
        401
      );
    }

    vault.encrypted_data = encrypted_data;
    vault.updatedAt = new Date().toISOString();

    if (salt_enc && salt_auth && auth_hash_double) {
      vault.salt_enc = salt_enc;
      vault.salt_auth = salt_auth;
      vault.auth_hash_double = auth_hash_double;
    }

    await saveVault(env, name, vault);
    return jsonResponse({ success: true });
  }

  // API: Delete vault
  if (method === 'POST' && path.match(/^\/api\/vault\/([^\/]+)\/delete$/)) {
    const name = path.match(/^\/api\/vault\/([^\/]+)\/delete$/)[1].toLowerCase();
    
    const body = await request.json();
    const { auth_hash } = body;

    const vault = await getVault(env, name);
    if (!vault) {
      return jsonResponse({ error: 'Vault not found.' }, 404);
    }

    if (!auth_hash) {
      return jsonResponse(
        { error: 'Authentication hash is required to authorize deletion.' },
        401
      );
    }

    const proof = await sha256(auth_hash);
    if (proof !== vault.auth_hash_double) {
      return jsonResponse(
        { error: 'Authorization failed. Incorrect password. Vault deletion blocked.' },
        401
      );
    }

    await env.VAULTS.delete(name);
    return jsonResponse({ success: true });
  }

  // Return null if no API route matched (will serve static assets)
  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      // 首先尝试处理 API 请求
      const apiResponse = await handleRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }

      // 如果不是 API 请求，则转发到 Cloudflare Pages（前端）
      // ⚠️ 重要：将下面的 URL 替换为您在 Pages 中部署的实际 URL
      const pagesUrl = 'https://text-vault-app.pages.dev'; // <-- 修改这里
      
      const url = new URL(request.url);
      const targetUrl = pagesUrl + url.pathname + url.search;
      
      return fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(
        { error: 'Internal server error', message: error.message },
        500
      );
    }
  },
};
