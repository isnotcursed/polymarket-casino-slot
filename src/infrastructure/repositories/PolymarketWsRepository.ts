/**
 * @license Source-Available (Non-Commercial)
 */

import type { IMarketRepository } from '@/core/repositories/interfaces.ts';
import {
  type Bet,
  type BetConfig,
  type BetResolution,
  BetStatus,
  type MarketData,
  type MarketInfo,
  type PriceUpdate
} from '@/core/domain/types.ts';
import { SlotConfig } from '@/config/slot.config.ts';
import { ClobClient, OrderType, Side, getContractConfig, type TickSize } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import { AddressZero } from '@ethersproject/constants';
import { arrayify } from '@ethersproject/bytes';
import type { JsonRpcSigner } from '@ethersproject/providers';


type MarketPayload = {
  id: string;
  displayId?: string;
  endsAt?: string | null;
  tokenIds?: { yes?: string; no?: string };
  referencePrice?: number | null;
};

type OddsPayload = {
  buyYes?: number;
  buyNo?: number;
  sellYes?: number;
  sellNo?: number;
};

type PricePayload = {
  currentPrice?: number;
  volume?: number;
  timestamp?: string;
};

type OrderResponse = {
  success?: boolean;
  errorMsg?: string;
  error?: string | Record<string, unknown>;
  status?: number;
  makingAmount?: string;
  takingAmount?: string;
};

type WsMessage =
  | { type: 'market'; payload: MarketPayload }
  | { type: 'odds'; payload: OddsPayload }
  | { type: 'price'; payload: PricePayload }
  | { type: 'balance'; payload: { balance: number | null } }
  | { type: 'error'; message?: string };

type AuthSettings = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  apiAddress: string;
  signatureType: 0 | 1 | 2;
  liveTradingEnabled?: boolean;
  walletPrivateKey?: string;
};

type LiveBetRecord = {
  bet: Bet;
  entryPrice: number;
  marketId: string;
  tokenId: string;
  shares: number;
};

type DemoBetRecord = {
  bet: Bet;
  entryPrice: number;
  marketId: string;
  priceSource: 'odds' | 'fallback';
};

type BetRecord = (LiveBetRecord & { live: true }) | (DemoBetRecord & { live: false });

type MarketListener = (info: MarketInfo) => void;
type BalanceListener = (balance: number | null | undefined) => void;
type PriceListener = (update: PriceUpdate) => void;

export class PolymarketWsRepository implements IMarketRepository {
  private readonly clobHost = SlotConfig.polymarket.clobHost ?? '/api/clob';
  private readonly chainId = 137;

  private socket: WebSocket | null = null;
  private pendingMessages: string[] = [];
  private reconnectTimer: number | null = null;
  private isConnecting = false;

  private currentMarket: MarketInfo | null = null;
  private currentOdds: OddsPayload | null = null;
  private lastOdds: OddsPayload | null = null;
  private currentTokenIds: { yes?: string; no?: string } = {};
  private currentPrice = 50000;
  private lastVolume = 0;
  private lastPriceAt: Date | null = null;
  private hasPrice = false;
  private apiBalance: number | null | undefined = undefined;

  private liveTradingEnabled = false;
  private authRequestId = 0;
  private liveTradingBlockReason: string | null = null;
  private lastSignatureType: 0 | 1 | 2 = 0;
  private currentSignerAddress: string | null = null;
  private currentFunderAddress: string | null = null;
  private ownerSigner: Wallet | null = null;

  /**
   * The "signing" client: built with the real Wallet (private key).
   * Used to create (sign) orders. Also used for non-authed reads
   * when funder is specified.
   */
  private signingClient: ClobClient | null = null;

  /**
   * The "posting" client: built with API credentials (L2 headers).
   * Used to post already-signed orders and to query balance.
   */
  private postingClient: ClobClient | null = null;

  private derivedFunderAddress: string | null = null;
  private readonly conditionalAllowanceReady = new Set<string>();

  private readonly activeBets = new Map<string, BetRecord>();

  private readonly marketListeners = new Set<MarketListener>();
  private readonly balanceListeners = new Set<BalanceListener>();
  private readonly priceListeners = new Set<PriceListener>();
  private readonly oddsWaiters = new Set<() => void>();

  constructor() {
    this.connect();
  }

  updateAuth(settings: AuthSettings): void {
    const apiKey = settings.apiKey?.trim() ?? '';
    const apiSecret = settings.apiSecret?.trim() ?? '';
    const apiPassphrase = settings.apiPassphrase?.trim() ?? '';
    const apiAddress = settings.apiAddress?.trim() ?? '';
    const hasCreds = Boolean(apiKey && apiSecret && apiPassphrase && apiAddress);

    const requestId = ++this.authRequestId;
    this.liveTradingEnabled = Boolean(settings.liveTradingEnabled);
    const normalizedKey = this.normalizePrivateKey(settings.walletPrivateKey);
    const signatureType = this.normalizeSignatureType(settings.signatureType);
    this.lastSignatureType = signatureType;
    this.liveTradingBlockReason = null;

    this.signingClient = null;
    this.postingClient = null;
    this.derivedFunderAddress = null;
    this.currentSignerAddress = null;
    this.currentFunderAddress = null;
    this.ownerSigner = null;
    this.conditionalAllowanceReady.clear();

    if (!hasCreds) {
      this.sendWs({ type: 'auth', payload: null });
      return;
    }

    this.sendWs({
      type: 'auth',
      payload: { apiKey, apiSecret, apiPassphrase, apiAddress, signatureType },
    });

    if (!this.liveTradingEnabled || !normalizedKey) {
      return;
    }

    const ownerSigner = new Wallet(normalizedKey);
    this.ownerSigner = ownerSigner;
    const ownerAddress = ownerSigner.address;
    this.currentSignerAddress = ownerAddress;

    if (signatureType === 0) {
      this.buildClients({
        ownerSigner,
        apiAddress,
        funderAddress: undefined,
        signatureType,
        apiKey,
        apiSecret,
        apiPassphrase,
      });
      return;
    }

    this.liveTradingBlockReason = 'Resolving proxy/safe address...';
    void this.resolveDerivedAddress(ownerAddress).then((derived) => {
      if (this.authRequestId !== requestId) return;
      const derivedFunder =
        signatureType === 1 ? derived?.proxyAddress : derived?.safeAddress;
      if (!derivedFunder) {
        this.liveTradingBlockReason = 'Unable to resolve proxy/safe address.';
        return;
      }

      this.derivedFunderAddress = derivedFunder;
      this.liveTradingBlockReason = null;
      this.buildClients({
        ownerSigner,
        apiAddress,
        funderAddress: derivedFunder,
        signatureType,
        apiKey,
        apiSecret,
        apiPassphrase,
      });
    });
  }

  onMarketUpdate(handler: MarketListener): () => void {
    this.marketListeners.add(handler);
    if (this.currentMarket) handler(this.currentMarket);
    return () => this.marketListeners.delete(handler);
  }

  onBalanceUpdate(handler: BalanceListener): () => void {
    this.balanceListeners.add(handler);
    if (this.apiBalance !== undefined) handler(this.apiBalance);
    return () => this.balanceListeners.delete(handler);
  }

  onPriceUpdate(handler: PriceListener): () => void {
    this.priceListeners.add(handler);
    if (this.hasPrice) {
      handler({
        currentPrice: this.currentPrice,
        volume: this.lastVolume,
        timestamp: this.lastPriceAt ?? undefined,
      });
    }
    return () => this.priceListeners.delete(handler);
  }

  async getCurrentMarket(): Promise<MarketInfo> {
    if (this.currentMarket) return this.currentMarket;
    await this.waitForMarket();
    return this.currentMarket ?? {
      id: SlotConfig.polymarket.marketId,
      displayId: SlotConfig.polymarket.marketId,
      endsAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async getCurrentMarketData(_marketId: string): Promise<MarketData> {
    const market = await this.getCurrentMarket();
    return {
      marketId: market.id,
      currentPrice: this.currentPrice || 0,
      volume: this.lastVolume,
      timestamp: this.lastPriceAt ?? new Date(),
    };
  }

  async placeBet(config: BetConfig): Promise<Bet> {
    const market = await this.getCurrentMarket();

    if (this.isLiveTrading()) {
      return this.placeLiveBet(config, market, await this.getCurrentMarketData(market.id));
    }

    let oddsEntry = this.getDemoEntryPrice(config.direction);
    if (oddsEntry === null) {
      await this.waitForOdds();
      oddsEntry = this.getDemoEntryPrice(config.direction);
    }
    if (oddsEntry === null || !Number.isFinite(oddsEntry) || oddsEntry <= 0) {
      throw new Error('Market odds unavailable. Please try again.');
    }
    const entryPrice = oddsEntry;
    const priceSource: DemoBetRecord['priceSource'] = 'odds';

    const bet: Bet = {
      id: this.generateId(),
      amount: config.amount,
      direction: config.direction,
      status: BetStatus.ACTIVE,
      placedAt: new Date(),
      entryPrice,
      mode: 'demo',
    };

    this.activeBets.set(bet.id, {
      bet,
      entryPrice,
      marketId: market.id,
      live: false,
      priceSource,
    });

    console.log(
      `📊 Demo bet: ${config.direction} $${config.amount} @ $${entryPrice.toFixed(4)} (${priceSource})`
    );
    return bet;
  }

  async cancelBet(betId: string): Promise<void> {
    const record = this.activeBets.get(betId);
    if (!record) throw new Error('Bet not found');

    if (record.live) {
      await this.sellPosition(record.tokenId, record.shares);
    }

    this.activeBets.delete(betId);
    console.log(`❌ Bet cancelled: ${betId}`);
  }

  async resolveBet(betId: string): Promise<BetResolution> {
    const record = this.activeBets.get(betId);
    if (!record) throw new Error('Bet not found');
    const { bet, entryPrice, marketId } = record;

    if (record.live) {
      return this.resolveLiveBet(record);
    }

    return this.resolveDemoBet(record);
  }

  async isMarketAvailable(_marketId: string): Promise<boolean> {
    const market = await this.getCurrentMarket();
    if (!market.endsAt) return true;
    return market.endsAt.getTime() > Date.now();
  }

  async getAccountBalance(): Promise<number | null> {
    return this.apiBalance === undefined ? null : this.apiBalance;
  }

  isLiveTrading(): boolean {
    return (
      this.liveTradingEnabled &&
      !this.liveTradingBlockReason &&
      this.signingClient !== null &&
      this.postingClient !== null
    );
  }

  getLiveTradingBlockReason(): string | null {
    return this.liveTradingBlockReason;
  }

  private async placeLiveBet(
    config: BetConfig,
    market: MarketInfo,
    marketData: MarketData,
  ): Promise<Bet> {
    if (!this.signingClient || !this.postingClient) {
      throw new Error('Live trading requires a valid private key.');
    }

    const tokenId = config.direction === 'UP'
      ? this.currentTokenIds.yes
      : this.currentTokenIds.no;
    if (!tokenId) throw new Error('Live trading unavailable: token id missing.');

    console.log(`🔵 [BUY] direction=${config.direction} amount=$${config.amount} tokenId=${tokenId.slice(0, 12)}…`);

    const { response } = await this.executeOrder(tokenId, Side.BUY, config.amount);

    console.log(`🔵 [BUY] raw response:`, JSON.stringify(response));

    const makerUsd = this.parseAmount(response?.makingAmount);
    const takerShares = this.parseAmount(response?.takingAmount);

    console.log(`🔵 [BUY] parsed: spent=$${makerUsd} shares=${takerShares}`);

    if (makerUsd == null || takerShares == null || makerUsd <= 0 || takerShares <= 0) {
      throw new Error(`Order did not fill. makingAmount=${response?.makingAmount} takingAmount=${response?.takingAmount}`);
    }

    let finalShares = takerShares;
    if (takerShares && takerShares > 0) {
      const confirmed = await this.waitForPositionSize(tokenId, takerShares, [0, 250, 500]);
      if (confirmed && confirmed > 0 && confirmed < takerShares) {
        console.log(`🔵 [BUY] position size smaller than response. capping shares ${takerShares} → ${confirmed}`);
        finalShares = confirmed;
      }
    }

    const entryPrice = makerUsd / finalShares;

    const bet: Bet = {
      id: this.generateId(),
      amount: makerUsd,
      direction: config.direction,
      status: BetStatus.ACTIVE,
      placedAt: new Date(),
      entryPrice,
      mode: 'live',
    };

    this.activeBets.set(bet.id, {
      bet,
      entryPrice,
      marketId: market.id,
      tokenId,
      shares: finalShares,
      live: true,
    });

    console.log(`📊 Live bet: ${config.direction} $${makerUsd.toFixed(4)} → ${finalShares.toFixed(4)} shares @ ${entryPrice.toFixed(4)}/share`);
    return bet;
  }

  private async resolveLiveBet(record: LiveBetRecord & { live: true }): Promise<BetResolution> {
    const { bet, entryPrice } = record;
    console.log(`🟡 [SELL] resolving bet=${bet.id} tokenId=${record.tokenId.slice(0, 12)}… shares=${record.shares}`);

    const { payout, exitPrice } = await this.sellPosition(record.tokenId, record.shares);

    const priceChange = exitPrice - entryPrice;
    const priceChangePercent = entryPrice ? (priceChange / entryPrice) * 100 : 0;
    const won = payout > bet.amount;

    const resolvedBet: Bet = {
      ...bet,
      status: won ? BetStatus.WON : BetStatus.LOST,
      exitPrice,
      payout,
      resolvedAt: new Date(),
    };

    this.activeBets.delete(bet.id);

    console.log(
      `🎲 Live resolved: ${bet.direction} | entry=${entryPrice.toFixed(4)} exit=${exitPrice.toFixed(4)} | ${won ? '✅ WIN' : '❌ LOSS'} payout=$${payout.toFixed(4)}`,
    );

    return { bet: resolvedBet, won, payout, priceChange, priceChangePercent };
  }

  private async resolveDemoBet(record: DemoBetRecord & { live: false }): Promise<BetResolution> {
    const { bet, entryPrice, marketId } = record;
    let exitPrice = entryPrice;
    let priceChange = 0;
    let priceChangePercent = 0;
    let won = false;
    let payout = bet.amount;

    if (record.priceSource === 'odds') {
      const exitOdds = this.getDemoExitPrice(bet.direction, entryPrice);
      exitPrice = exitOdds ?? entryPrice;
      priceChange = exitPrice - entryPrice;
      priceChangePercent = entryPrice ? (priceChange / entryPrice) * 100 : 0;
      const shares = entryPrice > 0 ? bet.amount / entryPrice : 0;
      payout = shares * exitPrice;
      won = payout > bet.amount;
    } else {
      const marketData = await this.getCurrentMarketData(marketId);
      exitPrice = marketData.currentPrice;
      priceChange = exitPrice - entryPrice;
      priceChangePercent = entryPrice ? (priceChange / entryPrice) * 100 : 0;
      won =
        (bet.direction === 'UP' && priceChange > 0) ||
        (bet.direction === 'DOWN' && priceChange < 0);
      if (won) {
        const rewardBoost = Math.max(0.01, Math.abs(priceChangePercent) / 10);
        payout = bet.amount * (1 + rewardBoost);
      } else {
        const lossFactor = Math.max(0.05, 1 - Math.abs(priceChangePercent) / 50);
        payout = bet.amount * lossFactor;
      }
    }

    const resolvedBet: Bet = {
      ...bet,
      status: won ? BetStatus.WON : BetStatus.LOST,
      exitPrice,
      payout,
      resolvedAt: new Date(),
    };

    this.activeBets.delete(bet.id);

    console.log(
      `🎲 Demo resolved: ${bet.direction} | entry=$${entryPrice.toFixed(4)} exit=$${exitPrice.toFixed(4)} | Δ${priceChangePercent.toFixed(2)}% | ${won ? '✅' : '❌'} $${payout.toFixed(2)} (${record.priceSource})`,
    );

    return { bet: resolvedBet, won, payout, priceChange, priceChangePercent };
  }

  private async executeOrder(
    tokenId: string,
    side: Side,
    amount: number,
  ): Promise<{ response: OrderResponse | null }> {
    if (!this.signingClient || !this.postingClient) {
      throw new Error('Live trading client unavailable.');
    }

    const orderAmount = side === Side.SELL
      ? this.roundDownToDecimals(amount, 2)
      : amount;

    if (side === Side.SELL && orderAmount <= 0) {
      throw new Error(`Position too small after rounding to 2dp: ${amount} → ${orderAmount}`);
    }

    console.log(`🔷 [ORDER] side=${side === Side.BUY ? 'BUY' : 'SELL'} amount=${orderAmount} tokenId=${tokenId.slice(0, 12)}…`);

    const baseOffset = 2;
    const priceInfo = await this.getMarketablePrice(tokenId, side, orderAmount, baseOffset);
    if (!priceInfo) {
      throw new Error('No liquidity for this market right now.');
    }

    const buildAndPost = async (price: number, tickSize: TickSize) => {
      const userOrder = {
        tokenID: tokenId,
        side,
        amount: orderAmount,
        orderType: OrderType.FAK as OrderType.FAK,
        price,
      };

      console.log(`🔷 [ORDER] createMarketOrder payload:`, JSON.stringify(userOrder));

      const order = await this.signingClient!.createMarketOrder(userOrder, { tickSize });

      console.log(`🔷 [ORDER] signed order: maker=${order.maker} signer=${order.signer} makerAmount=${order.makerAmount} takerAmount=${order.takerAmount} signatureType=${order.signatureType}`);

      if (
        order.signatureType !== 0 &&
        order.signer.toLowerCase() === order.maker.toLowerCase()
      ) {
        throw new Error(
          'Proxy/Safe orders must be signed by an owner EOA (signer ≠ maker). Check signature type and private key.',
        );
      }

      const response = (await this.postingClient!.postOrder(
        order,
        OrderType.FAK,
        false,
      )) as OrderResponse | null;

      console.log(`🔷 [ORDER] postOrder response:`, JSON.stringify(response));

      this.assertOrderResponse(response);
      return response;
    };

    try {
      console.log(`🔷 [ORDER] marketable price=${priceInfo.price} tickSize=${priceInfo.tickSize}`);
      const response = await buildAndPost(priceInfo.price, priceInfo.tickSize);
      return { response };
    } catch (error) {
      console.log(`🔷 [ORDER] first attempt error:`, error instanceof Error ? error.message : error);

      if (!this.isNoMatchError(error)) throw error;

      console.log(`🔷 [ORDER] no match. Repricing with extra aggressiveness…`);
      const retryInfo = await this.getMarketablePrice(tokenId, side, orderAmount, baseOffset + 2);
      if (!retryInfo) throw error;
      try {
        console.log(`🔷 [ORDER] retry price=${retryInfo.price} tickSize=${retryInfo.tickSize}`);
        const response = await buildAndPost(retryInfo.price, retryInfo.tickSize);
        return { response };
      } catch (retryError) {
        if (!this.isNoMatchError(retryError)) throw retryError;
        console.log(`🔷 [ORDER] still no match. Final retry with wider buffer…`);
        const finalInfo = await this.getMarketablePrice(tokenId, side, orderAmount, baseOffset + 4);
        if (!finalInfo) throw retryError;
        console.log(`🔷 [ORDER] final price=${finalInfo.price} tickSize=${finalInfo.tickSize}`);
        const response = await buildAndPost(finalInfo.price, finalInfo.tickSize);
        return { response };
      }
    }
  }

  private async sellPosition(
    tokenId: string,
    shares: number,
  ): Promise<{ payout: number; exitPrice: number }> {
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('Position size invalid.');

    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.ensureConditionalAllowance(tokenId);

      const positionSize = await this.waitForPositionSize(tokenId, shares);
      if (positionSize !== null) {
        if (positionSize <= 0) {
          throw new Error('No position balance available to sell.');
        }
        if (positionSize < shares) {
          console.log(`🟡 [SELL] capping shares to position size: ${shares} → ${positionSize}`);
          shares = positionSize;
        }
      }

      const roundedShares = this.roundDownToDecimals(shares, 2);
      if (roundedShares <= 0) {
        throw new Error(`Position too small to close after rounding: ${shares} → ${roundedShares}`);
      }

      console.log(`🟡 [SELL] shares=${shares} rounded=${roundedShares} tokenId=${tokenId.slice(0, 12)}…`);

      try {
        const { response } = await this.executeOrder(tokenId, Side.SELL, roundedShares);

        console.log(`🟡 [SELL] raw response:`, JSON.stringify(response));

        const makerShares = this.parseAmount(response?.makingAmount);
        const takerUsd = this.parseAmount(response?.takingAmount);

        console.log(`🟡 [SELL] parsed: sharesSold=${makerShares} usdReceived=${takerUsd}`);

        if (takerUsd == null || takerUsd <= 0) {
          throw new Error(`Sell order did not fill. makingAmount=${response?.makingAmount} takingAmount=${response?.takingAmount}`);
        }

        const exitPrice = makerShares && makerShares > 0 ? takerUsd / makerShares : 0;
        console.log(`🟡 [SELL] payout=$${takerUsd.toFixed(4)} exitPrice=${exitPrice.toFixed(4)}`);
        return { payout: takerUsd, exitPrice };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!this.isBalanceOrAllowanceError(message) || attempt === maxAttempts) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(message);
        const backoff = 500 * attempt;
        console.log(`🟡 [SELL] balance/allowance not ready. Retrying in ${backoff}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    throw lastError ?? new Error('Sell failed after retries.');
  }

  private buildClients(cfg: {
    ownerSigner: Wallet;
    apiAddress: string;
    funderAddress?: string;
    signatureType: 0 | 1 | 2;
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
  }): void {
    const { ownerSigner, apiAddress, funderAddress, signatureType, apiKey, apiSecret, apiPassphrase } = cfg;
    this.currentFunderAddress = funderAddress ?? ownerSigner.address;

    this.signingClient = new ClobClient(
      this.clobHost,
      this.chainId,
      ownerSigner,
      undefined,
      signatureType,
      funderAddress,
    );

    const l2Signer = { getAddress: async () => apiAddress } as unknown as JsonRpcSigner;
    this.postingClient = new ClobClient(
      this.clobHost,
      this.chainId,
      l2Signer,
      { key: apiKey, secret: apiSecret, passphrase: apiPassphrase },
      signatureType,
      undefined,
      undefined,
      true,
    );

    console.log(`🔑 [AUTH] Live trading clients built: sigType=${signatureType} funder=${funderAddress ?? 'none'} signer=${ownerSigner.address}`);
  }

  private connect(): void {
    if (this.isConnecting || this.socket) return;
    this.isConnecting = true;

    const url = this.buildWsUrl();
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.isConnecting = false;
      this.flushPending();
      this.sendWs({ type: 'request', payload: { topic: 'snapshot' } });
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => { this.socket = null; this.isConnecting = false; this.scheduleReconnect(); };
    socket.onerror = () => { this.socket = null; this.isConnecting = false; this.scheduleReconnect(); };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  private sendWs(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    } else {
      this.pendingMessages.push(data);
    }
  }

  private flushPending(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.pendingMessages.forEach((m) => this.socket!.send(m));
    this.pendingMessages = [];
  }

  private handleMessage(raw: unknown): void {
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(raw));
    else if (raw instanceof Blob) { raw.text().then((d) => this.handleMessage(d)); return; }
    else return;

    let message: WsMessage;
    try { message = JSON.parse(text); } catch { return; }

    switch (message.type) {
      case 'market': {
        this.currentTokenIds = message.payload.tokenIds ?? {};
        this.currentMarket = {
          id: message.payload.id,
          displayId: message.payload.displayId,
          endsAt: this.parseDate(message.payload.endsAt),
          buyYesOdds: this.currentOdds?.buyYes,
          buyNoOdds: this.currentOdds?.buyNo,
          sellYesOdds: this.currentOdds?.sellYes,
          sellNoOdds: this.currentOdds?.sellNo,
          referencePrice: typeof message.payload.referencePrice === 'number' ? message.payload.referencePrice : undefined,
        };
        this.emitMarket();
        break;
      }
      case 'odds': {
        this.currentOdds = message.payload;
        this.lastOdds = message.payload;
        this.oddsWaiters.forEach((resolve) => resolve());
        this.oddsWaiters.clear();
        if (this.currentMarket) {
          this.currentMarket = {
            ...this.currentMarket,
            buyYesOdds: message.payload.buyYes,
            buyNoOdds: message.payload.buyNo,
            sellYesOdds: message.payload.sellYes,
            sellNoOdds: message.payload.sellNo,
            referencePrice: this.currentMarket.referencePrice,
          };
          this.emitMarket();
        }
        break;
      }
      case 'price': {
        if (typeof message.payload.currentPrice === 'number') this.currentPrice = message.payload.currentPrice;
        if (typeof message.payload.volume === 'number') this.lastVolume = message.payload.volume;
        if (message.payload.timestamp) {
          const d = new Date(message.payload.timestamp);
          if (!isNaN(d.getTime())) this.lastPriceAt = d;
        }
        this.hasPrice = true;
        this.emitPrice();
        break;
      }
      case 'balance': {
        this.apiBalance = message.payload.balance;
        this.emitBalance();
        break;
      }
    }
  }

  private emitMarket(): void {
    if (!this.currentMarket) return;
    this.marketListeners.forEach((h) => h(this.currentMarket!));
  }

  private emitBalance(): void {
    this.balanceListeners.forEach((h) => h(this.apiBalance));
  }

  private emitPrice(): void {
    if (!this.hasPrice) return;
    const update: PriceUpdate = {
      currentPrice: this.currentPrice,
      volume: this.lastVolume,
      timestamp: this.lastPriceAt ?? undefined,
    };
    this.priceListeners.forEach((h) => h(update));
  }

  private normalizeOdds(value?: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const adjusted = value > 1 ? value / 100 : value;
    if (adjusted <= 0 || adjusted > 1.01) return null;
    return adjusted;
  }

  private getDemoEntryPrice(direction: BetConfig['direction']): number | null {
    const odds = direction === 'UP'
      ? this.currentOdds?.buyYes ?? this.lastOdds?.buyYes
      : this.currentOdds?.buyNo ?? this.lastOdds?.buyNo;
    return this.normalizeOdds(odds ?? undefined);
  }

  private getDemoExitPrice(direction: BetConfig['direction'], entryPrice: number): number | null {
    const sellOdds = direction === 'UP'
      ? this.currentOdds?.sellYes ?? this.lastOdds?.sellYes
      : this.currentOdds?.sellNo ?? this.lastOdds?.sellNo;
    const buyOdds = direction === 'UP'
      ? this.currentOdds?.buyYes ?? this.lastOdds?.buyYes
      : this.currentOdds?.buyNo ?? this.lastOdds?.buyNo;
    return this.normalizeOdds(sellOdds ?? buyOdds ?? entryPrice);
  }

  private waitForOdds(timeoutMs = 1500): Promise<void> {
    if (this.currentOdds || this.lastOdds) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.oddsWaiters.delete(done);
        resolve();
      }, timeoutMs);
      const done = () => {
        window.clearTimeout(timeout);
        this.oddsWaiters.delete(done);
        resolve();
      };
      this.oddsWaiters.add(done);
    });
  }

  private waitForMarket(): Promise<void> {
    if (this.currentMarket) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => { this.marketListeners.delete(onMarket); resolve(); }, 4000);
      const onMarket: MarketListener = () => {
        window.clearTimeout(timeout);
        this.marketListeners.delete(onMarket);
        resolve();
      };
      this.marketListeners.add(onMarket);
    });
  }

  private parseDate(value?: string | null): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  private normalizePrivateKey(value?: string): string | null {
    if (!value) return null;
    const t = value.trim();
    if (!t) return null;
    const n = t.startsWith('0x') ? t : `0x${t}`;
    return /^0x[a-fA-F0-9]{64}$/.test(n) ? n : null;
  }

  private normalizeSignatureType(value?: number): 0 | 1 | 2 {
    if (value === 1 || value === 2) return value;
    return 0;
  }

  private async resolveDerivedAddress(ownerAddress: string): Promise<{
    proxyAddress?: string;
    safeAddress?: string;
  } | null> {
    try {
      const response = await fetch(`/api/polymarket/derived-addresses?owner=${encodeURIComponent(ownerAddress)}`);
      if (!response.ok) return null;
      const data = await response.json();
      const isZero = (v: string) => /^0x0{40}$/i.test(v);
      const proxy = typeof data?.proxyAddress === 'string' && !isZero(data.proxyAddress) ? data.proxyAddress : undefined;
      const safe = typeof data?.safeAddress === 'string' && !isZero(data.safeAddress) ? data.safeAddress : undefined;
      return { proxyAddress: proxy, safeAddress: safe };
    } catch {
      return null;
    }
  }

  /**
   * Parse OrderResponse amount strings.
   * These are HUMAN-READABLE (e.g. "1.69", "0.9802"),
   * NOT raw 6-decimal USDC. Do NOT divide by 1_000_000.
   */
  private parseAmount(value: string | number | undefined): number | null {
    if (value == null) return null;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }

  private async getMarketablePrice(
    tokenId: string,
    side: Side,
    amount: number,
    tickOffset = 0,
  ): Promise<{ price: number; tickSize: TickSize } | null> {
    if (!this.signingClient) return null;

    let tickSizeRaw: string;
    try {
      tickSizeRaw = await this.signingClient.getTickSize(tokenId);
    } catch {
      return null;
    }

    const tickSize = this.normalizeTickSize(tickSizeRaw);
    const tick = this.toNumber(tickSize);
    if (!tick || tick <= 0) return null;

    let price = await this.fetchOrderbookCrossPrice(tokenId, side);
    if (price === null) {
      try {
        price = await this.signingClient.calculateMarketPrice(tokenId, side, amount, OrderType.FAK);
      } catch {
        price = null;
      }
    }
    if (price === null) return null;

    const aligned = this.alignPriceToTick(price, tick, side, tickOffset);
    return { price: aligned, tickSize };
  }

  private async fetchOrderbookCrossPrice(tokenId: string, side: Side): Promise<number | null> {
    try {
      const book = await this.signingClient?.getOrderBook(tokenId);
      const bids = Array.isArray(book?.bids) ? book?.bids : [];
      const asks = Array.isArray(book?.asks) ? book?.asks : [];
      if (side === Side.SELL) {
        let best: number | null = null;
        for (const bid of bids) {
          const price = this.toNumber(bid?.price);
          if (price == null) continue;
          if (best === null || price > best) best = price;
        }
        return best;
      }
      let best: number | null = null;
      for (const ask of asks) {
        const price = this.toNumber(ask?.price);
        if (price == null) continue;
        if (best === null || price < best) best = price;
      }
      return best;
    } catch {
      return null;
    }
  }

  private async ensureConditionalAllowance(tokenId: string): Promise<void> {
    if (this.conditionalAllowanceReady.has(tokenId)) return;

    const funder = this.getFunderAddress();
    if (!funder || !this.ownerSigner) {
      throw new Error('Missing signer/funder for approval.');
    }

    const exchange = await this.resolveExchangeAddress(tokenId);
    const conditionalTokens = this.getConditionalTokensAddress();
    const provider = new JsonRpcProvider('/api/rpc');
    const contract = new Contract(
      conditionalTokens,
      [
        'function isApprovedForAll(address owner, address operator) view returns (bool)',
        'function setApprovalForAll(address operator, bool approved)',
      ],
      provider
    );

    try {
      const approved = await contract.isApprovedForAll(funder, exchange);
      console.log(`🟡 [ALLOW] approved=${approved} funder=${funder} exchange=${exchange}`);
      if (approved) {
        this.conditionalAllowanceReady.add(tokenId);
        return;
      }

      console.log(`🟡 [ALLOW] approving outcome tokens for exchange=${exchange} funder=${funder}`);

      if (this.lastSignatureType === 2) {
        await this.approveViaSafe(provider, conditionalTokens, exchange);
      } else if (this.lastSignatureType === 0) {
        const wallet = this.ownerSigner.connect(provider);
        const tx = await contract.connect(wallet).setApprovalForAll(exchange, true);
        await tx.wait();
      } else {
        throw new Error('Proxy approvals are not automated yet. Approve in Polymarket UI.');
      }

      const approvedAfter = await contract.isApprovedForAll(funder, exchange);
      if (!approvedAfter) {
        throw new Error('Conditional token allowance missing. Approve outcome tokens for the exchange.');
      }

      this.conditionalAllowanceReady.add(tokenId);
      console.log(`🟡 [ALLOW] conditional approval ready.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve conditional tokens.';
      console.log(`🟡 [ALLOW] ${message}`);
      throw new Error(message);
    }
  }

  private getFunderAddress(): string | null {
    return this.currentFunderAddress ?? this.derivedFunderAddress ?? this.currentSignerAddress;
  }

  private async waitForPositionSize(
    tokenId: string,
    minShares: number,
    delays?: number[],
  ): Promise<number | null> {
    const plan = delays && delays.length > 0 ? delays : [0, 500, 1000, 2000];
    for (const delay of plan) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const size = await this.fetchPositionSize(tokenId);
      if (size !== null) {
        if (size <= 0) return 0;
        if (size >= minShares || minShares <= 0) return size;
        return size;
      }
    }
    return null;
  }

  private async fetchPositionSize(tokenId: string): Promise<number | null> {
    const funder = this.getFunderAddress();
    if (!funder) return null;

    try {
      const url = `/api/data/positions?user=${encodeURIComponent(funder)}&limit=500`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data)) return null;

      const tokenLower = tokenId.toLowerCase();
      for (const pos of data) {
        if (!pos || typeof pos !== 'object') continue;
        const record = pos as Record<string, unknown>;
        const asset =
          typeof record.asset === 'string'
            ? record.asset
            : typeof record.tokenId === 'string'
              ? record.tokenId
              : typeof record.token_id === 'string'
                ? record.token_id
                : '';
        if (asset.toLowerCase() !== tokenLower) continue;

        const size = this.toNumber(record.size ?? record.shares ?? record.balance ?? record.qty);
        if (size !== null) return size;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getConditionalTokensAddress(): string {
    return getContractConfig(this.chainId).conditionalTokens;
  }

  private async resolveExchangeAddress(tokenId: string): Promise<string> {
    const cfg = getContractConfig(this.chainId);
    const negRisk = await this.signingClient?.getNegRisk(tokenId);
    return negRisk ? cfg.negRiskExchange : cfg.exchange;
  }

  private async approveViaSafe(
    provider: JsonRpcProvider,
    conditionalTokens: string,
    exchange: string,
  ): Promise<void> {
    if (!this.ownerSigner || !this.derivedFunderAddress) {
      throw new Error('Safe approval requires owner signer and safe address.');
    }

    const safeAddress = this.derivedFunderAddress;
    const wallet = this.ownerSigner.connect(provider);

    const safe = new Contract(
      safeAddress,
      [
        'function nonce() view returns (uint256)',
        'function getThreshold() view returns (uint256)',
        'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)',
        'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)',
      ],
      provider
    );

    const threshold = await safe.getThreshold();
    if (threshold && threshold.toString() !== '1') {
      throw new Error('Safe threshold > 1. Approve manually in Safe UI.');
    }

    const data = new Contract(
      conditionalTokens,
      ['function setApprovalForAll(address operator, bool approved)'],
      provider
    ).interface.encodeFunctionData('setApprovalForAll', [exchange, true]);

    const safeTxGas = 300_000;
    const nonce = await safe.nonce();
    const txHash = await safe.getTransactionHash(
      conditionalTokens,
      0,
      data,
      0,
      safeTxGas,
      0,
      0,
      AddressZero,
      AddressZero,
      nonce
    );

    const sig = await wallet.signMessage(arrayify(txHash));
    const sigBytes = arrayify(sig);
    const v = sigBytes[64];
    if (v === undefined) {
      throw new Error('Invalid signature length.');
    }
    sigBytes[64] = v + 4;

    const exec = await safe.connect(wallet).execTransaction(
      conditionalTokens,
      0,
      data,
      0,
      safeTxGas,
      0,
      0,
      AddressZero,
      AddressZero,
      sigBytes
    );
    await exec.wait();
  }

  private isBalanceOrAllowanceError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('not enough balance') || lower.includes('allowance');
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') { const n = Number(value); return Number.isFinite(n) ? n : null; }
    return null;
  }

  private roundDownToDecimals(value: number, decimals: number): number {
    if (!Number.isFinite(value)) return value;
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor + 1e-8) / factor;
  }

  private normalizeTickSize(value: string): TickSize {
    if (value === '0.1' || value === '0.01' || value === '0.001' || value === '0.0001') {
      return value;
    }
    return '0.01';
  }

  private alignPriceToTick(price: number, tick: number, side: Side, tickOffset: number): number {
    if (!Number.isFinite(price) || !Number.isFinite(tick) || tick <= 0) return price;
    const rawTicks = price / tick;
    let ticks = side === Side.BUY ? Math.ceil(rawTicks) : Math.floor(rawTicks);
    if (tickOffset > 0) {
      ticks += side === Side.BUY ? tickOffset : -tickOffset;
    }
    const adjusted = ticks * tick;
    const min = tick;
    const max = 1 - tick;
    const clamped = Math.max(min, Math.min(max, adjusted));
    const decimals = this.tickDecimals(tick);
    return Number(clamped.toFixed(decimals));
  }

  private tickDecimals(tick: number): number {
    const text = tick.toString();
    if (!text.includes('.')) return 0;
    const [, fraction = ''] = text.split('.');
    return fraction.length;
  }

  private isNoMatchError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : (error as { message?: string })?.message;
    if (typeof msg === 'string') {
      const lower = msg.toLowerCase();
      return lower.includes('no match') || lower.includes('no orderbook') || lower.includes('no orders found to match');
    }
    return false;
  }

  private assertOrderResponse(response: unknown): void {
    if (!response || typeof response !== 'object') {
      console.log(`⚠️ [ASSERT] empty/null response`);
      return;
    }
    const r = response as OrderResponse;
    if (r.error) {
      console.log(`❌ [ASSERT] error field:`, r.error);
      throw new Error(typeof r.error === 'string' ? r.error : 'Order rejected by Polymarket.');
    }
    if (typeof r.status === 'number' && r.status >= 400) {
      console.log(`❌ [ASSERT] HTTP status ${r.status}`);
      throw new Error('Order rejected by Polymarket.');
    }
    if (r.success === false) {
      const msg = r.errorMsg || 'Order rejected by Polymarket.';
      console.log(`❌ [ASSERT] success=false: ${msg}`);
      if (msg.toLowerCase().includes('not enough balance')) {
        throw new Error('Not enough balance/allowance. Check token approval for your API address.');
      }
      throw new Error(msg);
    }
    console.log(`✅ [ASSERT] order ok: success=${r.success} status=${r.status ?? 'n/a'} makingAmount=${r.makingAmount} takingAmount=${r.takingAmount}`);
  }

  private buildWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  private generateId(): string {
    return `bet_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
