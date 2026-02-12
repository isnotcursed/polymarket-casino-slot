/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { SlotConfig } from '../config/slot.config';

const LIVE_WS = SlotConfig.polymarket.wsEndpoint ?? 'wss://ws-live-data.polymarket.com';
const PRICE_SYMBOL = SlotConfig.polymarket.priceSymbol ?? 'btc/usd';
const UP_LABEL = SlotConfig.polymarket.upOutcomeLabel ?? 'Up';
const DOWN_LABEL = SlotConfig.polymarket.downOutcomeLabel ?? 'Down';

type TokenIds = { yes?: string; no?: string };

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const p = Number(value);
    return Number.isFinite(p) ? p : null;
  }
  return null;
};

const normalizeOutcome = (value: unknown): 'YES' | 'NO' | null => {
  if (typeof value !== 'string') return null;
  const n = value.trim().toLowerCase();
  const up = UP_LABEL.trim().toLowerCase();
  const down = DOWN_LABEL.trim().toLowerCase();
  if (['yes', 'y', 'up', up].includes(n)) return 'YES';
  if (['no', 'n', 'down', down].includes(n)) return 'NO';
  return null;
};

const safeJsonParse = (s: string) => {
  try { return JSON.parse(s); } catch { return null; }
};

const normalizePayload = (payload: unknown): Record<string, unknown> | null => {
  if (!payload) return null;
  if (typeof payload === 'object') return payload as Record<string, unknown>;
  if (typeof payload === 'string') return safeJsonParse(payload);
  return null;
};

export interface PriceUpdate {
  price: number;
  timestamp: Date;
}

export interface OddsPartial {
  buyYes?: number | null;
  buyNo?: number | null;
  sellYes?: number | null;
  sellNo?: number | null;
}

export interface PolyLiveRelayCallbacks {
  onPrice: (update: PriceUpdate) => void;
  onMatchedOrder: (partial: OddsPartial) => void;
}

export class PolyLiveRelay {
  private socket: WebSocket | null = null;
  private pending: string[] = [];
  private activeSlug = '';
  private chainlinkSubscribed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTokenIds: TokenIds = {};
  private currentSlug = '';

  constructor(private readonly callbacks: PolyLiveRelayCallbacks) {}

  connect(): void {
    if (this.socket) return;
    try {
      this.socket = new WebSocket(LIVE_WS);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.chainlinkSubscribed = false;
      this.flushPending();
      this.subscribeChainlink();
      if (this.currentSlug) this.subscribeActivity(this.currentSlug);
    };

    this.socket.onmessage = (event) => this.handleMessage(event.data);

    this.socket.onclose = () => {
      this.socket = null;
      this.chainlinkSubscribed = false;
      this.activeSlug = '';
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.socket = null;
      this.chainlinkSubscribed = false;
      this.activeSlug = '';
      this.scheduleReconnect();
    };
  }

  updateMarket(slug: string, tokenIds: TokenIds): void {
    const slugChanged = slug !== this.currentSlug;
    this.currentSlug = slug;
    this.currentTokenIds = tokenIds;

    if (slugChanged && this.socket?.readyState === WebSocket.OPEN) {
      if (this.activeSlug) this.unsubscribeActivity(this.activeSlug);
      this.subscribeActivity(slug);
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private send(payload: Record<string, unknown>): void {
    const data = JSON.stringify(payload);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    } else {
      this.pending.push(data);
    }
  }

  private flushPending(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.pending.forEach((m) => this.socket!.send(m));
    this.pending = [];
  }

  private subscribeActivity(slug: string): void {
    if (!slug) return;
    this.send({
      action: 'subscribe',
      subscriptions: [{ topic: 'activity', type: 'orders_matched', filters: JSON.stringify({ event_slug: slug }) }],
    });
    this.activeSlug = slug;
  }

  private unsubscribeActivity(slug: string): void {
    if (!slug) return;
    this.send({
      action: 'unsubscribe',
      subscriptions: [{ topic: 'activity', type: 'orders_matched', filters: JSON.stringify({ event_slug: slug }) }],
    });
  }

  private subscribeChainlink(): void {
    if (this.chainlinkSubscribed) return;
    this.send({
      action: 'subscribe',
      subscriptions: [{ topic: 'crypto_prices_chainlink', type: 'update', filters: JSON.stringify({ symbol: PRICE_SYMBOL }) }],
    });
    this.chainlinkSubscribed = true;
  }

  private handleMessage(raw: unknown): void {
    const text = typeof raw === 'string' ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(new Uint8Array(raw)) : null;
    if (!text) return;
    const parsed = safeJsonParse(text);
    if (!parsed) return;

    const topic = parsed.topic ?? parsed.subscription?.topic;
    const type = parsed.type ?? parsed.subscription?.type;
    const payload = normalizePayload(parsed.payload) ?? normalizePayload(parsed.data) ?? parsed;

    if (!topic || typeof topic !== 'string') return;

    if (topic === 'crypto_prices_chainlink') {
      this.handleChainlink(payload);
      return;
    }
    if (topic === 'activity' && type === 'orders_matched') {
      this.handleMatchedOrder(payload);
    }
  }

  private handleChainlink(payload: Record<string, unknown>): void {
    const symbol = String(payload.symbol ?? payload.pair ?? payload.ticker ?? '').toLowerCase();
    if (symbol && !symbol.includes(PRICE_SYMBOL.toLowerCase())) return;

    const price =
      toNumber(payload.value ?? payload.price ?? payload.current ?? payload.data) ??
      toNumber(payload.price_usd ?? payload.priceUsd ?? payload.usd);
    if (price === null) return;

    const updatedAt = toNumber(payload.timestamp) ?? toNumber(payload.updatedAt ?? payload.updated_at);
    const timestamp = updatedAt !== null ? new Date(updatedAt * 1000) : new Date();

    this.callbacks.onPrice({ price, timestamp });
  }

  private handleMatchedOrder(payload: Record<string, unknown>): void {
    const slug = (payload.event_slug ?? payload.eventSlug ?? payload.market_slug ?? payload.marketSlug) as string | undefined;
    if (slug && this.currentSlug && slug !== this.currentSlug) return;

    let outcome = normalizeOutcome(payload.outcome ?? payload.outcome_name ?? payload.outcomeName ?? payload.side);
    if (!outcome) {
      const tokenId = String(payload.token_id ?? payload.tokenId ?? payload.asset_id ?? payload.assetId ?? payload.token ?? '');
      if (tokenId === this.currentTokenIds.yes) outcome = 'YES';
      else if (tokenId === this.currentTokenIds.no) outcome = 'NO';
    }
    if (!outcome) return;

    const price =
      toNumber(payload.price) ?? toNumber(payload.match_price ?? payload.matchPrice) ??
      toNumber(payload.price_per_share ?? payload.pricePerShare) ??
      toNumber(payload.limit_price ?? payload.limitPrice) ??
      toNumber(payload.fill_price ?? payload.fillPrice);
    if (price === null) return;

    const sideRaw = (payload.side ?? payload.taker_side ?? payload.takerSide ?? payload.orderSide ?? payload.tradeSide) as string | undefined;
    const side = typeof sideRaw === 'string' ? sideRaw.trim().toUpperCase() : '';
    const isBuy = side === 'BUY';
    const isSell = side === 'SELL';

    const partial: OddsPartial = {};
    if (outcome === 'YES') {
      if (isBuy) partial.buyYes = price;
      else if (isSell) partial.sellYes = price;
      else partial.buyYes = price;
    }
    if (outcome === 'NO') {
      if (isBuy) partial.buyNo = price;
      else if (isSell) partial.sellNo = price;
      else partial.buyNo = price;
    }

    this.callbacks.onMatchedOrder(partial);
  }
}
