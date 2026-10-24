// Envelope encryption (VA-02): a random per-record data key encrypts the JSON payload with
// AES-256-GCM; the versioned master key (KEK) wraps the data key with AES-256-GCM.
// Sealed layout: [versionLength][version][dekIv 12][dekTag 16][wrappedDek 32][iv 12][tag 16][ciphertext].
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV = 12;
const TAG = 16;
const KEY = 32;

// "v1:<base64 32 bytes>,v2:<base64 32 bytes>" -> Map(version -> Buffer)
export function parseMasterKeys(value) {
  const keys = new Map();
  for (const entry of (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = entry.indexOf(':');
    const version = entry.slice(0, i);
    const key = Buffer.from(entry.slice(i + 1), 'base64');
    if (i < 1 || key.length !== KEY) throw new Error(`HUB_MASTER_KEYS: entry "${version || entry.slice(0, 8)}…" must be <version>:<base64 of 32 bytes>`);
    keys.set(version, key);
  }
  if (!keys.size) throw new Error('HUB_MASTER_KEYS: no keys');
  return keys;
}

const gcm = (key, iv, data, aad) => {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  return { body: Buffer.concat([cipher.update(data), cipher.final()]), tag: cipher.getAuthTag() };
};
const ungcm = (key, iv, tag, data, aad) => {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
};

// `aad` binds a sealed value to its row (e.g. "default|sessions|<id>"); a mismatch fails to open.
export function createVault({ keys, current }) {
  if (!keys.has(current)) throw new Error(`HUB_MASTER_KEY_CURRENT "${current}" is not in HUB_MASTER_KEYS`);

  const seal = (value, aad) => {
    const aadBuf = Buffer.from(aad);
    const dek = randomBytes(KEY);
    const dekIv = randomBytes(IV);
    const wrapped = gcm(keys.get(current), dekIv, dek, aadBuf);
    const iv = randomBytes(IV);
    const payload = gcm(dek, iv, Buffer.from(JSON.stringify(value)), aadBuf);
    const version = Buffer.from(current);
    return Buffer.concat([Buffer.from([version.length]), version, dekIv, wrapped.tag, wrapped.body, iv, payload.tag, payload.body]);
  };

  const versionOf = (sealed) => sealed.subarray(1, 1 + sealed[0]).toString();

  const open = (sealed, aad) => {
    const version = versionOf(sealed);
    const kek = keys.get(version);
    if (!kek) throw new Error(`vault: master key version "${version}" is not loaded`);
    const aadBuf = Buffer.from(aad);
    let at = 1 + sealed[0];
    const take = (n) => sealed.subarray(at, (at += n));
    const dekIv = take(IV);
    const dekTag = take(TAG);
    const wrappedDek = take(KEY);
    const iv = take(IV);
    const tag = take(TAG);
    const dek = ungcm(kek, dekIv, dekTag, wrappedDek, aadBuf);
    return JSON.parse(ungcm(dek, iv, tag, sealed.subarray(at), aadBuf).toString());
  };

  return { current, seal, open, versionOf };
}
