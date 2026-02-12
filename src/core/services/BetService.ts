/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import {
  BetStatus,
  type Bet,
  type BetConfig,
  type BetResolution,
} from '../domain/types';
import type {
  IMarketRepository,
  IBalanceRepository,
  IBetRepository,
} from '../repositories/interfaces';
import { SlotConfig } from '@/config/slot.config.ts';

export class BetService {
  constructor(
    private readonly marketRepository: IMarketRepository,
    private readonly balanceRepository: IBalanceRepository,
    private readonly betRepository: IBetRepository
  ) {}

  async placeBet(config: BetConfig): Promise<Bet> {
    const liveTrading = this.marketRepository.isLiveTrading?.() ?? false;

    if (liveTrading && config.amount < SlotConfig.minLiveBetAmount) {
      throw new Error(`Live bets must be at least $${SlotConfig.minLiveBetAmount.toFixed(2)}`);
    }

    if (!liveTrading) {
      const hasFunds = await this.balanceRepository.hasSufficientBalance(
        config.amount
      );
      if (!hasFunds) {
        throw new Error('Insufficient balance');
      }
    }

    const currentMarket = await this.marketRepository.getCurrentMarket?.();
    const marketId = currentMarket?.id ?? SlotConfig.polymarket.marketId;
    const isAvailable = await this.marketRepository.isMarketAvailable(marketId);
    if (!isAvailable) {
      throw new Error('Market is not available');
    }

    if (!liveTrading) {
      await this.balanceRepository.deduct(config.amount);
    }

    const bet = await this.marketRepository.placeBet(config);

    await this.betRepository.save(bet);

    return bet;
  }

  async resolveBet(betId: string): Promise<BetResolution> {
    const bet = await this.betRepository.getById(betId);
    if (!bet) {
      throw new Error('Bet not found');
    }

    if (bet.status !== BetStatus.ACTIVE) {
      throw new Error('Bet is not active');
    }

    const resolution = await this.marketRepository.resolveBet(betId);

    const updatedBet: Bet = {
      ...bet,
      status: resolution.won ? BetStatus.WON : BetStatus.LOST,
      resolvedAt: new Date(),
      payout: resolution.payout,
      exitPrice: resolution.bet.exitPrice,
    };

    await this.betRepository.update(updatedBet);

    const liveTrading = this.marketRepository.isLiveTrading?.() ?? false;
    if (!liveTrading && resolution.payout > 0) {
      await this.balanceRepository.add(resolution.payout);
    }

    return resolution;
  }

  async cancelBet(betId: string): Promise<void> {
    const bet = await this.betRepository.getById(betId);
    if (!bet) {
      throw new Error('Bet not found');
    }

    if (bet.status !== BetStatus.ACTIVE && bet.status !== BetStatus.PENDING) {
      throw new Error('Cannot cancel bet in current status');
    }

    await this.marketRepository.cancelBet(betId);

    const liveTrading = this.marketRepository.isLiveTrading?.() ?? false;
    if (!liveTrading) {
      await this.balanceRepository.add(bet.amount);
    }

    const updatedBet: Bet = {
      ...bet,
      status: BetStatus.CANCELLED,
      resolvedAt: new Date(),
    };

    await this.betRepository.update(updatedBet);
  }

  async getActiveBets(): Promise<Bet[]> {
    return this.betRepository.getActive();
  }

  async getBetById(betId: string): Promise<Bet | null> {
    return this.betRepository.getById(betId);
  }
}
