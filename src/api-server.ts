/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { serve } from "bun";

const buildCorsHeaders = (origin: string | null) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, poly-address, poly-signature, poly-timestamp, poly-api-key, poly-passphrase, poly_address, poly_signature, poly_timestamp, poly_api_key, poly_passphrase",
  "access-control-max-age": "86400",
});

const buildForwardHeaders = (req: Request) => {
  const headers = new Headers();
  const allow = new Set(["accept", "content-type", "authorization"]);
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (allow.has(lower) || lower.startsWith("poly_") || lower.startsWith("poly-")) {
      headers.set(key, value);
    }
  });
  return headers;
};

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

const server = serve({
  port,
  routes: {
    "/api/polymarket/*": async req => {
      const corsHeaders = buildCorsHeaders(req.headers.get("origin"));
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(req.url);
      const targetPath = url.pathname.replace("/api/polymarket", "");
      const targetUrl = `https://gamma-api.polymarket.com${targetPath}${url.search}`;

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: buildForwardHeaders(req),
      });

      const body = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        headers.set("content-type", contentType);
      }

      return new Response(body, {
        status: upstream.status,
        headers,
      });
    },
    "/api/data/*": async req => {
      const corsHeaders = buildCorsHeaders(req.headers.get("origin"));
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(req.url);
      const targetPath = url.pathname.replace("/api/data", "");
      const targetUrl = `https://data-api.polymarket.com${targetPath}${url.search}`;

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: buildForwardHeaders(req),
      });

      const body = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        headers.set("content-type", contentType);
      }

      return new Response(body, {
        status: upstream.status,
        headers,
      });
    },
    "/api/clob/*": async req => {
      const corsHeaders = buildCorsHeaders(req.headers.get("origin"));
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(req.url);
      const targetPath = url.pathname.replace("/api/clob", "");
      const normalizedPath =
        targetPath === "/simplified-market"
          ? "/simplified-markets"
          : targetPath === "/sampling-simplified-market"
          ? "/sampling-simplified-markets"
          : targetPath;
      const targetUrl = `https://clob.polymarket.com${normalizedPath}${url.search}`;

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: buildForwardHeaders(req),
      });

      const body = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        headers.set("content-type", contentType);
      }

      return new Response(body, {
        status: upstream.status,
        headers,
      });
    },
  },
});

console.log(`🔌 Polymarket proxy running at ${server.url}`);
