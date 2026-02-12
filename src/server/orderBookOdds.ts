/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

const CLOB_BASE = 'https://clob.polymarket.com';

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const p = Number(value);
    return Number.isFinite(p) ? p : null;
  }
  return null;
};

export interface OddsState {
  buyYes?: number | null;
  buyNo?: number | null;
  sellYes?: number | null;
  sellNo?: number | null;
}

const fetchClobPrice = async (tokenId: string, side: 'BUY' | 'SELL'): Promise<number | null> => {
  const url = new URL('/price', CLOB_BASE);
  url.searchParams.set('token_id', tokenId);
  url.searchParams.set('side', side);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return toNumber((data as Record<string, unknown>)?.price ?? data);
};

const fetchOrderBook = async (tokenId: string): Promise<Record<string, unknown> | null> => {
  const url = new URL('/book', CLOB_BASE);
  url.searchParams.set('token_id', tokenId);
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
};

const extractLevelPrice = (level: unknown): number | null => {
  if (level === null || level === undefined) return null;
  if (Array.isArray(level)) return toNumber(level[0]);
  if (typeof level === 'object') {
    const r = level as Record<string, unknown>;
    return toNumber(r.price) ?? toNumber(r.p) ?? toNumber(r.rate) ?? toNumber(r['0']);
  }
  return toNumber(level);
};

const summarizeOrderBook = (book: Record<string, unknown>) => {
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const asks = Array.isArray(book?.asks) ? book.asks : [];

  const bestBid = bids.reduce<number | null>((best, level) => {
    const price = extractLevelPrice(level);
    if (price === null) return best;
    return best === null ? price : Math.max(best, price);
  }, null);

  const bestAsk = asks.reduce<number | null>((best, level) => {
    const price = extractLevelPrice(level);
    if (price === null) return best;
    return best === null ? price : Math.min(best, price);
  }, null);

  return { bestBid, bestAsk };
};

export const fetchOdds = async (yesTokenId?: string, noTokenId?: string): Promise<OddsState> => {
  if (!yesTokenId && !noTokenId) return {};

  const [buyYes, sellYes, buyNo, sellNo] = await Promise.all([
    yesTokenId ? fetchClobPrice(yesTokenId, 'BUY') : Promise.resolve(null),
    yesTokenId ? fetchClobPrice(yesTokenId, 'SELL') : Promise.resolve(null),
    noTokenId ? fetchClobPrice(noTokenId, 'BUY') : Promise.resolve(null),
    noTokenId ? fetchClobPrice(noTokenId, 'SELL') : Promise.resolve(null),
  ]);

  const odds: OddsState = { buyYes, sellYes, buyNo, sellNo };

  const needsYesBook = yesTokenId && (buyYes === null || sellYes === null);
  const needsNoBook = noTokenId && (buyNo === null || sellNo === null);

  if (needsYesBook || needsNoBook) {
    const [yesBook, noBook] = await Promise.all([
      needsYesBook && yesTokenId ? fetchOrderBook(yesTokenId) : Promise.resolve(null),
      needsNoBook && noTokenId ? fetchOrderBook(noTokenId) : Promise.resolve(null),
    ]);

    if (yesBook) {
      const s = summarizeOrderBook(yesBook);
      if (s.bestAsk !== null && buyYes === null) odds.buyYes = s.bestAsk;
      if (s.bestBid !== null && sellYes === null) odds.sellYes = s.bestBid;
    }
    if (noBook) {
      const s = summarizeOrderBook(noBook);
      if (s.bestAsk !== null && buyNo === null) odds.buyNo = s.bestAsk;
      if (s.bestBid !== null && sellNo === null) odds.sellNo = s.bestBid;
    }
  }

  return odds;
};
