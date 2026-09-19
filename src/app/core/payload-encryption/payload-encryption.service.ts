import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenStore } from '../auth/token.store';
import {
  createClientKeyPair,
  decryptPayload,
  deriveSessionKeys,
  encryptPayload,
} from './payload-crypto';
import {
  EncryptedPayloadEnvelope,
  EncryptedSocketEnvelope,
  PayloadAuthTicketResponse,
  PayloadEncryptionClientMode,
  PayloadEncryptionHandshakeResponse,
  PayloadEncryptionSession,
} from './payload-encryption.types';

const RENEW_BEFORE_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class PayloadEncryptionService {
  private readonly _http = new HttpClient(inject(HttpBackend));
  private readonly _tokenStore = inject(TokenStore);
  private readonly _sessionChanged = new Subject<void>();

  private _session: PayloadEncryptionSession | null = null;
  private _pending: Promise<PayloadEncryptionSession | null> | null = null;
  private _backendDisabled = false;

  readonly sessionChanged$ = this._sessionChanged.asObservable();

  get enabled(): boolean {
    return this._mode !== 'off';
  }

  async ensureSession(): Promise<PayloadEncryptionSession | null> {
    if (!this.enabled || this._backendDisabled) return null;
    if (this._session && this._session.expiresAt - Date.now() > RENEW_BEFORE_MS) {
      return this._session;
    }
    if (!this._pending) {
      this._pending = this._handshake().finally(() => {
        this._pending = null;
      });
    }
    return this._pending;
  }

  currentSession(): PayloadEncryptionSession | null {
    return this._session;
  }

  hasUsableSession(): boolean {
    return !!this._session && this._session.expiresAt - Date.now() > RENEW_BEFORE_MS;
  }

  socketSessionIsCurrent(): boolean {
    return !this.enabled || this._backendDisabled || this.hasUsableSession();
  }

  invalidate(): void {
    this._session = null;
  }

  clear(): void {
    this._session = null;
    this._pending = null;
    this._backendDisabled = false;
  }

  adoptAuthTicket(value: unknown): void {
    if (!this._session || !value || typeof value !== 'object') return;
    const response = value as PayloadAuthTicketResponse;
    if (!response.payloadEncryptionTicket || !response.payloadEncryptionExpiresAt) return;
    const expiresAt = Date.parse(response.payloadEncryptionExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    this._session = {
      ...this._session,
      ticket: response.payloadEncryptionTicket,
      expiresAt,
    };
    this._sessionChanged.next();
  }

  encryptHttp(
    value: unknown,
    session: PayloadEncryptionSession,
    requestId: string,
    method: string,
    path: string,
  ): Promise<EncryptedPayloadEnvelope> {
    return encryptPayload(value, session, requestId, method, path, 'http-c2s');
  }

  decryptHttp<T>(
    envelope: EncryptedPayloadEnvelope,
    session: PayloadEncryptionSession,
    requestId: string,
    method: string,
    path: string,
    status: number,
  ): Promise<T> {
    return decryptPayload<T>(envelope, session, requestId, method, path, 'http-s2c', status);
  }

  async encryptSocket(event: string, value: unknown): Promise<EncryptedSocketEnvelope | null> {
    const session = await this.ensureSession();
    if (!session) return null;
    const requestId = crypto.randomUUID();
    return {
      requestId,
      ...(await encryptPayload(value, session, requestId, 'SOCKET', event, 'socket-c2s')),
    };
  }

  async decryptSocket<T>(event: string, envelope: EncryptedSocketEnvelope): Promise<T> {
    const session = this._session;
    if (!session) throw new Error('No payload-encryption session is active.');
    return decryptPayload<T>(envelope, session, envelope.requestId, 'SOCKET', event, 'socket-s2c');
  }

  private async _handshake(): Promise<PayloadEncryptionSession | null> {
    const client = await createClientKeyPair();
    try {
      const accessToken = this._tokenStore.getAccessToken();
      let response: PayloadEncryptionHandshakeResponse;
      try {
        response = await this._requestHandshake(client.publicKey, accessToken);
      } catch (error) {
        // A locally unexpired token can still have been revoked server-side.
        // Establish an anonymous transport so the actual API request can reach
        // the normal auth interceptor and refresh/logout path.
        if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !accessToken) {
          throw error;
        }
        response = await this._requestHandshake(client.publicKey, null);
      }
      const expiresAt = Date.parse(response.expiresAt);
      if (response.protocolVersion !== 1 || !Number.isFinite(expiresAt)) {
        throw new Error('Invalid payload-encryption handshake response.');
      }
      const session: PayloadEncryptionSession = {
        sessionId: response.sessionId,
        ticket: response.ticket,
        expiresAt,
        keys: await deriveSessionKeys(client.privateKey, response.serverPublicKey, response.salt),
      };
      this._session = session;
      this._sessionChanged.next();
      return session;
    } catch (error) {
      if (this._mode === 'optional' && error instanceof HttpErrorResponse && error.status === 503) {
        this._backendDisabled = true;
        return null;
      }
      throw error;
    }
  }

  private get _mode(): PayloadEncryptionClientMode {
    return environment.payloadEncryptionMode as PayloadEncryptionClientMode;
  }

  private _requestHandshake(
    clientPublicKey: string,
    accessToken: string | null,
  ): Promise<PayloadEncryptionHandshakeResponse> {
    return firstValueFrom(
      this._http.post<PayloadEncryptionHandshakeResponse>(
        `${environment.apiBaseUrl}/v1/payload-encryption/handshake`,
        { protocolVersion: 1, clientPublicKey },
        { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
      ),
    );
  }
}
