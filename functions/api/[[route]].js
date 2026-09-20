/**
 * Cloudflare Pages Functions: /api/* handler
 * 
 * 当使用 Cloudflare Pages 部署时，此文件会自动拦截并处理所有 /api/* 路由，
 * 直接访问绑定的 KV Namespace (VAULTS)，无需单独维护和配置独立 Cloudflare Worker。
 */

// Helper to create SHA-256 hash
async function sha256(data) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison helper to prevent timing attacks
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Helper to get vault from KV storage
async function getVault(env, name) {
  if (!env || !env.VAULTS) return null;
  const vaultData = await env.VAULTS.get(name);
  return vaultData ? JSON.parse(vaultData) : null;
}

// Helper to save vault to KV storage
async function saveVault(env, name, vault) {
  if (!env || !env.VAULTS) throw new Error('KV binding VAULTS not found.');
  await env.VAULTS.put(name, JSON.stringify(vault));
}

// Helper to validate vault name
function isValidVaultName(name) {
  return /^[a-zA-Z0-9]{1,10}$/.test(name);
}

// Standard security headers with CORS support
const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper to create JSON response with security headers
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

// Router for API endpoints
async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight options request
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: SECURITY_HEADERS,
    });
  }

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
    if (!safeCompare(proof, vault.auth_hash_double)) {
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
    if (!safeCompare(proof, vault.auth_hash_double)) {
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
    if (!safeCompare(proof, vault.auth_hash_double)) {
      return jsonResponse(
        { error: 'Authorization failed. Incorrect password. Vault deletion blocked.' },
        401
      );
    }

    if (!env || !env.VAULTS) throw new Error('KV binding VAULTS not found.');
    await env.VAULTS.delete(name);
    return jsonResponse({ success: true });
  }

  // API: Create new shared document
  if (method === 'POST' && path === '/api/share/create') {
    const body = await request.json();
    const { id, hasPassword, salt_enc, salt_auth, auth_hash_double, encrypted_data, key_unprotected } = body;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
      return jsonResponse({ error: 'Invalid share ID. Must be 6-64 alphanumeric characters.' }, 400);
    }

    if (typeof hasPassword !== 'boolean' || !encrypted_data) {
      return jsonResponse({ error: 'Missing required properties.' }, 400);
    }

    if (hasPassword && (!salt_enc || !salt_auth || !auth_hash_double)) {
      return jsonResponse({ error: 'Password-protected shares require salt_enc, salt_auth, and auth_hash_double.' }, 400);
    }

    if (!env || !env.VAULTS) {
      return jsonResponse({ error: 'KV Namespace VAULTS is not bound in Cloudflare Pages settings.' }, 500);
    }

    const existing = await env.VAULTS.get('share:' + id);
    if (existing) {
      return jsonResponse({ error: 'Share ID already exists.' }, 400);
    }

    const share = {
      id,
      hasPassword,
      salt_enc: salt_enc || undefined,
      salt_auth: salt_auth || undefined,
      auth_hash_double: auth_hash_double || undefined,
      encrypted_data,
      key_unprotected: key_unprotected || undefined,
      createdAt: new Date().toISOString(),
    };

    await env.VAULTS.put('share:' + id, JSON.stringify(share));
    return jsonResponse({ success: true, id });
  }

  // API: Get shared document metadata or unprotected content
  if (method === 'GET' && path.match(/^\/api\/share\/([a-zA-Z0-9_-]{6,64})$/)) {
    const id = path.match(/^\/api\/share\/([a-zA-Z0-9_-]{6,64})$/)[1];

    if (!env || !env.VAULTS) {
      return jsonResponse({ error: 'KV Namespace VAULTS is not bound in Cloudflare Pages settings.' }, 500);
    }

    const raw = await env.VAULTS.get('share:' + id);
    if (!raw) {
      return jsonResponse({ exists: false, error: 'Shared document not found.' }, 404);
    }

    const share = JSON.parse(raw);
    if (share.hasPassword) {
      return jsonResponse({
        exists: true,
        hasPassword: true,
        salt_enc: share.salt_enc,
        salt_auth: share.salt_auth,
      });
    } else {
      return jsonResponse({
        exists: true,
        hasPassword: false,
        encrypted_data: share.encrypted_data,
        key_unprotected: share.key_unprotected,
      });
    }
  }

  // API: Access password-protected shared document
  if (method === 'POST' && path.match(/^\/api\/share\/([a-zA-Z0-9_-]{6,64})\/access$/)) {
    const id = path.match(/^\/api\/share\/([a-zA-Z0-9_-]{6,64})\/access$/)[1];

    if (!env || !env.VAULTS) {
      return jsonResponse({ error: 'KV Namespace VAULTS is not bound in Cloudflare Pages settings.' }, 500);
    }

    const raw = await env.VAULTS.get('share:' + id);
    if (!raw) {
      return jsonResponse({ error: 'Shared document not found.' }, 404);
    }

    const share = JSON.parse(raw);
    if (!share.hasPassword) {
      return jsonResponse({
        success: true,
        encrypted_data: share.encrypted_data,
        key_unprotected: share.key_unprotected,
      });
    }

    const body = await request.json();
    const { auth_hash } = body;
    if (!auth_hash) {
      return jsonResponse({ error: 'Password verification hash is required to access shared document.' }, 401);
    }

    const proof = await sha256(auth_hash);
    if (!share.auth_hash_double || !safeCompare(proof, share.auth_hash_double)) {
      return jsonResponse({ error: 'Password verification failed. Access denied.' }, 401);
    }

    return jsonResponse({
      success: true,
      encrypted_data: share.encrypted_data,
    });
  }

  // API: Delete shared document
  if (method === 'POST' && path.match(/^\/api\/share\/([a-zA-Z0-9_-]{6,64})\/delete$/)) {
    const id = path.match(/^\/api\/share\/([a-zA-Z0-9_-]{6,64})\/delete$/)[1];
    if (env && env.VAULTS) {
      await env.VAULTS.delete('share:' + id);
    }
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: `API route not found: ${path}` }, 404);
}

export async function onRequest(context) {
  try {
    return await handleApiRequest(context.request, context.env);
  } catch (error) {
    console.error('Pages Functions Error:', error);
    return jsonResponse(
      { error: 'Internal server error', message: error.message },
      500
    );
  }
}
