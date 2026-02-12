/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

export enum BetDirection {
  UP = 'UP',
  DOWN = 'DOWN',
}

export type DirectionMode = 'random' | 'up' | 'down';

export type BetMode = 'demo' | 'live';

export interface UserSettings {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  apiAddress: string;
  signatureType: 0 | 1 | 2;
  liveTradingEnabled: boolean;
  walletPrivateKey: string;
  holdTimeSeconds: number;
  directionMode: DirectionMode;
}

export enum BetStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  RESOLVING = 'RESOLVING',
  WON = 'WON',
  LOST = 'LOST',
  CANCELLED = 'CANCELLED',
}

export interface Bet {
  readonly id: string;
  readonly amount: number;
  readonly direction: BetDirection;
  readonly status: BetStatus;
  readonly placedAt: Date;
  readonly resolvedAt?: Date;
  readonly entryPrice?: number;
  readonly exitPrice?: number;
  readonly payout?: number;
  readonly mode: BetMode;
}

export interface SpinResult {
  readonly symbols: string[][];
  readonly isWin: boolean;
  readonly winAmount: number;
  readonly totalPayout: number;
  readonly multiplier: number;
  readonly bet: Bet;
  readonly clusters?: WinningCluster[];
}

export interface WinningCluster {
  symbol: string;
  positions: Array<{ col: number; row: number }>;
  count: number;
  payout: number;
}

export interface MarketData {
  readonly marketId: string;
  readonly currentPrice: number;
  readonly volume: number;
  readonly timestamp: Date;
}

export interface PriceUpdate {
  readonly currentPrice?: number;
  readonly volume?: number;
  readonly timestamp?: Date;
}

export interface MarketInfo {
  readonly id: string;
  readonly displayId?: string;
  readonly question?: string;
  readonly endsAt?: Date;
  readonly buyYesOdds?: number;
  readonly buyNoOdds?: number;
  readonly sellYesOdds?: number;
  readonly sellNoOdds?: number;
  readonly referencePrice?: number;
}

export interface BetConfig {
  readonly amount: number;
  readonly direction: BetDirection;
  readonly holdTimeSeconds: number;
}

export interface BetResolution {
  readonly bet: Bet;
  readonly won: boolean;
  readonly payout: number;
  readonly priceChange: number;
  readonly priceChangePercent: number;
}
