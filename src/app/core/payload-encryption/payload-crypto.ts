import {
  EncryptedPayloadEnvelope,
  PayloadEncryptionSession,
  PayloadKeyDirection,
} from './payload-encryption.types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createClientKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKey: string;
}> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  return {
    privateKey: keys.privateKey,
    publicKey: base64UrlEncode(await crypto.subtle.exportKey('raw', keys.publicKey)),
  };
}

export async function deriveSessionKeys(
  privateKey: CryptoKey,
  serverPublicKey: string,
  salt: string,
): Promise<Record<PayloadKeyDirection, CryptoKey>> {
  const serverKey = await crypto.subtle.importKey(
    'raw',
    base64UrlDecode(serverPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const directions: PayloadKeyDirection[] = ['http-c2s', 'http-s2c', 'socket-c2s', 'socket-s2c'];
  const entries = await Promise.all(
    directions.map(
      async (direction) =>
        [
          direction,
          await crypto.subtle.deriveKey(
            {
              name: 'HKDF',
              hash: 'SHA-256',
              salt: base64UrlDecode(salt),
              info: encoder.encode(`hairmela:payload:v1:${direction}`),
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
          ),
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<PayloadKeyDirection, CryptoKey>;
}

function aad(
  session: PayloadEncryptionSession,
  requestId: string,
  method: string,
  path: string,
  direction: PayloadKeyDirection,
  statusCode?: number,
): ArrayBuffer {
  return encoder.encode(
    JSON.stringify([
      1,
      session.sessionId,
      requestId,
      method.toUpperCase(),
      path,
      direction,
      statusCode ?? null,
    ]),
  ).buffer as ArrayBuffer;
}

export async function encryptPayload(
  value: unknown,
  session: PayloadEncryptionSession,
  requestId: string,
  method: string,
  path: string,
  direction: PayloadKeyDirection,
  statusCode?: number,
): Promise<EncryptedPayloadEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad(session, requestId, method, path, direction, statusCode),
      tagLength: 128,
    },
    session.keys[direction],
    encoder.encode(JSON.stringify(value)),
  );
  return { iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(ciphertext) };
}

export async function decryptPayload<T>(
  envelope: EncryptedPayloadEnvelope,
  session: PayloadEncryptionSession,
  requestId: string,
  method: string,
  path: string,
  direction: PayloadKeyDirection,
  statusCode?: number,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlDecode(envelope.iv),
      additionalData: aad(session, requestId, method, path, direction, statusCode),
      tagLength: 128,
    },
    session.keys[direction],
    base64UrlDecode(envelope.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}
