// RFC 6238 TOTP (SHA-1, 30 s step, 6 digits) for scripted MFA sign-ins.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32 = (secret) => {
  const bits = [...secret.replace(/=+$/, '').toUpperCase()]
    .map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  return Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
};

export const totp = (secret, at = Date.now()) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = hmac[19] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0');
};
