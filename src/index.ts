/**
 * @license Source-Available (Non-Commercial)
 */

import { serve, type ServerWebSocket } from 'bun';
import { AssetType, ClobClient, getContractConfig } from '@polymarket/clob-client';
import type { ApiKeyCreds } from '@polymarket/clob-client';
import type { JsonRpcSigner } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';

import { SlotConfig } from './config/slot.config';
import { resolveCurrentMarket, type TokenIds } from './server/marketTracker';
import { fetchOdds, type OddsState } from './server/orderBookOdds';
import { PolyLiveRelay } from './server/polyLiveRelay';
import index from './index.html';


const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';
const DATA_BASE = 'https://data-api.polymarket.com';
const POLY_RPC_URL = SlotConfig.polymarket.rpcUrl ?? 'https://polygon-rpc.com';
const EXCHANGE_ADDRESS = getContractConfig(137).exchange;
const EXCHANGE_ABI = [
  'function getPolyProxyWalletAddress(address user) view returns (address)',
  'function getSafeAddress(address user) view returns (address)',
];
const MARKET_REFRESH_MS = SlotConfig.polymarket.refreshInterval ?? 5000;


const TOPICS = {
  market: 'pm:market',
  odds: 'pm:odds',
  price: 'pm:price',
} as const;


type WsAuth = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  apiAddress: string;
  signatureType: 0 | 1 | 2;
};

type WsData = { auth?: WsAuth };

let serverRef: Bun.Server<WsData> | null = null;
let lastMarketMsg: string | null = null;
let lastOddsMsg: string | null = null;
let lastPriceMsg: string | null = null;

let currentSlug = '';
let currentEndsAt: Date | null = null;
let currentTokenIds: TokenIds = {};
let currentOdds: OddsState = {};
let currentPrice: number | null = null;
let lastPriceAt: Date | null = null;
let currentReferencePrice: number | null = null;
let referencePriceSlug = '';
let lastOddsAt = 0;
let oddsInFlight = false;
let marketInFlight = false;

let marketTimer: ReturnType<typeof setInterval> | null = null;
const authedSockets = new Set<ServerWebSocket<WsData>>();

let exchangeProvider: JsonRpcProvider | null = null;
let exchangeContract: Contract | null = null;

const clamp01 = (v: number | null | undefined): number | null =>
  v == null ? null : Math.max(0, Math.min(1, v));

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};

const msg = (type: string, payload: unknown) => JSON.stringify({ type, payload });

const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v);

const getExchangeContract = () => {
  if (!exchangeProvider) exchangeProvider = new JsonRpcProvider(POLY_RPC_URL);
  if (!exchangeContract) exchangeContract = new Contract(EXCHANGE_ADDRESS, EXCHANGE_ABI, exchangeProvider);
  return exchangeContract;
};


const publishMarket = () => {
  if (!serverRef || !currentSlug) return;
  const payload = {
    id: currentSlug,
    displayId: currentSlug,
    endsAt: currentEndsAt?.toISOString() ?? null,
    tokenIds: { yes: currentTokenIds.yes, no: currentTokenIds.no },
    referencePrice: currentReferencePrice ?? null,
  };
  const m = msg('market', payload);
  if (m !== lastMarketMsg) { lastMarketMsg = m; serverRef.publish(TOPICS.market, m); }
};

const publishOdds = () => {
  if (!serverRef) return;
  const payload = {
    buyYes: clamp01(currentOdds.buyYes) ?? undefined,
    buyNo: clamp01(currentOdds.buyNo) ?? undefined,
    sellYes: clamp01(currentOdds.sellYes) ?? undefined,
    sellNo: clamp01(currentOdds.sellNo) ?? undefined,
  };
  const m = msg('odds', payload);
  if (m !== lastOddsMsg) { lastOddsMsg = m; serverRef.publish(TOPICS.odds, m); }
};

const publishPrice = () => {
  if (!serverRef || currentPrice === null) return;
  const payload = {
    currentPrice,
    volume: 0,
    timestamp: (lastPriceAt ?? new Date()).toISOString(),
  };
  const m = msg('price', payload);
  if (m !== lastPriceMsg) { lastPriceMsg = m; serverRef.publish(TOPICS.price, m); }
};

const sendCachedSnapshot = (ws: ServerWebSocket<WsData>) => {
  if (lastMarketMsg) ws.send(lastMarketMsg);
  if (lastOddsMsg) ws.send(lastOddsMsg);
  if (lastPriceMsg) ws.send(lastPriceMsg);
};


const refreshOdds = async () => {
  if (oddsInFlight) return;
  if (!currentTokenIds.yes && !currentTokenIds.no) return;
  oddsInFlight = true;
  try {
    const odds = await fetchOdds(currentTokenIds.yes, currentTokenIds.no);
    if (odds.buyYes != null) currentOdds.buyYes = odds.buyYes;
    if (odds.buyNo != null) currentOdds.buyNo = odds.buyNo;
    if (odds.sellYes != null) currentOdds.sellYes = odds.sellYes;
    if (odds.sellNo != null) currentOdds.sellNo = odds.sellNo;
    lastOddsAt = Date.now();
    publishOdds();
  } finally {
    oddsInFlight = false;
  }
};

const updateMarketState = async () => {
  if (marketInFlight) return;
  marketInFlight = true;
  try {
    const tracked = await resolveCurrentMarket();
    if (!tracked) {
      if (!currentSlug) {
        currentSlug = SlotConfig.polymarket.marketId;
        currentEndsAt = new Date(Date.now() + 15 * 60 * 1000);
        publishMarket();
      }
      return;
    }

    const slugChanged = tracked.slug !== currentSlug;
    const tokensChanged =
      tracked.tokenIds.yes !== currentTokenIds.yes ||
      tracked.tokenIds.no !== currentTokenIds.no;

    currentSlug = tracked.slug;
    currentEndsAt = tracked.endsAt;
    currentTokenIds = tracked.tokenIds;
    if (slugChanged || referencePriceSlug !== tracked.slug) {
      referencePriceSlug = tracked.slug;
      currentReferencePrice = null;
    }

    if (slugChanged || tokensChanged) {
      currentOdds = {};
      publishMarket();
      publishOdds();
      polyRelay.updateMarket(tracked.slug, tracked.tokenIds);
    }

    if (slugChanged || tokensChanged || Date.now() - lastOddsAt > MARKET_REFRESH_MS) {
      void refreshOdds();
    }
  } catch { /* ignore */ } finally {
    marketInFlight = false;
  }
};

const startMarketLoop = () => {
  if (marketTimer) return;
  marketTimer = setInterval(() => {
    void updateMarketState();
    if (
      serverRef &&
      (serverRef.subscriberCount(TOPICS.market) > 0 || serverRef.subscriberCount(TOPICS.odds) > 0)
    ) {
      if (Date.now() - lastOddsAt > MARKET_REFRESH_MS) void refreshOdds();
    }
  }, MARKET_REFRESH_MS);
  void updateMarketState();
};


const polyRelay = new PolyLiveRelay({
  onPrice({ price, timestamp }) {
    currentPrice = price;
    lastPriceAt = timestamp;
    if (currentSlug && referencePriceSlug === currentSlug && currentReferencePrice == null) {
      currentReferencePrice = price;
      publishMarket();
    }
    publishPrice();
  },
  onMatchedOrder(partial) {
    if (partial.buyYes != null) currentOdds.buyYes = partial.buyYes;
    if (partial.buyNo != null) currentOdds.buyNo = partial.buyNo;
    if (partial.sellYes != null) currentOdds.sellYes = partial.sellYes;
    if (partial.sellNo != null) currentOdds.sellNo = partial.sellNo;
    publishOdds();
    if (Date.now() - lastOddsAt > 1500) void refreshOdds();
  },
});

const buildAuthedClient = (auth: WsAuth): ClobClient => {
  const signer = { getAddress: async () => auth.apiAddress };
  const creds: ApiKeyCreds = { key: auth.apiKey, secret: auth.apiSecret, passphrase: auth.apiPassphrase };
  return new ClobClient(
    CLOB_BASE, 137,
    signer as unknown as JsonRpcSigner,
    creds, auth.signatureType,
    undefined, undefined, true,
  );
};

const pushBalance = async (ws: ServerWebSocket<WsData>) => {
  const auth = ws.data.auth;
  if (!auth) return;
  try {
    const client = buildAuthedClient(auth);
    const response = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const balance = toNumber(response?.balance);
    const allowance = toNumber(response?.allowance);
    const available = balance == null || allowance == null
      ? balance ?? allowance
      : Math.min(balance, allowance);
    ws.send(msg('balance', { balance: available != null ? available / 1_000_000 : null }));
  } catch {
    ws.send(msg('balance', { balance: null }));
  }
};

const buildCorsHeaders = (origin: string | null) => ({
  'access-control-allow-origin': origin ?? '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, poly-address, poly-signature, poly-timestamp, poly-api-key, poly-passphrase, poly-nonce, poly_address, poly_signature, poly_timestamp, poly_api_key, poly_passphrase, poly_nonce',
  'access-control-max-age': '86400',
});

const buildForwardHeaders = (req: Request) => {
  const headers = new Headers();
  const allow = new Set(['accept', 'content-type', 'authorization']);
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (allow.has(lower) || lower.startsWith('poly_') || lower.startsWith('poly-')) {
      headers.set(key, value);
    }
  });
  return headers;
};

const safeJsonParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

const parseText = (raw: string | ArrayBuffer | ArrayBufferView): string | null => {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(raw));
  if (ArrayBuffer.isView(raw)) return new TextDecoder().decode(raw);
  return null;
};

const server = serve<WsData>({
  routes: {
    '/ws': (req: Request, server: Bun.Server<WsData>) => {
      const upgraded = server.upgrade(req, { data: {} });
      if (!upgraded) return new Response('WebSocket upgrade failed', { status: 400 });
    },

    '/api/polymarket/derived-addresses': {
      async GET(req: Request) {
        const url = new URL(req.url);
        const owner = url.searchParams.get('owner')?.trim() ?? '';
        if (!isAddress(owner)) return Response.json({ error: 'invalid owner address' }, { status: 400 });
        try {
          const exchange = getExchangeContract();
          const [proxyAddress, safeAddress] = await Promise.all([
            exchange.getPolyProxyWalletAddress(owner),
            exchange.getSafeAddress(owner),
          ]);
          return Response.json({ owner, proxyAddress, safeAddress, exchange: EXCHANGE_ADDRESS });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'failed to resolve addresses';
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    '/api/polymarket/*': async (req: Request) => {
      const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const url = new URL(req.url);
      const targetPath = url.pathname.replace('/api/polymarket', '');
      const targetUrl = `${GAMMA_BASE}${targetPath}${url.search}`;

      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const upstream = await fetch(targetUrl, { method: req.method, headers: buildForwardHeaders(req), body });

      const responseBody = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const ct = upstream.headers.get('content-type');
      if (ct) headers.set('content-type', ct);
      return new Response(responseBody, { status: upstream.status, headers });
    },

    '/api/data/*': async (req: Request) => {
      const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const url = new URL(req.url);
      const targetPath = url.pathname.replace('/api/data', '');
      const targetUrl = `${DATA_BASE}${targetPath}${url.search}`;

      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const upstream = await fetch(targetUrl, { method: req.method, headers: buildForwardHeaders(req), body });

      const responseBody = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const ct = upstream.headers.get('content-type');
      if (ct) headers.set('content-type', ct);
      return new Response(responseBody, { status: upstream.status, headers });
    },

    '/api/rpc': async (req: Request) => {
      const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const body = await req.arrayBuffer();
      const upstream = await fetch(POLY_RPC_URL, {
        method: 'POST',
        headers: buildForwardHeaders(req),
        body,
      });

      const responseBody = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const ct = upstream.headers.get('content-type');
      if (ct) headers.set('content-type', ct);
      return new Response(responseBody, { status: upstream.status, headers });
    },

    '/api/clob/*': async (req: Request) => {
      const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

      const url = new URL(req.url);
      let targetPath = url.pathname.replace('/api/clob', '');
      if (targetPath === '/simplified-market') targetPath = '/simplified-markets';
      else if (targetPath === '/sampling-simplified-market') targetPath = '/sampling-simplified-markets';
      const targetUrl = `${CLOB_BASE}${targetPath}${url.search}`;

      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const upstream = await fetch(targetUrl, { method: req.method, headers: buildForwardHeaders(req), body });

      const responseBody = await upstream.arrayBuffer();
      const headers = new Headers(corsHeaders);
      const ct = upstream.headers.get('content-type');
      if (ct) headers.set('content-type', ct);
      return new Response(responseBody, { status: upstream.status, headers });
    },

    '/*': index,
  },

  websocket: {
    open(ws) {
      ws.subscribe(TOPICS.market);
      ws.subscribe(TOPICS.odds);
      ws.subscribe(TOPICS.price);
      sendCachedSnapshot(ws);
      startMarketLoop();
      polyRelay.connect();
    },
    message(ws, raw) {
      const text = parseText(raw as string | ArrayBuffer | ArrayBufferView);
      if (!text) return;
      const payload = safeJsonParse(text) as { type?: string; payload?: any } | null;
      if (!payload?.type) return;

      if (payload.type === 'auth') {
        const auth = payload.payload as WsAuth | null | undefined;
        if (auth?.apiKey && auth.apiSecret && auth.apiPassphrase && auth.apiAddress) {
          ws.data.auth = auth;
          authedSockets.add(ws);
          void pushBalance(ws);
        } else {
          ws.data.auth = undefined;
          authedSockets.delete(ws);
          ws.send(msg('balance', { balance: null }));
        }
        return;
      }

      if (payload.type === 'request') {
        const topic = payload.payload?.topic;
        if (topic === 'balance') { void pushBalance(ws); return; }
        if (topic === 'snapshot' || topic === 'market' || topic === 'odds' || topic === 'price') {
          sendCachedSnapshot(ws);
          return;
        }
      }
    },
    close(ws) {
      authedSockets.delete(ws);
    },
  },

  development: process.env.NODE_ENV !== 'production' && { hmr: true, console: true },
});

serverRef = server;

setInterval(() => {
  authedSockets.forEach((ws) => void pushBalance(ws));
}, 3000);

startMarketLoop();
polyRelay.connect();

console.log(`🚀 Server running at ${server.url}`);
