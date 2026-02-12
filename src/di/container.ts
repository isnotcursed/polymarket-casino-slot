/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { BetService } from '@/core/services/BetService';
import { SlotMachineService } from '@/core/services/SlotMachineService';
import { GameOrchestrator } from '@/core/services/GameOrchestrator';

import { PolymarketWsRepository } from '@/infrastructure/repositories/PolymarketWsRepository';
import { LocalStorageBalanceRepository } from '@/infrastructure/repositories/LocalStorageBalanceRepository';
import { InMemoryBetRepository } from '@/infrastructure/repositories/InMemoryBetRepository';

import type { IMarketRepository, IBalanceRepository, IBetRepository } from '@/core/repositories/interfaces';

export class DIContainer {
  private static instance: DIContainer;

  private marketRepository: IMarketRepository;
  private balanceRepository: IBalanceRepository;
  private betRepository: IBetRepository;

  private betService: BetService;
  private slotMachineService: SlotMachineService;
  private gameOrchestrator: GameOrchestrator;

  private constructor() {
    this.marketRepository = new PolymarketWsRepository();
    this.balanceRepository = new LocalStorageBalanceRepository();
    this.betRepository = new InMemoryBetRepository();
    
    this.betService = new BetService(
      this.marketRepository,
      this.balanceRepository,
      this.betRepository
    );
    
    this.slotMachineService = new SlotMachineService();
    
    this.gameOrchestrator = new GameOrchestrator(
      this.betService,
      this.slotMachineService
    );
  }

  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  getGameOrchestrator(): GameOrchestrator {
    return this.gameOrchestrator;
  }

  getBalanceRepository(): IBalanceRepository {
    return this.balanceRepository;
  }

  getBetRepository(): IBetRepository {
    return this.betRepository;
  }

  getMarketRepository(): IMarketRepository {
    return this.marketRepository;
  }
}

export const getContainer = () => DIContainer.getInstance();
