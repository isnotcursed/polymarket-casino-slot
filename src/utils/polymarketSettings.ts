import type { UserSettings } from '@/core/domain/types';
import { getEncryptedItem, removeEncryptedItem, setEncryptedItem } from './secureStorage';

type StoredKeys = Pick<
  UserSettings,
  'apiKey' | 'apiSecret' | 'apiPassphrase' | 'apiAddress' | 'signatureType' | 'liveTradingEnabled'
>;

const DEFAULT_SETTINGS: StoredKeys = {
  apiKey: '',
  apiSecret: '',
  apiPassphrase: '',
  apiAddress: '',
  signatureType: 0,
  liveTradingEnabled: false,
};

let cachedSettings: StoredKeys = { ...DEFAULT_SETTINGS };

export const setPolymarketSettings = (patch: Partial<StoredKeys>) => {
  cachedSettings = { ...cachedSettings, ...patch };
};

export const loadPolymarketSettingsFromStorage = async () => {
  const apiKey = await getEncryptedItem('polymarket_api_key');
  const apiSecret = await getEncryptedItem('polymarket_api_secret');
  const apiPassphrase = await getEncryptedItem('polymarket_api_passphrase');
  const apiAddress = await getEncryptedItem('polymarket_api_address');
  const signatureRaw = await getEncryptedItem('polymarket_signature_type');
  const liveRaw = await getEncryptedItem('polymarket_live_mode');
  const signatureType = signatureRaw === '2' ? 2 : signatureRaw === '1' ? 1 : 0;
  const liveTradingEnabled = liveRaw === '1' || liveRaw.toLowerCase() === 'true';

  cachedSettings = {
    apiKey,
    apiSecret,
    apiPassphrase,
    apiAddress,
    signatureType,
    liveTradingEnabled,
  };

  return cachedSettings;
};

export const persistPolymarketSettings = async (settings: StoredKeys) => {
  await setEncryptedItem('polymarket_api_key', settings.apiKey);
  await setEncryptedItem('polymarket_api_secret', settings.apiSecret);
  await setEncryptedItem('polymarket_api_passphrase', settings.apiPassphrase);
  await setEncryptedItem('polymarket_api_address', settings.apiAddress);
  await setEncryptedItem('polymarket_signature_type', String(settings.signatureType));
  await setEncryptedItem('polymarket_live_mode', settings.liveTradingEnabled ? '1' : '0');
};

export const clearPolymarketSettings = async () => {
  removeEncryptedItem('polymarket_api_key');
  removeEncryptedItem('polymarket_api_secret');
  removeEncryptedItem('polymarket_api_passphrase');
  removeEncryptedItem('polymarket_api_address');
  removeEncryptedItem('polymarket_signature_type');
  removeEncryptedItem('polymarket_live_mode');
  cachedSettings = { ...DEFAULT_SETTINGS };
};
