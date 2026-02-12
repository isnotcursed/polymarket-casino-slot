/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { IBalanceRepository } from '@/core/repositories/interfaces.ts';

const STORAGE_KEY = 'polymarket_slot_balance';
const DEFAULT_BALANCE = 1000;
const HISTORY_KEY = 'polymarket_slot_balance_history';

export class LocalStorageBalanceRepository implements IBalanceRepository {
  async getBalance(): Promise<number> {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      await this.setBalance(DEFAULT_BALANCE, 'init');
      return DEFAULT_BALANCE;
    }
    return parseFloat(stored);
  }

  async deduct(amount: number): Promise<void> {
    const current = await this.getBalance();
    if (current < amount) {
      throw new Error('Insufficient balance');
    }
    await this.setBalance(current - amount, 'bet');
  }

  async add(amount: number): Promise<void> {
    const current = await this.getBalance();
    await this.setBalance(current + amount, 'payout');
  }

  async hasSufficientBalance(amount: number): Promise<boolean> {
    const balance = await this.getBalance();
    return balance >= amount;
  }

  private async setBalance(balance: number, reason?: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY, balance.toString());
    this.appendHistory(balance, reason);
  }

  async getHistory(): Promise<Array<{ delta: number; balance: number; at: Date; reason?: string }>> {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Array<{ delta: number; balance: number; at: string; reason?: string }>;
      return parsed.map(h => ({
        delta: h.delta,
        balance: h.balance,
        at: new Date(h.at),
        reason: h.reason,
      }));
    } catch {
      return [];
    }
  }

  private appendHistory(balance: number, reason?: string): void {
    const raw = localStorage.getItem(HISTORY_KEY);
    let history: Array<{ delta: number; balance: number; at: string; reason?: string }> = [];
    if (raw) {
      try {
        history = JSON.parse(raw);
      } catch {
        history = [];
      }
    }

    const prevEntry = history.length > 0 ? history[history.length - 1] : undefined;
    const prevBalance = prevEntry?.balance ?? DEFAULT_BALANCE;
    const delta = balance - prevBalance;

    history.push({
      delta,
      balance,
      at: new Date().toISOString(),
      reason,
    });

    if (history.length > 200) {
      history = history.slice(history.length - 200);
    }

    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }
}
