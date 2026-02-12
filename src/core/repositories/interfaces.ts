/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { Bet, BetConfig, MarketData, BetResolution, MarketInfo, PriceUpdate } from '../domain/types';

export interface IMarketRepository {
  getCurrentMarketData(marketId: string): Promise<MarketData>;
  placeBet(config: BetConfig): Promise<Bet>;
  cancelBet(betId: string): Promise<void>;
  resolveBet(betId: string): Promise<BetResolution>;
  isMarketAvailable(marketId: string): Promise<boolean>;
  getCurrentMarket?(): Promise<MarketInfo>;
  getAccountBalance?(): Promise<number | null>;
  onMarketUpdate?(handler: (info: MarketInfo) => void): () => void;
  onBalanceUpdate?(handler: (balance: number | null | undefined) => void): () => void;
  onPriceUpdate?(handler: (update: PriceUpdate) => void): () => void;
  updateAuth?(settings: {
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
    apiAddress: string;
    signatureType: 0 | 1 | 2;
    liveTradingEnabled?: boolean;
    walletPrivateKey?: string;
  }): void;

  isLiveTrading?(): boolean;
  getLiveTradingBlockReason?(): string | null;
}

export interface IBalanceRepository {
  getBalance(): Promise<number>;
  deduct(amount: number): Promise<void>;
  add(amount: number): Promise<void>;
  hasSufficientBalance(amount: number): Promise<boolean>;
  getHistory?(): Promise<Array<{ delta: number; balance: number; at: Date; reason?: string }>>;
}

export interface IBetRepository {
  save(bet: Bet): Promise<void>;
  getById(betId: string): Promise<Bet | null>;
  getAll(): Promise<Bet[]>;
  getActive(): Promise<Bet[]>;
  update(bet: Bet): Promise<void>;
  getHistory(limit?: number, offset?: number): Promise<Bet[]>;
  count(): Promise<number>;
  getWinRate(): Promise<number>;
}
