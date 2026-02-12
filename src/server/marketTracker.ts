/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { SlotConfig } from '../config/slot.config';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const SERIES_ID = SlotConfig.polymarket.seriesId ?? '10192';
const SERIES_SLUG = SlotConfig.polymarket.seriesSlug ?? 'btc-up-or-down-15m';
const SLUG_PREFIX = SlotConfig.polymarket.slugPrefix ?? 'btc-updown-15m';
const UP_LABEL = SlotConfig.polymarket.upOutcomeLabel ?? 'Up';
const DOWN_LABEL = SlotConfig.polymarket.downOutcomeLabel ?? 'Down';

type MarketRecord = Record<string, unknown>;

export interface TokenIds {
  yes?: string;
  no?: string;
}

export interface TrackedMarket {
  slug: string;
  endsAt: Date | null;
  tokenIds: TokenIds;
  raw: MarketRecord | null;
}


const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const p = Number(value);
    return Number.isFinite(p) ? p : null;
  }
  return null;
};

const safeTimeMs = (value: unknown): number | null => {
  if (!value) return null;
  const d = new Date(value as string);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
};

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};


export const deriveEndsAtMsFromSlug = (
  slug: string | null | undefined,
  nowMs: number = Date.now(),
): number | null => {
  if (!slug) return null;
  const match = String(slug).match(/(\d{10,})$/);
  const raw = match?.[1];
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const baseMs = raw.length >= 13 ? parsed : parsed * 1000;
  if (!Number.isFinite(baseMs)) return null;
  const endMs = baseMs <= nowMs ? baseMs + 15 * 60 * 1000 : baseMs;
  return Number.isFinite(endMs) ? endMs : null;
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

const fetchMarketsBySeriesSlug = async (seriesSlug: string, limit = 200): Promise<MarketRecord[]> => {
  if (!seriesSlug) return [];
  const url = new URL('/markets', GAMMA_BASE);
  url.searchParams.set('seriesSlug', seriesSlug);
  url.searchParams.set('active', 'true');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('enableOrderBook', 'true');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

const fetchLiveEventsBySeriesId = async (seriesId: string, limit = 20): Promise<unknown[]> => {
  if (!seriesId) return [];
  const url = new URL('/events', GAMMA_BASE);
  url.searchParams.set('series_id', String(seriesId));
  url.searchParams.set('active', 'true');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

const flattenEventMarkets = (events: unknown[]): MarketRecord[] => {
  const out: MarketRecord[] = [];
  for (const event of events) {
    const markets = Array.isArray((event as MarketRecord)?.markets)
      ? ((event as MarketRecord).markets as MarketRecord[])
      : [];
    markets.forEach((m) => out.push(m));
  }
  return out;
};


const pickLatestLiveMarket = (markets: MarketRecord[], nowMs = Date.now()): MarketRecord | null => {
  if (!markets.length) return null;

  const enriched = markets
    .map((market) => {
      const slug = String(market.slug ?? market.market_slug ?? market.id ?? '');
      const endMs =
        safeTimeMs(market.endDate ?? market.end_date ?? market.endTime ?? market.end_time) ??
        deriveEndsAtMsFromSlug(slug, nowMs);
      const startMs = safeTimeMs(
        market.eventStartTime ?? market.startTime ?? market.startDate ?? market.start_date,
      );
      return { market, endMs, startMs };
    })
    .filter((i) => i.endMs !== null);

  const live = enriched
    .filter((i) => {
      const started = i.startMs === null ? true : i.startMs <= nowMs;
      return started && nowMs < (i.endMs ?? 0);
    })
    .sort((a, b) => (a.endMs ?? 0) - (b.endMs ?? 0));

  const firstLive = live[0];
  if (firstLive) return firstLive.market;

  const upcoming = enriched
    .filter((i) => nowMs < (i.endMs ?? 0))
    .sort((a, b) => (a.endMs ?? 0) - (b.endMs ?? 0));

  const firstUpcoming = upcoming[0];
  return firstUpcoming ? firstUpcoming.market : null;
};

const marketHasSeriesSlug = (market: MarketRecord, wanted: string): boolean => {
  if (!wanted) return false;
  const lower = wanted.toLowerCase();
  const events = Array.isArray(market.events) ? market.events : [];
  for (const event of events) {
    const series = Array.isArray((event as MarketRecord).series)
      ? ((event as MarketRecord).series as MarketRecord[])
      : [];
    for (const item of series) {
      if (String(item.slug ?? '').toLowerCase() === lower) return true;
    }
    if (String((event as MarketRecord).seriesSlug ?? '').toLowerCase() === lower) return true;
  }
  if (String(market.seriesSlug ?? '').toLowerCase() === lower) return true;
  return false;
};

const filterBtcUpDown15mMarkets = (markets: MarketRecord[]): MarketRecord[] => {
  const prefix = SLUG_PREFIX.toLowerCase();
  const wantedSeries = SERIES_SLUG.toLowerCase();
  return markets.filter((market) => {
    const slug = String(market.slug ?? '').toLowerCase();
    return (prefix && slug.startsWith(prefix)) || (wantedSeries && marketHasSeriesSlug(market, wantedSeries));
  });
};

export const extractTokenIds = (market: MarketRecord | null): TokenIds => {
  if (!market) return {};
  const tokenIds: TokenIds = {};

  const outcomesRaw = parseMaybeJson(market.outcomes ?? market.outcomeNames ?? market.outcome_names);
  const outcomes = Array.isArray(outcomesRaw) ? (outcomesRaw as string[]) : [];

  const assign = (label: unknown, tokenId: unknown) => {
    if (!label || !tokenId) return;
    const num = toNumber(tokenId);
    if (num !== null && num > 0 && num < 1) return;
    const outcome = normalizeOutcome(label);
    if (outcome === 'YES' && !tokenIds.yes) tokenIds.yes = String(tokenId);
    if (outcome === 'NO' && !tokenIds.no) tokenIds.no = String(tokenId);
  };

  const clobRaw = parseMaybeJson(market.clobTokenIds ?? market.clob_token_ids ?? market.tokenIds ?? market.token_ids);
  if (Array.isArray(clobRaw) && outcomes.length) {
    clobRaw.forEach((tid, i) => assign(outcomes[i], tid));
  }
  if (clobRaw && typeof clobRaw === 'object' && !Array.isArray(clobRaw)) {
    Object.entries(clobRaw as Record<string, unknown>).forEach(([l, t]) => assign(l, t));
  }

  const otRaw = parseMaybeJson(market.outcomeTokenIds ?? market.outcome_token_ids);
  if (Array.isArray(otRaw) && outcomes.length) {
    otRaw.forEach((tid, i) => assign(outcomes[i], tid));
  }

  if (!tokenIds.yes && !tokenIds.no && Array.isArray(clobRaw) && clobRaw.length >= 2) {
    tokenIds.yes = String(clobRaw[0]);
    tokenIds.no = String(clobRaw[1]);
  }

  const lists = [
    parseMaybeJson(market.outcomeTokens),
    parseMaybeJson(market.outcome_tokens),
    parseMaybeJson(market.tokens),
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const tok of list) {
      if (!tok || typeof tok !== 'object') continue;
      const r = tok as MarketRecord;
      const label = r.outcome ?? r.label ?? r.name;
      const tid = r.token_id ?? r.tokenId ?? r.id ?? r.token;
      assign(label, tid);
    }
  }

  return tokenIds;
};

export const resolveCurrentMarket = async (): Promise<TrackedMarket | null> => {
  let markets = await fetchMarketsBySeriesSlug(SERIES_SLUG, 200);
  markets = filterBtcUpDown15mMarkets(markets);
  let market = pickLatestLiveMarket(markets);

  if (!market) {
    const events = await fetchLiveEventsBySeriesId(SERIES_ID, 20);
    const flattened = flattenEventMarkets(events);
    const filtered = filterBtcUpDown15mMarkets(flattened);
    market = pickLatestLiveMarket(filtered);
  }

  if (!market) return null;

  const slug = String(market.slug ?? market.market_slug ?? market.id ?? '');
  if (!slug) return null;

  const endMs =
    safeTimeMs(market.endDate ?? market.end_date ?? market.endTime ?? market.end_time) ??
    deriveEndsAtMsFromSlug(slug);
  const endsAt = endMs ? new Date(endMs) : null;

  return {
    slug,
    endsAt,
    tokenIds: extractTokenIds(market),
    raw: market,
  };
};
