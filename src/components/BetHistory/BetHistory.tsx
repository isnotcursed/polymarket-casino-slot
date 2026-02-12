/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { useEffect, useMemo, useState } from 'react';
import { getContainer } from '@/di/container.ts';
import type { Bet } from '@/core/domain/types.ts';
import './BetHistory.css';

interface BetHistoryProps {
  isDemo?: boolean;
}

const STATUS_LABELS: Record<Bet['status'], string> = {
  WON: 'Win',
  LOST: 'Loss',
  ACTIVE: 'Active',
  PENDING: 'Pending',
  RESOLVING: 'Resolving',
  CANCELLED: 'Cancelled',
};

const formatTime = (value: Date) =>
  value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatMoney = (value: number) => {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs)) return '0.00';
  if (abs < 1) return abs.toFixed(3);
  return abs.toFixed(2);
};

const formatPrice = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return `$${value.toFixed(2)}`;
};

const formatPriceInfo = (bet: Bet, mode: 'demo' | 'live') => {
  const hasEntry = typeof bet.entryPrice === 'number';
  const hasExit = typeof bet.exitPrice === 'number';
  if (!hasEntry || bet.entryPrice! <= 0) {
    return { main: '-', note: '' };
  }

  if (mode === 'live') {
    const entry = formatPrice(bet.entryPrice!);
    const exit = hasExit ? formatPrice(bet.exitPrice!) : '';
    return {
      main: hasExit ? `${entry} → ${exit}` : entry,
      note: 'USDC / share',
    };
  }

  const entry = formatPrice(bet.entryPrice!);
  const exit = hasExit ? formatPrice(bet.exitPrice!) : '';
  const note = bet.entryPrice! >= 2 ? 'BTC spot (fallback)' : 'Market odds';
  return {
    main: hasExit ? `${entry} → ${exit}` : entry,
    note,
  };
};

export function BetHistory({ isDemo = false }: BetHistoryProps) {
  const [history, setHistory] = useState<Bet[]>([]);
  const [recentBets, setRecentBets] = useState<Bet[]>([]);
  const [winRate, setWinRate] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [balanceHistory, setBalanceHistory] = useState<Array<{ delta: number; balance: number; at: Date; reason?: string }>>([]);
  const pageSize = 10;

  const container = getContainer();
  const betRepo = container.getBetRepository();
  const balanceRepo = container.getBalanceRepository();

  useEffect(() => {
    loadHistory(page);

    const interval = setInterval(() => loadHistory(page), 2000);
    return () => clearInterval(interval);
  }, [page]);

  const loadHistory = async (pageIndex: number) => {
    const offset = pageIndex * pageSize;
    const [allBets, rate, count, balanceLog, recent] = await Promise.all([
      betRepo.getHistory(pageSize, offset),
      betRepo.getWinRate(),
      betRepo.count(),
      balanceRepo.getHistory ? balanceRepo.getHistory() : Promise.resolve([]),
      betRepo.getHistory(50, 0),
    ]);

    const maxPage = Math.max(0, Math.ceil(count / pageSize) - 1);
    if (pageIndex > maxPage) {
      setPage(maxPage);
      return;
    }

    setHistory(allBets);
    setRecentBets(recent);
    setWinRate(rate);
    setTotal(count);
    setBalanceHistory(balanceLog.slice(-10).reverse());
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const onPrev = () => setPage((p) => Math.max(0, p - 1));
  const onNext = () => setPage((p) => Math.min(totalPages - 1, p + 1));

  const balanceRows = useMemo(
    () =>
      balanceHistory.map((h, idx) => ({
        ...h,
        key: `${h.at.getTime()}-${idx}`,
      })),
    [balanceHistory]
  );

  const liveRows = useMemo(() => {
    const entries = recentBets
      .filter((bet) => bet.mode === 'live' && typeof bet.payout === 'number')
      .slice(0, 10)
      .map((bet) => ({
        key: bet.id,
        delta: (bet.payout ?? 0) - bet.amount,
        payout: bet.payout ?? 0,
        at: bet.resolvedAt ?? bet.placedAt,
        label: bet.status === 'WON' ? 'win' : bet.status === 'LOST' ? 'loss' : bet.status.toLowerCase(),
        direction: bet.direction,
      }));

    return entries;
  }, [recentBets]);

  const balanceTitle = isDemo ? 'Balance' : 'Live PnL';
  const balanceSubtitle = isDemo ? 'Recent movements' : 'Local results (no API)';

  const sanitizeReason = (reason?: string) => {
    if (!reason) return '—';
    const lower = reason.toLowerCase();
    if (lower.startsWith('payout')) return 'payout';
    if (lower.startsWith('bet')) return 'bet';
    return reason;
  };

  return (
    <div className="bet-history">
      <div className="history-header">
        <div className="history-heading">
          <div className="history-title">Bet History</div>
          <div className="history-subtitle">Demo and live bets are tagged per entry.</div>
        </div>
        <div className="history-stats">
          <div className="history-stat">
            <span className="stat-label">Win Rate</span>
            <span className="stat-value">{winRate.toFixed(1)}%</span>
          </div>
          <div className="history-stat">
            <span className="stat-label">Total</span>
            <span className="stat-value">{total}</span>
          </div>
          <div className="history-stat">
            <span className="stat-label">Mode</span>
            <span className={`stat-pill ${isDemo ? 'demo' : 'live'}`}>{isDemo ? 'Demo' : 'Live'}</span>
          </div>
        </div>
      </div>

      <div className="history-grid">
        <section className="history-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Bets</div>
              <div className="panel-subtitle">Newest first</div>
            </div>
            <div className="panel-meta">
              Page {totalPages === 0 ? 1 : page + 1} / {totalPages}
            </div>
          </div>

          {history.length === 0 ? (
            <div className="history-empty">No bets yet. Hit spin to start the log.</div>
          ) : (
            <div className="bet-list">
              <div className="bet-list-header">
                <span>Direction</span>
                <span>Stake</span>
                <span>Status</span>
                <span>Return</span>
                <span>Price</span>
                <span>Mode</span>
              </div>
              <div className="bet-list-body">
                {history.map((bet) => {
                  const statusLabel = STATUS_LABELS[bet.status] ?? bet.status;
                  const payoutValue = bet.payout;
                  const payoutTone =
                    payoutValue === undefined
                      ? 'muted'
                      : payoutValue >= bet.amount
                        ? 'positive'
                        : 'negative';
                  const payoutText = payoutValue === undefined ? '-' : `$${payoutValue.toFixed(2)}`;
                  const mode = bet.mode ?? (isDemo ? 'demo' : 'live');
                  const priceInfo = formatPriceInfo(bet, mode);

                  return (
                    <div key={bet.id} className={`bet-row status-${bet.status.toLowerCase()}`}>
                      <div className="bet-cell bet-direction">
                        <span className={`dir-pill ${bet.direction === 'UP' ? 'up' : 'down'}`}>{bet.direction}</span>
                      </div>
                      <div className="bet-cell bet-amount">${bet.amount.toFixed(2)}</div>
                      <div className="bet-cell bet-status">
                        <span className={`status-pill status-${bet.status.toLowerCase()}`}>{statusLabel}</span>
                      </div>
                      <div className="bet-cell bet-payout">
                        <span className={`payout ${payoutTone}`}>{payoutText}</span>
                      </div>
                      <div className="bet-cell bet-price">
                        <span className="price-main">{priceInfo.main}</span>
                        <span className="price-sub">
                          {priceInfo.note ? `${priceInfo.note} · ${formatTime(bet.placedAt)}` : formatTime(bet.placedAt)}
                        </span>
                      </div>
                      <div className="bet-cell bet-mode">
                        <span className={`mode-pill ${mode}`}>{mode === 'live' ? 'Live' : 'Demo'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="history-pagination">
            <button onClick={onPrev} disabled={page === 0}>Prev</button>
            <span className="page-indicator">
              Page {totalPages === 0 ? 1 : page + 1} / {totalPages}
            </span>
            <button onClick={onNext} disabled={page >= totalPages - 1}>Next</button>
          </div>
        </section>

        <section className="history-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{balanceTitle}</div>
              <div className="panel-subtitle">{balanceSubtitle}</div>
            </div>
            <div className="panel-meta">Latest 10</div>
          </div>
          {isDemo ? (
            balanceRows.length === 0 ? (
              <div className="history-empty">No balance movements yet.</div>
            ) : (
              <div className="balance-list">
                {balanceRows.map((row) => (
                  <div key={row.key} className={`balance-row ${row.delta >= 0 ? 'balance-up' : 'balance-down'}`}>
                    <div className="balance-delta">
                      {row.delta >= 0 ? `+${formatMoney(row.delta)}` : `-${formatMoney(Math.abs(row.delta))}`}
                    </div>
                    <div className="balance-main">
                      <div className="balance-value">${formatMoney(row.balance)}</div>
                      <div className="balance-reason">{sanitizeReason(row.reason)}</div>
                    </div>
                    <div className="balance-time">{formatTime(row.at)}</div>
                  </div>
                ))}
              </div>
            )
          ) : liveRows.length === 0 ? (
            <div className="history-empty">No live results yet.</div>
          ) : (
            <div className="balance-list">
              {liveRows.map((row) => (
                <div key={row.key} className={`balance-row ${row.delta >= 0 ? 'balance-up' : 'balance-down'}`}>
                  <div className="balance-delta">
                    {row.delta >= 0 ? `+${formatMoney(row.delta)}` : `-${formatMoney(Math.abs(row.delta))}`}
                  </div>
                  <div className="balance-main">
                    <div className="balance-value">${formatMoney(row.payout)}</div>
                    <div className="balance-reason">{row.label} · {row.direction.toLowerCase()}</div>
                  </div>
                  <div className="balance-time">{formatTime(row.at)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
