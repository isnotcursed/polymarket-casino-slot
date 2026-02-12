/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import type { UserSettings } from '@/core/domain/types.ts';
import { SlotConfig } from '@/config/slot.config.ts';
import './Settings.css';

interface SettingsProps {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
}

const DIRECTION_OPTIONS: Array<{ mode: UserSettings['directionMode']; label: string }> = [
  { mode: 'random', label: 'Random' },
  { mode: 'up', label: 'Only Up' },
  { mode: 'down', label: 'Only Down' },
];

export function Settings({ settings, onChange }: SettingsProps) {
  const handleDurationChange = (value: number) => {
    if (Number.isNaN(value)) return;
    onChange({ holdTimeSeconds: value });
  };

  return (
      <div className="settings-card">
        <div className="settings-header">
          <div>
            <div className="settings-title">Settings</div>
            <div className="settings-subtitle">Polymarket tuning</div>
          </div>
          <span className="settings-pill">GAME</span>
        </div>

        <label className="settings-field">
          <span>BET DURATION (SEC)</span>
          <input
              type="number"
              min={SlotConfig.minHoldTimeSeconds}
              max={SlotConfig.maxHoldTimeSeconds}
              value={settings.holdTimeSeconds}
              onChange={(e) => handleDurationChange(Number(e.target.value))}
          />
          <small>
            {SlotConfig.minHoldTimeSeconds}s - {Math.floor(SlotConfig.maxHoldTimeSeconds / 60)}m window
          </small>
        </label>

        <div className="settings-field">
          <span>DIRECTION</span>
          <div className="direction-toggle">
            {DIRECTION_OPTIONS.map((option) => (
                <button
                    key={option.mode}
                    className={`direction-chip ${settings.directionMode === option.mode ? 'active' : ''}`}
                    onClick={() => onChange({ directionMode: option.mode })}
                >
                  {option.label}
                </button>
            ))}
          </div>
        </div>
      </div>
  );
}
