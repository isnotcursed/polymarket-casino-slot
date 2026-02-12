/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { BetDirection, type BetConfig, type SpinResult, type DirectionMode } from '../domain/types';
import { BetService } from './BetService';
import { SlotMachineService } from './SlotMachineService';
import { SlotConfig } from '@/config/slot.config';

export type GameState = 
  | 'idle'
  | 'placing-bet'
  | 'spinning'
  | 'waiting'
  | 'resolving'
  | 'showing-result';

export interface GameStateUpdate {
  state: GameState;
  message?: string;
  timeRemaining?: number;
  currentBetId?: string;
}

export type GameStateCallback = (update: GameStateUpdate) => void;
export type SpinCompleteCallback = (result: SpinResult) => void;

export interface SpinOptions {
  holdTimeSeconds: number;
  directionMode: DirectionMode;
  apiKey?: string;
}

export class GameOrchestrator {
  private currentState: GameState = 'idle';
  private stateCallback?: GameStateCallback;
  private currentBetId?: string;
  private holdTimeoutId?: NodeJS.Timeout;
  private waitCancelResolver?: () => void;
  private activeRunId = 0;
  private cancelledRunId: number | null = null;

  constructor(
    private readonly betService: BetService,
    private readonly slotService: SlotMachineService
  ) {}

  onStateChange(callback: GameStateCallback): void {
    this.stateCallback = callback;
  }

  async spin(
    betAmount: number,
    options: SpinOptions,
    onComplete: SpinCompleteCallback
  ): Promise<void> {
    if (this.currentState !== 'idle') {
      throw new Error('Game already in progress');
    }
    const runId = ++this.activeRunId;

    try {
      this.updateState('placing-bet', 'Placing bet...');
      
      const direction = this.pickDirection(options.directionMode);
      const holdTimeSeconds = Math.min(
        SlotConfig.maxHoldTimeSeconds,
        Math.max(SlotConfig.minHoldTimeSeconds, Math.round(options.holdTimeSeconds))
      );
      const betConfig: BetConfig = {
        amount: betAmount,
        direction,
        holdTimeSeconds,
      };

      const bet = await this.betService.placeBet(betConfig);
      this.currentBetId = bet.id;

      this.updateState('spinning', 'Spinning...');
      await this.delay(SlotConfig.animation.spinDuration);
      if (this.cancelledRunId === runId) {
        return;
      }

      this.updateState('waiting', `Holding ${direction} position...`, {
        timeRemaining: holdTimeSeconds,
        currentBetId: bet.id,
      });

      await this.waitWithCountdown(
        holdTimeSeconds,
        (remaining) => {
          this.updateState('waiting', `Time remaining: ${remaining}s`, {
            timeRemaining: remaining,
            currentBetId: bet.id,
          });
        },
        runId
      );
      if (this.cancelledRunId === runId) {
        return;
      }

      this.updateState('resolving', 'Resolving bet...');
      const resolution = await this.betService.resolveBet(bet.id);

      const spinResult = this.slotService.generateSpinResult(resolution);

      this.updateState('showing-result', 
        spinResult.isWin ? `You won $${spinResult.winAmount.toFixed(2)}!` : 'Better luck next time!',
        { currentBetId: bet.id }
      );

      onComplete(spinResult);

      this.reset();

    } catch (error) {
      console.error('Spin failed:', error);
      this.reset(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  async cancel(onComplete?: SpinCompleteCallback): Promise<void> {
    if (this.currentBetId && this.currentState === 'waiting') {
      try {
        const runId = this.activeRunId;
        this.cancelledRunId = runId;
        if (this.holdTimeoutId) {
          clearTimeout(this.holdTimeoutId);
          this.holdTimeoutId = undefined;
        }
        if (this.waitCancelResolver) {
          this.waitCancelResolver();
          this.waitCancelResolver = undefined;
        }

        this.updateState('resolving', 'Resolving bet...');
        const resolution = await this.betService.resolveBet(this.currentBetId);
        const spinResult = this.slotService.generateSpinResult(resolution);

        this.updateState(
          'showing-result',
          spinResult.isWin ? `You won $${spinResult.winAmount.toFixed(2)}!` : 'Better luck next time!',
          { currentBetId: this.currentBetId }
        );

        if (onComplete) {
          onComplete(spinResult);
        }

        this.reset();
      } catch (error) {
        console.error('Cancel failed:', error);
        throw error;
      }
    }
  }

  getCurrentState(): GameState {
    return this.currentState;
  }

  private updateState(
    state: GameState,
    message?: string,
    extra?: { timeRemaining?: number; currentBetId?: string }
  ): void {
    this.currentState = state;
    
    if (this.stateCallback) {
      this.stateCallback({
        state,
        message,
        timeRemaining: extra?.timeRemaining,
        currentBetId: extra?.currentBetId,
      });
    }
  }

  private pickDirection(mode: DirectionMode): BetDirection {
    switch (mode) {
      case 'up':
        return BetDirection.UP;
      case 'down':
        return BetDirection.DOWN;
      default:
        return Math.random() > 0.5 ? BetDirection.UP : BetDirection.DOWN;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitWithCountdown(
    seconds: number,
    onTick: (remaining: number) => void,
    runId: number
  ): Promise<void> {
    if (seconds <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let remaining = seconds;
      const finish = () => {
        this.waitCancelResolver = undefined;
        resolve();
      };
      this.waitCancelResolver = finish;
      
      const tick = () => {
        if (this.cancelledRunId === runId) {
          finish();
          return;
        }
        if (remaining <= 0) {
          finish();
          return;
        }
        
        onTick(remaining);
        remaining--;
        this.holdTimeoutId = setTimeout(tick, 1000);
      };
      
      tick();
    });
  }

  private reset(message?: string): void {
    this.updateState('idle', message);
    this.currentBetId = undefined;
    this.waitCancelResolver = undefined;

    if (this.holdTimeoutId) {
      clearTimeout(this.holdTimeoutId);
      this.holdTimeoutId = undefined;
    }
  }
}
