// Cloudflare Worker: Baidu Plant Recognition API Proxy
// Handles CORS, token management, and request forwarding

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_API_URL = 'https://aip.baidubce.com/rest/2.0/image-classify/v1/plant';

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

// Get Baidu access token
async function getToken(apiKey, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiry - 600) return cachedToken;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secretKey,
  });

  const resp = await fetch(BAIDU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));

  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 2592000);
  return cachedToken;
}

// CORS headers
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const cors = corsHeaders(origin);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // GET /api/config - check if API keys are configured
    if (url.pathname === '/api/config' && request.method === 'GET') {
      const configured = !!(env.BAIDU_API_KEY && env.BAIDU_SECRET_KEY);
      return new Response(JSON.stringify({ configured, success: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // POST /api/identify - proxy to Baidu plant recognition
    if (url.pathname === '/api/identify' && request.method === 'POST') {
      if (!env.BAIDU_API_KEY || !env.BAIDU_SECRET_KEY) {
        return new Response(JSON.stringify({ error: 'API not configured', success: false }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      try {
        const body = await request.json();
        const image = body.image;
        if (!image) {
          return new Response(JSON.stringify({ error: 'No image provided', success: false }), {
            status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }

        // Size limit: ~4MB base64
        if (image.length > 4 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'Image too large', success: false }), {
            status: 413, headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }

        const token = await getToken(env.BAIDU_API_KEY, env.BAIDU_SECRET_KEY);
        const apiResp = await fetch(`${BAIDU_API_URL}?access_token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `image=${encodeURIComponent(image)}&baike_num=1`,
        });
        const result = await apiResp.json();

        return new Response(JSON.stringify(result), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message, success: false }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};
