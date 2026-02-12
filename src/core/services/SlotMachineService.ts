/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { BetResolution, SpinResult, WinningCluster } from '../domain/types';

const SYMBOLS = [
  'bear_yellow',
  'bear_purple',
  'bear_red',
  'candy_green',
  'candy_purple',
  'candy_red'
];

const SYMBOL_PAYOUTS: Record<string, Record<number, number>> = {
  bear_yellow: { 15: 40, 14: 24, 13: 10, 12: 5, 11: 3, 10: 2, 9: 1, 8: 0.8, 7: 0.6, 6: 0.5, 5: 0.4 },
  bear_purple: { 15: 50, 14: 24, 13: 12, 12: 6, 11: 4, 10: 2.5, 9: 1.5, 8: 1, 7: 0.8, 6: 0.6, 5: 0.5 },
  bear_red: { 15: 60, 14: 30, 13: 16, 12: 7, 11: 5, 10: 3, 9: 2, 8: 1.5, 7: 1, 6: 0.8, 5: 0.6 },
  candy_green: { 15: 80, 14: 40, 13: 20, 12: 11, 11: 6, 10: 4, 9: 2.5, 8: 2, 7: 1.5, 6: 1, 5: 0.8 },
  candy_purple: { 15: 120, 14: 80, 13: 40, 12: 20, 11: 9, 10: 6, 9: 3, 8: 2.5, 7: 2, 6: 1.5, 5: 1 },
  candy_red: { 15: 200, 14: 120, 13: 60, 12: 24, 11: 12, 10: 5, 9: 4, 8: 3, 7: 2.5, 6: 2, 5: 1.5 },
};

export class SlotMachineService {
  generateSpinResult(resolution: BetResolution): SpinResult {
    const { payout, bet } = resolution;
    const stake = bet.amount;
    const targetProfit = Math.max(0, payout - stake);

    if (targetProfit <= 0) {
      const symbols = this.generateLosingScreen();
      return {
        symbols,
        isWin: false,
        winAmount: 0,
        totalPayout: Math.max(0, payout),
        multiplier: Math.max(0, payout) / stake,
        bet,
        clusters: [],
      };
    }

    const plannedClusters = this.buildClustersForProfit(targetProfit, stake);
    let symbols = this.generateGridWithClusters(plannedClusters);
    let actualClusters = this.findConnectedClusters(symbols, stake);

    const firstPlanned = plannedClusters[0];
    if (actualClusters.length === 0 && firstPlanned) {
      symbols = this.generateGridWithClusters([firstPlanned]);
      actualClusters = this.findConnectedClusters(symbols, stake);
    }

    if (actualClusters.length === 0) {
      symbols = this.generateGridWithClusters([{
        symbol: this.getRandomSymbol(),
        count: 5,
        payout: 0,
        positions: [],
      }]);
      actualClusters = this.findConnectedClusters(symbols, stake);
    }
    const rawProfit = this.computeProfit(actualClusters);

    const scaledClusters =
      rawProfit > 0 && targetProfit > 0
        ? actualClusters.map(c => ({
            ...c,
            payout: c.payout * (targetProfit / rawProfit),
          }))
        : actualClusters;

    const finalProfit = targetProfit;
    const totalPayout = payout;

    return {
      symbols,
      isWin: finalProfit > 0,
      winAmount: finalProfit,
      totalPayout,
      multiplier: totalPayout / stake,
      bet,
      clusters: scaledClusters,
    };
  }

  private generateGridWithClusters(clusters: WinningCluster[]): string[][] {
    const grid: string[][] = [];

    for (let col = 0; col < 7; col++) {
      const reel: string[] = [];
      for (let row = 0; row < 7; row++) {
        reel.push(this.getRandomSymbol());
      }
      grid.push(reel);
    }

    clusters.forEach((cluster) => {
      this.placeCluster(grid, cluster.symbol, cluster.count);
    });

    return grid;
  }

  private generateLosingScreen(): string[][] {
    const grid: string[][] = [];

    for (let col = 0; col < 7; col++) {
      const reel: string[] = [];
      for (let row = 0; row < 7; row++) {
        reel.push(this.getRandomSymbol());
      }
      grid.push(reel);
    }

    this.breakWinningClusters(grid);

    return grid;
  }

  private placeCluster(grid: string[][], symbol: string, count: number): Array<[number, number]> {
    const positions: Array<[number, number]> = [];

    let startCol = 3;
    let startRow = 3;

    positions.push([startCol, startRow]);
    const startColumn = grid[startCol];
    if (!startColumn) {
      return positions;
    }
    startColumn[startRow] = symbol;

    let placed = 1;
    const directions: Array<readonly [number, number]> = [
      [-1, 0], [1, 0], [0, -1], [0, 1]
    ];

    while (placed < count) {
      const base = positions[Math.floor(Math.random() * positions.length)];
      if (!base) break;
      const [baseCol, baseRow] = base;

      const shuffledDirs = directions.sort(() => Math.random() - 0.5);

      for (const [dc, dr] of shuffledDirs) {
        const newCol = baseCol + dc;
        const newRow = baseRow + dr;
        const column = grid[newCol];

        if (
            newCol >= 0 && newCol < 7 &&
            newRow >= 0 && newRow < 7 &&
            column &&
            column[newRow] !== symbol
        ) {
          column[newRow] = symbol;
          positions.push([newCol, newRow]);
          placed++;
          break;
        }
      }

      if (placed === positions.length && placed < count) {
        for (let col = 0; col < 7; col++) {
          const column = grid[col];
          if (!column) continue;
          for (let row = 0; row < 7; row++) {
            if (column[row] !== symbol) {
              column[row] = symbol;
              positions.push([col, row]);
              placed++;
              if (placed >= count) break;
            }
          }
          if (placed >= count) break;
        }
      }
    }
    return positions;
  }

  private breakWinningClusters(grid: string[][]): void {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const clusters = this.findConnectedClusters(grid, 1);
      const bigClusters = clusters.filter(c => c.count >= 5);
      if (bigClusters.length === 0) return;

      for (const cluster of bigClusters) {
        let toRemove = cluster.count - 4;
        for (const pos of cluster.positions) {
          if (toRemove <= 0) break;
          const column = grid[pos.col];
          if (!column) continue;
          column[pos.row] = this.getDifferentSymbol(cluster.symbol);
          toRemove--;
        }
      }
    }
  }

  private getRandomSymbol(): string {
    return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)] ?? 'candy_red';
  }

  private getDifferentSymbol(exclude: string): string {
    const available = SYMBOLS.filter(s => s !== exclude);
    return available[Math.floor(Math.random() * available.length)] ?? exclude;
  }

  private getPayoutMultiplier(symbol: string, count: number): number {
    const payouts = SYMBOL_PAYOUTS[symbol] ?? {};
    const sortedCounts = Object.keys(payouts)
        .map(n => parseInt(n))
        .sort((a, b) => a - b);

    let best = sortedCounts[0] ?? 0;
    for (const threshold of sortedCounts) {
      if (count >= threshold) best = threshold;
    }

    return payouts[best] ?? 0;
  }

  private buildClustersForProfit(targetProfit: number, stake: number): WinningCluster[] {
    const entries: Array<{ symbol: string; count: number; multiplier: number; profit: number }> = [];

    for (const symbol of SYMBOLS) {
      const payouts = SYMBOL_PAYOUTS[symbol] ?? {};
      for (const [countStr, mul] of Object.entries(payouts)) {
        const count = parseInt(countStr);
        const profit = mul * stake;
        entries.push({ symbol, count, multiplier: mul, profit });
      }
    }

    entries.sort((a, b) => b.profit - a.profit);

    const clusters: WinningCluster[] = [];
    let remaining = targetProfit;
    const maxClusters = 3;

    while (remaining > 0 && clusters.length < maxClusters) {
      const firstEntry = entries[0];
      if (!firstEntry) break;
      let best = firstEntry;
      let bestDiff = Math.abs(firstEntry.profit - remaining);
      for (const entry of entries) {
        const diff = Math.abs(entry.profit - remaining);
        if (diff < bestDiff) {
          best = entry;
          bestDiff = diff;
        }
      }

      clusters.push({
        symbol: best.symbol,
        count: best.count,
        payout: best.profit,
        positions: [],
      });

      remaining -= best.profit;

      if (remaining < stake * 0.2) {
        break;
      }
    }

    return clusters.sort((a, b) => a.payout - b.payout || a.count - b.count);
  }

  private findConnectedClusters(grid: string[][], stake: number): WinningCluster[] {
    const visited: boolean[][] = Array.from({ length: 7 }, () => Array(7).fill(false));
    const clusters: WinningCluster[] = [];
    const directions: Array<readonly [number, number]> = [
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ];

    for (let col = 0; col < 7; col++) {
      const column = grid[col];
      const visitedColumn = visited[col];
      if (!column || !visitedColumn) continue;
      for (let row = 0; row < 7; row++) {
        if (visitedColumn[row]) continue;
        const symbol = column[row];
        if (!symbol) continue;
        const queue: Array<[number, number]> = [[col, row]];
        const positions: Array<{ col: number; row: number }> = [];
        visitedColumn[row] = true;

        while (queue.length > 0) {
          const [c, r] = queue.shift()!;
          positions.push({ col: c, row: r });

          for (const [dc, dr] of directions) {
            const nc = c + dc;
            const nr = r + dr;
            if (nc < 0 || nc >= 7 || nr < 0 || nr >= 7) continue;
            const nextVisited = visited[nc];
            const nextColumn = grid[nc];
            if (!nextVisited || !nextColumn) continue;
            if (nextVisited[nr]) continue;
            if (nextColumn[nr] !== symbol) continue;
            nextVisited[nr] = true;
            queue.push([nc, nr]);
          }
        }

        if (positions.length >= 5) {
          const multiplier = this.getPayoutMultiplier(symbol, positions.length);
          clusters.push({
            symbol,
            positions,
            count: positions.length,
            payout: multiplier * stake,
          });
        }
      }
    }

    return clusters.sort((a, b) => a.payout - b.payout || a.count - b.count);
  }

  private computeProfit(clusters: WinningCluster[]): number {
    return clusters.reduce((sum, c) => sum + c.payout, 0);
  }
}
