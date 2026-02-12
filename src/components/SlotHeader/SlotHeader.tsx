/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { UserSettings } from '@/core/domain/types.ts';
import { StatusMessage } from '@/components';
import './SlotHeader.css';

type StatusTone = 'info' | 'win' | 'loss';
type MarketOdds = { buyYes?: number; buyNo?: number; sellYes?: number; sellNo?: number };

interface SlotHeaderProps {
  statusMessage: string;
  statusTone?: StatusTone;
  currentPrice: number | null;
  marketId?: string;
  marketTimeRemainingSec?: number | null;
  marketReferencePrice?: number | null;
  marketOdds?: MarketOdds;
  balanceBlurred?: boolean;
  settings: UserSettings;
  apiBalance?: number | null;
  liveBlockReason?: string | null;
  balance: number;
}

export function SlotHeader({
  statusMessage,
  statusTone = 'info',
  currentPrice,
  marketId,
  marketTimeRemainingSec,
  marketReferencePrice,
  marketOdds,
  balanceBlurred = false,
  settings,
  apiBalance,
  liveBlockReason,
  balance,
}: SlotHeaderProps) {
  const hasApiKey = Boolean(settings.apiKey.trim());
  const hasFullApi = Boolean(
    settings.apiKey.trim() &&
      settings.apiSecret.trim() &&
      settings.apiPassphrase.trim() &&
      settings.apiAddress.trim()
  );
  const hasPrivateKey = Boolean(settings.walletPrivateKey?.trim());
  const wantsLive = Boolean(settings.liveTradingEnabled);
  const liveBlocked = Boolean(liveBlockReason);
  const liveReady = Boolean(wantsLive && hasFullApi && hasPrivateKey && !liveBlocked);
  const isDemo = !liveReady;
  const connectionLabel = liveBlocked
    ? 'Setup Required'
    : wantsLive && (!hasFullApi || !hasPrivateKey)
      ? 'Setup Required'
      : liveReady
        ? apiBalance === undefined
          ? 'Checking'
          : apiBalance === null
            ? 'Auth Error'
            : 'Live'
        : 'Demo';
  const connectionStatus = liveBlocked
    ? liveBlockReason
    : liveReady
      ? 'Polymarket Live Trading'
      : wantsLive
        ? 'Live mode not ready'
        : hasApiKey
          ? 'Polymarket API (view only)'
          : 'Mock Polymarket API';
  const balanceLabel = liveReady
    ? apiBalance === undefined
      ? '...'
      : apiBalance === null
        ? '--'
        : `$${apiBalance.toFixed(2)}`
    : `$${balance.toFixed(2)}`;
  const balanceCaption = liveReady ? 'API Balance' : 'Demo Balance';
  const priceLabel = currentPrice == null ? '--' : `$${currentPrice.toFixed(2)}`;
  const referenceLabel = marketReferencePrice && marketReferencePrice > 0
    ? `$${marketReferencePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';
  const normalizedMarketId = marketId
    ? marketId.startsWith('btc-updown-15m-')
      ? marketId
      : `btc-updown-15m-${marketId}`
    : '-';
  const formatCountdown = (totalSeconds: number) => {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };
  const countdownText = typeof marketTimeRemainingSec === 'number'
    ? ` [${formatCountdown(marketTimeRemainingSec)}]`
    : '';
  const buyUp = marketOdds?.buyYes;
  const buyDown = marketOdds?.buyNo;
  const sellUp = marketOdds?.sellYes;
  const sellDown = marketOdds?.sellNo;
  const formatOdds = (value?: number) => {
    if (value === undefined || Number.isNaN(value)) return '--';
    const clamped = Math.max(0, Math.min(1, value));
    const percent = clamped * 100;
    const rounded = Math.round(percent * 10) / 10;
    const formatted = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
    return `${formatted}%`;
  };

  return (
    <div className="slot-header">
      <div className="slot-header-grid">
        <div className="slot-header-market">
          <div className="market-row">
            <span className="market-label">BTCUSD:</span>
            <span className="market-value">{priceLabel}</span>
            <span className="market-target">[ref: {referenceLabel}]</span>
          </div>
          <div className="market-row market-id">
            <span className="market-label">Market:</span>
            <span className="market-text">{normalizedMarketId}{countdownText}</span>
          </div>
          <div className="market-row market-line">
            <span className="market-label">Buy:</span>
            <span className="market-text">Up ({formatOdds(buyUp)}) | Down ({formatOdds(buyDown)})</span>
          </div>
          <div className="market-row market-line">
            <span className="market-label">Sell:</span>
            <span className="market-text">Up ({formatOdds(sellUp)}) | Down ({formatOdds(sellDown)})</span>
          </div>
        </div>

        <div className="slot-header-status">
          <StatusMessage message={statusMessage} variant={statusTone} />
        </div>

        <div className={`connection-card ${isDemo ? 'demo' : 'live'}`}>
          <div className="connection-header">
            <span className="connection-chip">{connectionLabel}</span>
            <span className={`connection-dot ${isDemo ? 'demo' : 'live'}`} />
          </div>
          <div className="connection-status">{connectionStatus}</div>
          <div className="connection-balance">
            <span className="balance-label">{balanceCaption}</span>
            <span className={`balance-value ${balanceBlurred ? 'blurred' : ''}`}>{balanceLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
