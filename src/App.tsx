/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { getContainer } from './di/container';
import type { SpinResult, UserSettings } from './core/domain/types';
import type { GameStateUpdate } from './core/services/GameOrchestrator';
import { SlotConfig } from './config/slot.config';
import {
  loadPolymarketSettingsFromStorage,
  persistPolymarketSettings,
  setPolymarketSettings,
} from './utils/polymarketSettings';
import './App.css';
import {ControlPanel, SlotMachine, BetHistory, SlotHeader, ApiSettingsModal, CandyDrops} from "@/components";

import BackgroundIMG from "./public/background.jpg"
import SettingsIcon from "./public/settings.png"
import MusicTrack from "./public/music.mp4"

const deriveEndsAtMsFromSlug = (slug: string | undefined, nowMs: number): number | null => {
  if (!slug) return null;
  const match = slug.match(/(\d{10,})$/);
  const raw = match?.[1];
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const baseMs = raw.length >= 13 ? parsed : parsed * 1000;
  if (!Number.isFinite(baseMs)) return null;
  const endMs = baseMs <= nowMs ? baseMs + 15 * 60 * 1000 : baseMs;
  return Number.isFinite(endMs) ? endMs : null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const DISCLAIMER_COOKIE = 'pm_slot_disclaimer';

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  const value = match?.[1];
  return value ? decodeURIComponent(value) : null;
};

const writeCookie = (name: string, value: string, maxAgeSeconds: number) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
};

function App() {
  const [balance, setBalance] = useState<number>(1000);
  const [betAmount, setBetAmount] = useState<number>(1);
  const [gameState, setGameState] = useState<GameStateUpdate>({
    state: 'idle',
  });
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [lastWinAmount, setLastWinAmount] = useState<number>(0);
  const [isOutcomePending, setIsOutcomePending] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({
    apiKey: '',
    apiSecret: '',
    apiPassphrase: '',
    apiAddress: '',
    signatureType: 0,
    liveTradingEnabled: false,
    walletPrivateKey: '',
    holdTimeSeconds: SlotConfig.betHoldTimeSeconds,
    directionMode: 'random',
  });
  const [masterVolume, setMasterVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.02;
    const stored = window.localStorage.getItem('masterVolume');
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 0.02;
  });
  const [marketInfo, setMarketInfo] = useState<{
    id: string;
    displayId?: string;
    endsAt?: Date;
    buyYesOdds?: number;
    buyNoOdds?: number;
    sellYesOdds?: number;
    sellNoOdds?: number;
    referencePrice?: number;
  } | null>(null);
  const [apiBalance, setApiBalance] = useState<number | null | undefined>(undefined);
  const latestResultRef = useRef<SpinResult | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const safeSettings: UserSettings = useMemo(
    () => ({
      ...settings,
      apiKey: typeof settings.apiKey === 'string' ? settings.apiKey : '',
      apiSecret: typeof settings.apiSecret === 'string' ? settings.apiSecret : '',
      apiPassphrase: typeof settings.apiPassphrase === 'string' ? settings.apiPassphrase : '',
      apiAddress: typeof settings.apiAddress === 'string' ? settings.apiAddress : '',
      signatureType: settings.signatureType === 1 || settings.signatureType === 2 ? settings.signatureType : 0,
      liveTradingEnabled: Boolean(settings.liveTradingEnabled),
      walletPrivateKey: typeof settings.walletPrivateKey === 'string' ? settings.walletPrivateKey : '',
    }),
    [settings]
  );

  const container = getContainer();
  const orchestrator = container.getGameOrchestrator();
  const balanceRepo = container.getBalanceRepository();
  const marketRepo = container.getMarketRepository();

  const loadBalance = useCallback(async () => {
    const currentBalance = await balanceRepo.getBalance();
    setBalance(currentBalance);
  }, [balanceRepo]);

  const handleSetDemoBalance = useCallback(async (value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    const current = await balanceRepo.getBalance();
    if (value > current) {
      await balanceRepo.add(value - current);
    } else if (value < current) {
      await balanceRepo.deduct(current - value);
    }
    await loadBalance();
  }, [balanceRepo, loadBalance]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const seen = readCookie(DISCLAIMER_COOKIE);
    if (!seen) {
      setShowDisclaimer(true);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const preventImgDrag = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === 'IMG') {
        event.preventDefault();
      }
    };
    document.addEventListener('dragstart', preventImgDrag);
    return () => {
      document.removeEventListener('dragstart', preventImgDrag);
    };
  }, []);

  useEffect(() => {
    const audio = musicRef.current;
    if (audio) {
      audio.volume = clamp(masterVolume, 0, 1);
      if (masterVolume === 0 && !audio.paused) {
        audio.pause();
      }
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('masterVolume', String(masterVolume));
    }
  }, [masterVolume]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tryPlay = () => {
      const audio = musicRef.current;
      if (!audio || masterVolume === 0) return;
      audio.volume = clamp(masterVolume, 0, 1);
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    };

    const handleInteract = () => {
      tryPlay();
    };

    window.addEventListener('pointerdown', handleInteract, { once: true });
    window.addEventListener('keydown', handleInteract, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleInteract);
      window.removeEventListener('keydown', handleInteract);
    };
  }, [masterVolume]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let isActive = true;
    const loadSettings = async () => {
      try {
        const stored = await loadPolymarketSettingsFromStorage();
        if (isActive) {
          setSettings((prev) => ({
            ...prev,
            ...stored,
          }));
        }
      } finally {
        if (isActive) {
          setSettingsLoaded(true);
        }
      }
    };
    loadSettings();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    setPolymarketSettings({
      apiKey: safeSettings.apiKey,
      apiSecret: safeSettings.apiSecret,
      apiPassphrase: safeSettings.apiPassphrase,
      apiAddress: safeSettings.apiAddress,
      signatureType: safeSettings.signatureType,
      liveTradingEnabled: safeSettings.liveTradingEnabled,
    });
    void persistPolymarketSettings({
      apiKey: safeSettings.apiKey,
      apiSecret: safeSettings.apiSecret,
      apiPassphrase: safeSettings.apiPassphrase,
      apiAddress: safeSettings.apiAddress,
      signatureType: safeSettings.signatureType,
      liveTradingEnabled: safeSettings.liveTradingEnabled,
    });
    marketRepo.updateAuth?.({
      apiKey: safeSettings.apiKey,
      apiSecret: safeSettings.apiSecret,
      apiPassphrase: safeSettings.apiPassphrase,
      apiAddress: safeSettings.apiAddress,
      signatureType: safeSettings.signatureType,
      liveTradingEnabled: safeSettings.liveTradingEnabled,
      walletPrivateKey: safeSettings.walletPrivateKey,
    });
  }, [
    safeSettings.apiKey,
    safeSettings.apiSecret,
    safeSettings.apiPassphrase,
    safeSettings.apiAddress,
    safeSettings.signatureType,
    safeSettings.liveTradingEnabled,
    safeSettings.walletPrivateKey,
    marketRepo,
    settingsLoaded,
  ]);

  useEffect(() => {
    let isActive = true;

    if (marketRepo.onMarketUpdate) {
      const unsubscribe = marketRepo.onMarketUpdate((info) => {
        if (!isActive) return;
        setMarketInfo({
          id: info.id,
          displayId: info.displayId,
          endsAt: info.endsAt,
          buyYesOdds: info.buyYesOdds,
          buyNoOdds: info.buyNoOdds,
          sellYesOdds: info.sellYesOdds,
          sellNoOdds: info.sellNoOdds,
          referencePrice: info.referencePrice,
        });
      });
      return () => {
        isActive = false;
        unsubscribe();
      };
    }

    const loadMarket = async () => {
      if (!marketRepo.getCurrentMarket) return;
      try {
        const info = await marketRepo.getCurrentMarket();
        if (isActive) {
        setMarketInfo({
          id: info.id,
          displayId: info.displayId,
          endsAt: info.endsAt,
          buyYesOdds: info.buyYesOdds,
          buyNoOdds: info.buyNoOdds,
          sellYesOdds: info.sellYesOdds,
          sellNoOdds: info.sellNoOdds,
          referencePrice: info.referencePrice,
        });
        }
      } catch {
        if (isActive) {
          setMarketInfo(null);
        }
      }
    };

    loadMarket();
    const interval = setInterval(loadMarket, 15000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [marketRepo]);

  useEffect(() => {
    if (!marketRepo.onPriceUpdate) return;
    const unsubscribe = marketRepo.onPriceUpdate((update) => {
      if (typeof update.currentPrice !== 'number') return;
      setCurrentPrice(update.currentPrice);
    });
    return () => unsubscribe();
  }, [marketRepo]);

  useEffect(() => {
    let isActive = true;
    const hasCreds = Boolean(
      safeSettings.apiKey.trim() &&
      safeSettings.apiSecret.trim() &&
      safeSettings.apiPassphrase.trim() &&
      safeSettings.apiAddress.trim()
    );

    if (marketRepo.onBalanceUpdate) {
      setApiBalance(hasCreds ? undefined : null);
      const unsubscribe = marketRepo.onBalanceUpdate((balance) => {
        if (isActive) {
          setApiBalance(balance);
        }
      });
      return () => {
        isActive = false;
        unsubscribe();
      };
    }

    const loadApiBalance = async () => {
      if (!marketRepo.getAccountBalance || !hasCreds) {
        if (isActive) setApiBalance(null);
        return;
      }
      try {
        if (isActive) setApiBalance(undefined);
        const value = await marketRepo.getAccountBalance();
        if (isActive) {
          setApiBalance(value);
        }
      } catch {
        if (isActive) {
          setApiBalance(null);
        }
      }
    };

    loadApiBalance();
    const interval = setInterval(loadApiBalance, 20000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [
    marketRepo,
    safeSettings.apiKey,
    safeSettings.apiSecret,
    safeSettings.apiPassphrase,
    safeSettings.apiAddress,
  ]);

  const hasFullApi = Boolean(
    safeSettings.apiKey.trim() &&
    safeSettings.apiSecret.trim() &&
    safeSettings.apiPassphrase.trim() &&
    safeSettings.apiAddress.trim()
  );
  const liveBlockReason = marketRepo.getLiveTradingBlockReason?.() ?? null;
  const wantsLiveTrading = Boolean(safeSettings.liveTradingEnabled);
  const hasPrivateKey = Boolean(safeSettings.walletPrivateKey.trim());
  const liveTradingReady = Boolean(wantsLiveTrading && hasFullApi && hasPrivateKey && !liveBlockReason);
  const minLiveBetAmount = SlotConfig.minLiveBetAmount;
  const marketEndsAtMs = marketInfo?.endsAt?.getTime() ?? null;
  const derivedEndsAtMs =
    marketEndsAtMs ??
    deriveEndsAtMsFromSlug(marketInfo?.displayId ?? marketInfo?.id, nowTick);
  const marketTimeRemainingSec = derivedEndsAtMs !== null
    ? Math.max(0, Math.floor((derivedEndsAtMs - nowTick) / 1000))
    : null;
  const marketWindowOk = !liveTradingReady
    ? true
    : derivedEndsAtMs !== null && derivedEndsAtMs - nowTick > 15000;
  const apiBalanceReady = liveTradingReady && typeof apiBalance === 'number';
  const canSpin = gameState.state === 'idle' &&
    marketWindowOk &&
    (liveTradingReady
      ? apiBalanceReady && apiBalance >= betAmount && betAmount >= minLiveBetAmount
      : !wantsLiveTrading && balance >= betAmount);

  const isSpinning = gameState.state === 'placing-bet' ||
      gameState.state === 'spinning' ||
      gameState.state === 'waiting' ||
      gameState.state === 'resolving';
  const statusTone = /^WIN\b/.test(statusMessage)
    ? 'win'
    : /^LOSE\b/.test(statusMessage)
      ? 'loss'
      : 'info';
  const isFinalOutcomeMessage = statusTone !== 'info';
  const balanceBlurred = isOutcomePending && !isFinalOutcomeMessage;

  useEffect(() => {
    orchestrator.onStateChange((update) => {
      setGameState(update);
    });
  }, [orchestrator]);

  const handleSpin = useCallback(async () => {
    if (!canSpin) {
      if (gameState.state !== 'idle') {
        return;
      }
      if (wantsLiveTrading && !liveTradingReady) {
        if (liveBlockReason) {
          setStatusMessage(liveBlockReason);
          return;
        }
        if (!hasFullApi) {
          setStatusMessage('Live mode needs API key, secret, passphrase, address.');
          return;
        }
        if (!hasPrivateKey) {
          setStatusMessage('Live mode needs a private key.');
          return;
        }
      }
      if (wantsLiveTrading && betAmount < minLiveBetAmount) {
        setStatusMessage(`Live bets minimum $${minLiveBetAmount.toFixed(2)}`);
        return;
      }
      if (liveTradingReady && !marketWindowOk) {
        if (derivedEndsAtMs === null) {
          setStatusMessage('Waiting for market window...');
        } else {
          setStatusMessage('Market closing. Waiting for next 15m window...');
        }
        return;
      }
      if (liveTradingReady && !apiBalanceReady) {
        setStatusMessage('Checking API balance...');
        return;
      }
      if (liveTradingReady && apiBalanceReady && apiBalance < betAmount) {
        setStatusMessage('Insufficient API balance or allowance');
        return;
      }
      if (!wantsLiveTrading && balance < betAmount) {
        setStatusMessage('Insufficient balance');
      }
      return;
    }

    try {
      setLastResult(null);
      latestResultRef.current = null;
      setLastWinAmount(0);
      setIsOutcomePending(true);
      setStatusMessage('Good Luck!');

      await orchestrator.spin(betAmount, safeSettings, (result) => {
        latestResultRef.current = result;
        setLastResult(result);
        setLastWinAmount(result.winAmount);
      });
    } catch (error) {
      console.error('Spin error:', error);
      const message = error instanceof Error ? error.message : 'Failed to spin';
      setStatusMessage(message);
      setIsOutcomePending(false);
      alert(message);
    }
  }, [
    apiBalance,
    apiBalanceReady,
    balance,
    betAmount,
    canSpin,
    derivedEndsAtMs,
    gameState.state,
    hasFullApi,
    hasPrivateKey,
    liveBlockReason,
    liveTradingReady,
    loadBalance,
    marketWindowOk,
    orchestrator,
    safeSettings,
    wantsLiveTrading,
  ]);

  useEffect(() => {
    const handleSpaceSpin = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;

      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName)) {
        return;
      }

      event.preventDefault();
      handleSpin();
    };

    window.addEventListener('keydown', handleSpaceSpin);
    return () => window.removeEventListener('keydown', handleSpaceSpin);
  }, [handleSpin]);

  const handleCancel = async () => {
    try {
      await orchestrator.cancel((result) => {
        latestResultRef.current = result;
        setLastResult(result);
        setLastWinAmount(result.winAmount);
      });
    } catch (error) {
      console.error('Cancel error:', error);
    }
  };

  const formatPayout = (value: number) => {
    const abs = Math.abs(value);
    if (!Number.isFinite(abs)) return '0.00';
    if (abs < 1) return abs.toFixed(3);
    return abs.toFixed(2);
  };

  const handleSpinSettled = useCallback(() => {
    if (latestResultRef.current) {
      const result = latestResultRef.current;
      if (result.isWin && result.winAmount > 0) {
        setStatusMessage(`WIN $${formatPayout(result.winAmount)}`);
      } else {
        const loss = Math.max(0, result.bet.amount - result.totalPayout);
        setStatusMessage(`LOSE -$${formatPayout(loss)}`);
      }
      loadBalance();
      setIsOutcomePending(false);
    }
  }, []);

  const handleSettingsChange = (patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const holdTime = patch.holdTimeSeconds ?? prev.holdTimeSeconds;
      const clampedHold = Math.min(
          SlotConfig.maxHoldTimeSeconds,
          Math.max(SlotConfig.minHoldTimeSeconds, holdTime)
      );

      return {
        ...prev,
        ...patch,
        holdTimeSeconds: clampedHold,
      };
    });
  };

  const handleVolumeChange = (nextValue: number) => {
    const clamped = clamp(nextValue, 0, 1);
    setMasterVolume(clamped);
    const audio = musicRef.current;
    if (audio) {
      audio.volume = clamped;
      if (clamped === 0) {
        audio.pause();
      } else if (audio.paused) {
        audio.play().catch(() => {});
      }
    }
  };

  const volumePercent = Math.round(masterVolume * 100);
  const volumeStyle = { '--volume-percent': `${volumePercent}%` } as CSSProperties;

  const handleDismissDisclaimer = () => {
    writeCookie(DISCLAIMER_COOKIE, '1', 60 * 60 * 24 * 365);
    setShowDisclaimer(false);
  };

  return (
      <div className="app">
        <audio ref={musicRef} src={MusicTrack} preload="auto" loop playsInline />
        <div className="candy-bg"><img src={BackgroundIMG} alt={"background"} draggable={false} /></div>
        <CandyDrops />

        <main className="game-container">
          <div className="slot-wrapper">
            <SlotHeader
                statusMessage={statusMessage}
                statusTone={statusTone}
                currentPrice={currentPrice}
                marketId={marketInfo?.displayId ?? marketInfo?.id}
                marketTimeRemainingSec={marketTimeRemainingSec}
                marketReferencePrice={marketInfo?.referencePrice}
                marketOdds={{
                  buyYes: marketInfo?.buyYesOdds,
                  buyNo: marketInfo?.buyNoOdds,
                  sellYes: marketInfo?.sellYesOdds,
                  sellNo: marketInfo?.sellNoOdds,
                }}
                balanceBlurred={balanceBlurred}
                settings={safeSettings}
                apiBalance={apiBalance}
                liveBlockReason={liveBlockReason}
                balance={balance}
            />
            <SlotMachine
                isSpinning={isSpinning}
                result={lastResult}
                onSettled={handleSpinSettled}
            />
            <ControlPanel
                betAmount={betAmount}
                onBetChange={setBetAmount}
                onSpin={handleSpin}
                onCancel={handleCancel}
                canSpin={canSpin}
                isWaiting={gameState.state === 'waiting'}
                gameState={gameState.state}
                settings={safeSettings}
                onSettingsChange={handleSettingsChange}
            />

            <BetHistory isDemo={!liveTradingReady} />
          </div>
        </main>

        <button
            className={`settings-fab ${isSettingsMenuOpen ? 'active' : ''}`}
            type="button"
            onClick={() => setIsSettingsMenuOpen((prev) => !prev)}
            aria-label="Open settings menu"
        >
          <img src={SettingsIcon} alt="" draggable={false} />
        </button>

        <AnimatePresence>
          {showDisclaimer ? (
              <motion.div
                  className="settings-modal disclaimer-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
              >
                <motion.div
                    className="settings-modal-content disclaimer-content"
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                >
                  <div className="settings-modal-header">
                    <div>
                      <div className="settings-title">Disclaimer</div>
                      <div className="settings-subtitle">Please read once</div>
                    </div>
                  </div>

                  <div className="settings-card danger disclaimer-card">
                    <div className="settings-card-header">
                      <div className="settings-card-title">This is a joke project</div>
                      <div className="settings-card-subtitle">
                        You can freely play Demo mode with virtual money (grant it in Settings at the bottom-right),
                        but I strongly recommend against Real Play.
                      </div>
                    </div>
                    <div className="settings-warning">
                      Trusting random GitHub users with keys or funds is unsafe. If you still choose to experiment, use a fresh wallet and funds you can lose.
                    </div>
                  </div>

                  <div className="settings-modal-actions">
                    <button className="settings-action" type="button" onClick={handleDismissDisclaimer}>
                      I Understand
                    </button>
                  </div>
                </motion.div>
              </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {isSettingsMenuOpen ? (
              <motion.div
                  className="settings-modal"
                  onClick={() => setIsSettingsMenuOpen(false)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
              >
                <motion.div
                    className="settings-modal-content quick-settings"
                    onClick={(event) => event.stopPropagation()}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                >
                  <div className="settings-modal-header">
                    <div>
                      <div className="settings-title">Settings</div>
                      <div className="settings-subtitle">Quick access</div>
                    </div>
                    <button className="settings-close" type="button" onClick={() => setIsSettingsMenuOpen(false)}>
                      ✕
                    </button>
                  </div>

                <div className="settings-divider">— SET DEMO BALANCE —</div>

                <div className="settings-field">
                  <div className="settings-helper-actions">
                    {[100, 1000, 5000, 10000].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="settings-action secondary settings-action-fill"
                        onClick={() => handleSetDemoBalance(value)}
                        disabled={wantsLiveTrading}
                      >
                        ${value >= 1000 ? `${value / 1000}K` : value}
                      </button>
                    ))}
                  </div>
                  <small>{wantsLiveTrading ? 'Switch to Demo mode to edit balance.' : 'Applies instantly for demo spins.'}</small>
                </div>

                <div className="settings-divider">— SOUND —</div>

                <div className="settings-field">
                  <span>MASTER VOLUME</span>
                  <div className="settings-volume-row">
                    <input
                      className="settings-range"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={volumePercent}
                      onChange={(event) => handleVolumeChange(Number(event.target.value) / 100)}
                      aria-label="Master volume"
                      style={volumeStyle}
                    />
                    <div className="settings-volume-value">{volumePercent}%</div>
                  </div>
                </div>

                <div className="settings-divider">— LIVE TRADING —</div>

                <div className="settings-field">
                  <span>MODE</span>
                  <div className="direction-toggle">
                    <button
                      className={`direction-chip ${settings.liveTradingEnabled ? 'active' : ''}`}
                      onClick={() => handleSettingsChange({ liveTradingEnabled: true })}
                    >
                      Live
                    </button>
                    <button
                      className={`direction-chip ${!settings.liveTradingEnabled ? 'active' : ''}`}
                      onClick={() => handleSettingsChange({ liveTradingEnabled: false })}
                    >
                      Demo
                    </button>
                  </div>
                  <small>
                    {wantsLiveTrading
                      ? liveTradingReady
                        ? 'Live trading is ready.'
                        : liveBlockReason
                          ? liveBlockReason
                          : !hasFullApi
                            ? 'Add API key, secret, passphrase, and address.'
                            : !hasPrivateKey
                              ? 'Private key required for live mode.'
                              : 'Final checks pending...'
                      : 'Demo mode uses local balance only.'}
                  </small>
                </div>

                <div className="settings-divider">— DANGER ZONE —</div>

                <div className="settings-field">
                  <button
                      type="button"
                      className="settings-action"
                      onClick={() => {
                        setIsSettingsMenuOpen(false);
                        setIsApiModalOpen(true);
                      }}
                  >
                    Connect Polymarket
                  </button>
                  <div className="settings-warning">
                    Yes, I am an unhinged human who trusts random GitHub users.
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ApiSettingsModal
            open={isApiModalOpen}
            onClose={() => setIsApiModalOpen(false)}
            settings={settings}
            onChange={handleSettingsChange}
        />

        <footer className="app-footer">
          <p className="footer-meme">🎰 This is a MEME. Trade responsibly! 📈📉</p>
        </footer>
      </div>
  );
}

export default App;
