/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

export const SlotConfig = {
  defaultBetAmount: 1.0,
  minBetAmount: 0.1,
  minLiveBetAmount: 1.0,
  maxBetAmount: 100.0,
  betHoldTimeSeconds: 1,
  minHoldTimeSeconds: 1,
  maxHoldTimeSeconds: 900,
  polymarket: {
    marketId: 'btc-updown-15m',
    apiEndpoint: 'https://api.polymarket.com/v1',
    apiDetailsUrl: 'https://polymarket.com/profile',
    tradingDocsUrl: 'https://docs.polymarket.com/developers/market-makers/setup',
    clobHost: '/api/clob',
    rpcUrl: 'https://polygon-rpc.com',
    wsEndpoint: 'wss://ws-live-data.polymarket.com',
    seriesId: '10192',
    seriesSlug: 'btc-up-or-down-15m',
    slugPrefix: 'btc-updown-15m',
    priceSymbol: 'btc/usd',
    upOutcomeLabel: 'Up',
    downOutcomeLabel: 'Down',
    refreshInterval: 5000,
  },
  animation: {
    spinDuration: 1000,
    symbolSize: 100,
    visibleSymbols: 7,
    reelCount: 7,
  },
  sound: {
    enabled: true,
    volume: 0.5,
  },
} as const;
