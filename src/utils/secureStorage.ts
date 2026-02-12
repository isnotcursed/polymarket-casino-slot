/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

const KEY_STORAGE = 'polymarket_storage_key';
const ENC_PREFIX = 'enc:';

let cachedKey: Promise<CryptoKey> | null = null;

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getOrCreateKeyBytes = () => {
  if (typeof localStorage === 'undefined') {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  const existing = localStorage.getItem(KEY_STORAGE);
  if (existing) {
    return fromBase64(existing);
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(KEY_STORAGE, toBase64(bytes));
  return bytes;
};

const getCryptoKey = () => {
  if (!cachedKey) {
    const bytes = getOrCreateKeyBytes();
    cachedKey = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  return cachedKey;
};

export const encryptValue = async (value: string) => {
  if (!value) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getCryptoKey();
  const encoded = new TextEncoder().encode(value);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return `${ENC_PREFIX}${toBase64(combined)}`;
};

export const decryptValue = async (stored: string) => {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored;

  try {
    const payload = stored.slice(ENC_PREFIX.length);
    const bytes = fromBase64(payload);
    if (bytes.length <= 12) return '';
    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const key = await getCryptoKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
};

export const setEncryptedItem = async (key: string, value: string) => {
  if (typeof localStorage === 'undefined') return;
  if (!value) {
    localStorage.removeItem(key);
    return;
  }
  const encrypted = await encryptValue(value);
  localStorage.setItem(key, encrypted);
};

export const getEncryptedItem = async (key: string) => {
  if (typeof localStorage === 'undefined') return '';
  const stored = localStorage.getItem(key) ?? '';
  return decryptValue(stored);
};

export const removeEncryptedItem = (key: string) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
};
