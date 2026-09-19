export type PayloadEncryptionClientMode = 'off' | 'optional' | 'required';

export type PayloadKeyDirection = 'http-c2s' | 'http-s2c' | 'socket-c2s' | 'socket-s2c';

export interface EncryptedPayloadEnvelope {
  iv: string;
  ciphertext: string;
}

export interface EncryptedSocketEnvelope extends EncryptedPayloadEnvelope {
  requestId: string;
}

export interface PayloadEncryptionHandshakeResponse {
  protocolVersion: 1;
  sessionId: string;
  serverPublicKey: string;
  salt: string;
  ticket: string;
  expiresAt: string;
}

export interface PayloadAuthTicketResponse {
  payloadEncryptionTicket?: string;
  payloadEncryptionExpiresAt?: string;
}

export interface PayloadEncryptionSession {
  sessionId: string;
  ticket: string;
  expiresAt: number;
  keys: Record<PayloadKeyDirection, CryptoKey>;
}
