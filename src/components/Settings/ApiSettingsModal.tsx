/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AssetType, ClobClient, createL1Headers } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import type { JsonRpcSigner } from '@ethersproject/providers';
import type { UserSettings } from '@/core/domain/types.ts';
import { SlotConfig } from '@/config/slot.config.ts';
import { clearPolymarketSettings } from '@/utils/polymarketSettings.ts';
import './Settings.css';
import * as React from "react";

interface ApiSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
}

export function ApiSettingsModal({ open, onClose, settings, onChange }: ApiSettingsModalProps) {
  const [applyStatus, setApplyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [applyMessage, setApplyMessage] = useState('');
  const [derivedProxy, setDerivedProxy] = useState<string | null>(null);
  const [derivedSafe, setDerivedSafe] = useState<string | null>(null);
  const lastSignatureType = useRef(settings.signatureType);
  const derivedSignerAddress = useMemo(() => {
    const raw = settings.walletPrivateKey.trim();
    if (!raw) return null;
    const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return null;
    try {
      return new Wallet(normalized).address;
    } catch {
      return null;
    }
  }, [settings.walletPrivateKey]);

  const handleGenerateKeys = async (): Promise<{
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
    apiAddress: string;
    signatureType: 0 | 1 | 2;
    message: string;
  }> => {
    const rawKey = settings.walletPrivateKey.trim();
    if (!rawKey) {
      throw new Error('Private key is required.');
    }

    const normalizedKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedKey)) {
      throw new Error('Private key format is invalid.');
    }

    try {
      const signer = new Wallet(normalizedKey);
      const clobHost = SlotConfig.polymarket.clobHost.replace(/\/$/, '');

      const fetchKeys = async (method: 'GET' | 'POST', path: string) => {
        const headers = await createL1Headers(signer, 137);
        const response = await fetch(`${clobHost}${path}`, {
          method,
          headers: headers as unknown as HeadersInit,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const errorMessage = typeof data?.error === 'string'
            ? data.error
            : 'Failed to generate API keys.';
          throw new Error(errorMessage);
        }
        return data;
      };

      let data: Record<string, unknown>;
      let resultMessage = 'API keys generated and filled in.';
      try {
        data = await fetchKeys('GET', '/auth/derive-api-key');
        resultMessage = 'Existing API keys found and filled in.';
      } catch {
        data = await fetchKeys('POST', '/auth/api-key');
        resultMessage = 'New API keys created and filled in.';
      }

      const apiKey = String(data.apiKey ?? data.api_key ?? data.key ?? '').trim();
      const apiSecret = String(data.apiSecret ?? data.secret ?? data.api_secret ?? '').trim();
      const apiPassphrase = String(data.apiPassphrase ?? data.passphrase ?? data.api_passphrase ?? '').trim();
      const apiAddress = String(data.apiAddress ?? data.address ?? data.api_address ?? '').trim();
      const signatureRaw = data.signatureType ?? data.signature_type;
      const signatureType =
        signatureRaw === 2 || signatureRaw === '2'
          ? 2
          : signatureRaw === 1 || signatureRaw === '1'
            ? 1
            : signatureRaw === 0 || signatureRaw === '0'
              ? 0
              : 0;

      if (!apiKey || !apiSecret || !apiPassphrase) {
        throw new Error('API key generation did not return expected values.');
      }

      onChange({
        apiKey,
        apiSecret,
        apiPassphrase,
        apiAddress: apiAddress || (await signer.getAddress()),
        signatureType,
        walletPrivateKey: normalizedKey,
      });
      return {
        apiKey,
        apiSecret,
        apiPassphrase,
        apiAddress: apiAddress || (await signer.getAddress()),
        signatureType,
        message: `${resultMessage} Signature type: ${signatureType}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate API keys.';
      throw new Error(message);
    }
  };

  const handleExport = async () => {
    try {
      const payload = {
        apiKey: settings.apiKey,
        apiSecret: settings.apiSecret,
        apiPassphrase: settings.apiPassphrase,
        apiAddress: settings.apiAddress,
        signatureType: settings.signatureType,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setApplyStatus('success');
      setApplyMessage('Exported to clipboard (not recommended).');
    } catch {
      setApplyStatus('error');
      setApplyMessage('Failed to export to clipboard.');
    }
  };

  const handleClear = async () => {
    await clearPolymarketSettings();
    onChange({
      apiKey: '',
      apiSecret: '',
      apiPassphrase: '',
      apiAddress: '',
      signatureType: 0,
      liveTradingEnabled: false,
      walletPrivateKey: '',
    });
    setApplyStatus('success');
    setApplyMessage('Local Polymarket settings cleared.');
  };

  const handleTestConnection = async (override?: {
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
    apiAddress: string;
  }): Promise<string> => {
    const key = override?.apiKey?.trim() ?? settings.apiKey?.trim() ?? '';
    const secret = override?.apiSecret?.trim() ?? settings.apiSecret?.trim() ?? '';
    const passphrase = override?.apiPassphrase?.trim() ?? settings.apiPassphrase?.trim() ?? '';
    const address = override?.apiAddress?.trim() ?? settings.apiAddress?.trim() ?? '';

    if (!key || !secret || !passphrase || !address) {
      throw new Error('Fill in API key, secret, passphrase, and address.');
    }

    try {
      const signer = {
        getAddress: async () => address,
      };
      const client = new ClobClient(
        SlotConfig.polymarket.clobHost,
        137,
        signer as unknown as JsonRpcSigner,
        { key, secret, passphrase },
        settings.signatureType,
        undefined,
        undefined,
        true
      );
      const response = await client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      const rawBalance = Number(response?.balance);
      const rawAllowance = Number(response?.allowance);
      const balance = Number.isFinite(rawBalance) ? rawBalance / 1_000_000 : null;
      const allowance = Number.isFinite(rawAllowance) ? rawAllowance / 1_000_000 : null;
      const available = balance === null
        ? allowance
        : allowance === null
          ? balance
          : Math.min(balance, allowance);
      if (available !== null) {
        return `Connected. Available $${available.toFixed(2)}`;
      } else {
        return 'Connected, but balance unavailable.';
      }
    } catch (error) {
      const apiMessage = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const message = apiMessage ?? (error instanceof Error ? error.message : 'Failed to test credentials.');
      throw new Error(message);
    }
  };

  const handleDetectAddresses = async (): Promise<string> => {
    if (!derivedSignerAddress) {
      throw new Error('Enter a valid private key first.');
    }
    try {
      const response = await fetch(
        `/api/polymarket/derived-addresses?owner=${encodeURIComponent(derivedSignerAddress)}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch derived addresses.');
      }
      const data = await response.json();
      const proxy = typeof data?.proxyAddress === 'string' ? data.proxyAddress : null;
      const safe = typeof data?.safeAddress === 'string' ? data.safeAddress : null;
      setDerivedProxy(proxy);
      setDerivedSafe(safe);
      return 'Wallet addresses loaded.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to detect addresses.';
      throw new Error(message);
    }
  };

  const stopPropagation: React.MouseEventHandler<HTMLDivElement> = (event) => {
    event.stopPropagation();
  };

  const handleApply = async () => {
    setApplyStatus('loading');
    setApplyMessage('Applying...');
    try {
      const keyResult = await handleGenerateKeys();
      await handleDetectAddresses();
      const connectionMessage = await handleTestConnection({
        apiKey: keyResult.apiKey,
        apiSecret: keyResult.apiSecret,
        apiPassphrase: keyResult.apiPassphrase,
        apiAddress: keyResult.apiAddress,
      });
      setApplyStatus('success');
      setApplyMessage(connectionMessage || keyResult.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Apply failed.';
      setDerivedProxy(null);
      setDerivedSafe(null);
      setApplyStatus('error');
      setApplyMessage(message);
    }
  };

  const isApplying = applyStatus === 'loading';
  const hasApiKeys = Boolean(
    settings.apiKey.trim() &&
    settings.apiSecret.trim() &&
    settings.apiPassphrase.trim() &&
    settings.apiAddress.trim()
  );

  useEffect(() => {
    if (!open) {
      lastSignatureType.current = settings.signatureType;
      return;
    }

    if (settings.signatureType === lastSignatureType.current) {
      return;
    }

    lastSignatureType.current = settings.signatureType;
    if (!hasApiKeys) {
      return;
    }

    setApplyStatus('loading');
    setApplyMessage('Checking balance...');
    handleTestConnection()
      .then((message) => {
        setApplyStatus('success');
        setApplyMessage(message);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to test credentials.';
        setApplyStatus('error');
        setApplyMessage(message);
      });
  }, [
    open,
    settings.signatureType,
    settings.apiKey,
    settings.apiSecret,
    settings.apiPassphrase,
    settings.apiAddress,
    hasApiKeys,
  ]);

  return (
      <AnimatePresence>
        {open ? (
            <motion.div
                className="settings-modal"
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
            >
              <motion.div
                  className="settings-modal-content"
                  onClick={stopPropagation}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              >
                <div className="settings-modal-header">
                  <div>
                    <div className="settings-title">Polymarket Access</div>
                    <div className="settings-subtitle">Keys are saved locally (encrypted).</div>
                  </div>
                  <button className="settings-close" type="button" onClick={onClose}>
                    ✕
                  </button>
                </div>

                <div className="settings-card danger">
                  <div className="settings-card-header">
                    <div className="settings-card-title">Danger zone</div>
                    <div className="settings-card-subtitle">Read before you paste a key.</div>
                  </div>
                  <div className="settings-warning">
                    If you still want to trade this way, please create a fresh wallet and do not use your primary
                    private keys.
                  </div>
                  <div className="settings-warning">
                    Also, I do not guarantee stability; this feature was added as a joke.
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <div className="settings-card-title">Wallet & keys</div>
                    <div className="settings-card-subtitle">Paste the private key, then apply and select wallet type.</div>
                  </div>

                  <label className="settings-field">
                    <span>PRIVATE KEY</span>
                    <div className="settings-input-row">
                      <input
                        type="password"
                        placeholder="Paste private key (not stored)"
                        value={settings.walletPrivateKey}
                        onChange={(e) => onChange({ walletPrivateKey: e.target.value })}
                      />
                      <button
                        type="button"
                        className="settings-action settings-apply"
                        onClick={handleApply}
                        disabled={isApplying}
                      >
                        {isApplying ? 'Applying...' : 'Apply'}
                      </button>
                    </div>
                    <div className="settings-apply-status">
                      {applyMessage ? (
                        <span className={`settings-helper-status ${applyStatus}`}>
                          {applyMessage}
                        </span>
                      ) : null}
                    </div>
                    <small>Private key stays in memory and is never saved.</small>
                  </label>

                  <label className="settings-field">
                    <span>WALLET TYPE</span>
                    <div className="direction-toggle">
                      <button
                        className={`direction-chip ${settings.signatureType === 0 ? 'active' : ''}`}
                        onClick={() => onChange({ signatureType: 0 })}
                      >
                        Wallet (0)
                      </button>
                      <button
                        className={`direction-chip ${settings.signatureType === 1 ? 'active' : ''}`}
                        onClick={() => onChange({ signatureType: 1 })}
                      >
                        Proxy (1)
                      </button>
                      <button
                        className={`direction-chip ${settings.signatureType === 2 ? 'active' : ''}`}
                        onClick={() => onChange({ signatureType: 2 })}
                      >
                        Gnosis (2)
                      </button>
                    </div>
                    <small>
                      Use Gnosis when your Polymarket balance is held in a Safe. Use Wallet (0) for a normal EOA.
                    </small>
                  </label>

                  <div className="settings-info-grid">
                    {derivedSignerAddress ? (
                      <div className="settings-info">
                        <span>DERIVED SIGNER</span>
                        <div>{derivedSignerAddress}</div>
                      </div>
                    ) : null}
                    {settings.apiAddress ? (
                      <div className="settings-info">
                        <span>API ADDRESS</span>
                        <div>{settings.apiAddress}</div>
                      </div>
                    ) : null}
                    {derivedSignerAddress && derivedProxy ? (
                      <div className="settings-info">
                        <span>PROXY ADDRESS</span>
                        <div>{derivedProxy}</div>
                      </div>
                    ) : null}
                    {derivedSignerAddress && derivedSafe ? (
                      <div className="settings-info">
                        <span>SAFE ADDRESS</span>
                        <div>{derivedSafe}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="settings-modal-actions">
                  <button type="button" className="settings-action secondary" onClick={handleExport}>
                    Export (not recommended)
                  </button>
                  <button type="button" className="settings-action danger" onClick={handleClear}>
                    Delete data
                  </button>
                </div>
              </motion.div>
            </motion.div>
        ) : null}
      </AnimatePresence>
  );
}
