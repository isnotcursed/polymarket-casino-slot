/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { IBetRepository } from '@/core/repositories/interfaces.ts';
import type { Bet } from '@/core/domain/types.ts';

export class InMemoryBetRepository implements IBetRepository {
  private bets: Map<string, Bet> = new Map();

  async save(bet: Bet): Promise<void> {
    this.bets.set(bet.id, bet);
  }

  async getById(betId: string): Promise<Bet | null> {
    return this.bets.get(betId) || null;
  }

  async getAll(): Promise<Bet[]> {
    return Array.from(this.bets.values());
  }

  async getActive(): Promise<Bet[]> {
    return Array.from(this.bets.values()).filter(
      bet => bet.status === 'ACTIVE' || bet.status === 'PENDING'
    );
  }

  async update(bet: Bet): Promise<void> {
    if (!this.bets.has(bet.id)) {
      throw new Error('Bet not found');
    }
    this.bets.set(bet.id, bet);
  }

  async count(): Promise<number> {
    return this.bets.size;
  }

  async getHistory(limit?: number, offset: number = 0): Promise<Bet[]> {
    const allBets = await this.getAll();
    const sorted = allBets.sort((a, b) =>
      b.placedAt.getTime() - a.placedAt.getTime()
    );

    if (limit === undefined) {
      return sorted.slice(offset);
    }

    return sorted.slice(offset, offset + limit);
  }

  async getWinRate(): Promise<number> {
    const allBets = await this.getAll();
    const resolved = allBets.filter(
      bet => bet.status === 'WON' || bet.status === 'LOST'
    );
    
    if (resolved.length === 0) return 0;
    
    const won = resolved.filter(bet => bet.status === 'WON').length;
    return (won / resolved.length) * 100;
  }
}
