/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { ChangeEvent } from 'react';
import { SlotConfig } from '@/config/slot.config.ts';
import type { GameState } from '@/core/services/GameOrchestrator.ts';
import type { UserSettings } from '@/core/domain/types.ts';
import './ControlPanel.css';

interface ControlPanelProps {
  betAmount: number;
  onBetChange: (amount: number) => void;
  onSpin: () => void;
  onCancel: () => void;
  canSpin: boolean;
  isWaiting: boolean;
  gameState: GameState;
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
}

const DIRECTION_OPTIONS: Array<{ mode: UserSettings['directionMode']; label: string }> = [
  { mode: 'random', label: 'Random' },
  { mode: 'up', label: 'Up' },
  { mode: 'down', label: 'Down' },
];
const BET_STEP = 0.5;

export function ControlPanel({
                               betAmount,
                               onBetChange,
                               onSpin,
                               onCancel,
                               canSpin,
                               isWaiting,
                               gameState,
                               settings,
                               onSettingsChange,
                             }: ControlPanelProps) {
  const minBet = settings.liveTradingEnabled ? SlotConfig.minLiveBetAmount : SlotConfig.minBetAmount;
  const effectiveMinBet = Math.max(minBet, BET_STEP);
  const maxBet = SlotConfig.maxBetAmount;

  const clampBet = (value: number) => Math.max(effectiveMinBet, Math.min(maxBet, value));
  const roundToStep = (value: number) => {
    const factor = 1 / BET_STEP;
    return Math.round(value * factor) / factor;
  };
  const normalizeBet = (value: number) => clampBet(roundToStep(clampBet(value)));

  const handleBetChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
      onBetChange(normalizeBet(value));
    }
  };

  const adjustBet = (multiplier: number) => {
    const newBet = betAmount * multiplier;
    onBetChange(normalizeBet(newBet));
  };

  const handleDurationChange = (value: number) => {
    if (Number.isNaN(value)) return;
    onSettingsChange({ holdTimeSeconds: value });
  };

  const adjustBetBy = (delta: number) => {
    const next = betAmount + delta;
    onBetChange(normalizeBet(next));
  };

  const displayBetAmount = Number(normalizeBet(betAmount).toFixed(2));

  return (
      <div className="control-panel">


        <div className={'main-container'}>
          <div className="bet-mini mini-panel">
            <div className="bet-mini-row">
              <button
                  className="bet-mini-btn square"
                  onClick={() => adjustBetBy(-BET_STEP)}
                  disabled={gameState !== 'idle'}
                  aria-label="Decrease bet"
              >
                -
              </button>
              <div className="bet-mini-input">
                <span className="bet-mini-currency">$</span>
                <input
                    type="number"
                    className="bet-mini-field"
                    value={displayBetAmount}
                    onChange={handleBetChange}
                    min={effectiveMinBet}
                    max={maxBet}
                    step={BET_STEP}
                    disabled={gameState !== 'idle'}
                />
              </div>
              <button
                  className="bet-mini-btn square"
                  onClick={() => adjustBetBy(BET_STEP)}
                  disabled={gameState !== 'idle'}
                  aria-label="Increase bet"
              >
                +
              </button>
            </div>
            <div className="bet-mini-actions">
              <button
                  className="bet-mini-btn"
                  onClick={() => adjustBet(0.5)}
                  disabled={gameState !== 'idle'}
              >
                ½
              </button>
              <button
                  className="bet-mini-btn"
                  onClick={() => adjustBet(2)}
                  disabled={gameState !== 'idle'}
              >
                2x
              </button>
            </div>
          </div>
          <div className="spin-settings mini-panel">
            <label className="spin-setting">
              <span className="spin-label">Bet Duration</span>
              <input
                  className="spin-input"
                  type="number"
                  min={SlotConfig.minHoldTimeSeconds}
                  max={SlotConfig.maxHoldTimeSeconds}
                  value={settings.holdTimeSeconds}
                  onChange={(e) => handleDurationChange(Number(e.target.value))}
                  disabled={gameState !== 'idle'}
              />
            </label>
            <label className="spin-setting">
              <span className="spin-label">Direction</span>
              <select
                  className="spin-select"
                  value={settings.directionMode}
                  onChange={(e) => onSettingsChange({ directionMode: e.target.value as UserSettings['directionMode'] })}
                  disabled={gameState !== 'idle'}
              >
                {DIRECTION_OPTIONS.map((option) => (
                    <option key={option.mode} value={option.mode}>
                      {option.label}
                    </option>
                ))}
              </select>
            </label>
          </div>
          {!isWaiting ? (
              <button
                  className="spin-button"
                  onClick={onSpin}
                  disabled={!canSpin}
              >
                <span className="spin-text">
                  {gameState === 'idle' ? 'SPIN' : gameState.replace('-', ' ').toUpperCase()}
                </span>
              </button>
          ) : (
              <button
                  className="cancel-button"
                  onClick={onCancel}
              >
                <span className="cancel-text">CANCEL BET</span>
              </button>
          )}


        </div>

      </div>
  );
}
