import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PayloadEncryptionService } from '../payload-encryption/payload-encryption.service';
import {
  EncryptedPayloadEnvelope,
  PayloadEncryptionSession,
} from '../payload-encryption/payload-encryption.types';

const VERSION_HEADER = 'X-HM-Encryption-Version';
const SESSION_HEADER = 'X-HM-Session';
const REQUEST_ID_HEADER = 'X-Request-Id';
const IV_HEADER = 'X-HM-Encryption-IV';
const PAYLOAD_HEADER = 'X-HM-Encryption-Payload';
const ENCRYPTED_CONTENT_TYPE = 'application/vnd.hairmela.encrypted+json';

const EXCLUDED_PATHS = [
  '/v1/payload-encryption/handshake',
  '/v1/health',
  '/v1/media/upload',
  '/v1/media/presign-upload',
  '/v1/media/ad-hoc-upload',
  '/v1/payments/webhook',
  '/v1/payments/return',
  '/docs',
  '/docs-json',
];

interface LogicalRequest {
  body?: unknown;
  query?: Record<string, string | string[]>;
}

function apiUrl(requestUrl: string): URL {
  return new URL(requestUrl, window.location.origin);
}

function isExcluded(req: HttpRequest<unknown>): boolean {
  const url = apiUrl(req.urlWithParams);
  const apiOrigin = apiUrl(environment.apiBaseUrl).origin;
  if (url.origin !== apiOrigin) return true;
  if (req.responseType === 'blob' || req.responseType === 'arraybuffer') return true;
  if (/^\/v1\/salons\/slug\/[^/]+\/poster(?:\/|$)/.test(url.pathname)) return true;
  return EXCLUDED_PATHS.some((path) => url.pathname.startsWith(path));
}

function logicalQuery(url: URL): Record<string, string | string[]> | undefined {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  return Object.keys(query).length ? query : undefined;
}

function isEnvelope(value: unknown): value is EncryptedPayloadEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as EncryptedPayloadEnvelope).iv === 'string' &&
    typeof (value as EncryptedPayloadEnvelope).ciphertext === 'string'
  );
}

async function encryptedRequest(
  req: HttpRequest<unknown>,
  encryption: PayloadEncryptionService,
  session: PayloadEncryptionSession,
): Promise<{
  request: HttpRequest<unknown>;
  requestId: string;
  path: string;
}> {
  const url = apiUrl(req.urlWithParams);
  const path = url.pathname;
  const requestId = crypto.randomUUID();
  const logical: LogicalRequest = {};
  if (req.body !== null && req.body !== undefined) logical.body = req.body;
  const query = logicalQuery(url);
  if (query) logical.query = query;
  const envelope = await encryption.encryptHttp(logical, session, requestId, req.method, path);
  const usesHeaderEnvelope = req.method === 'GET' || req.method === 'HEAD';
  url.search = '';
  return {
    request: req.clone({
      url: url.toString(),
      params: req.params.keys().reduce((params, key) => params.delete(key), req.params),
      body: usesHeaderEnvelope ? null : envelope,
      responseType: 'json',
      setHeaders: {
        [VERSION_HEADER]: '1',
        [SESSION_HEADER]: session.ticket,
        [REQUEST_ID_HEADER]: requestId,
        ...(usesHeaderEnvelope
          ? {
              [IV_HEADER]: envelope.iv,
              [PAYLOAD_HEADER]: envelope.ciphertext,
            }
          : { 'Content-Type': ENCRYPTED_CONTENT_TYPE }),
      },
    }),
    requestId,
    path,
  };
}

function decryptResponse(
  response: HttpResponse<unknown>,
  encryption: PayloadEncryptionService,
  session: PayloadEncryptionSession,
  requestId: string,
  method: string,
  path: string,
): Observable<HttpResponse<unknown>> {
  if (response.status === 204 || response.body === null) return from([response]);
  if (!isEnvelope(response.body)) {
    return throwError(() => new Error('The API returned an unencrypted response.'));
  }
  return from(
    encryption.decryptHttp<unknown>(
      response.body,
      session,
      requestId,
      method,
      path,
      response.status,
    ),
  ).pipe(
    map((body) => {
      encryption.adoptAuthTicket(body);
      return response.clone({ body });
    }),
  );
}

function decryptError(
  error: unknown,
  encryption: PayloadEncryptionService,
  session: PayloadEncryptionSession,
  requestId: string,
  method: string,
  path: string,
): Observable<never> {
  if (!(error instanceof HttpErrorResponse) || !isEnvelope(error.error)) {
    return throwError(() => error);
  }
  return from(
    encryption.decryptHttp<unknown>(error.error, session, requestId, method, path, error.status),
  ).pipe(
    switchMap((decrypted) =>
      throwError(
        () =>
          new HttpErrorResponse({
            error: decrypted,
            headers: error.headers,
            status: error.status,
            statusText: error.statusText,
            url: error.url ?? undefined,
          }),
      ),
    ),
  );
}

function sendEncrypted(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  encryption: PayloadEncryptionService,
  session: PayloadEncryptionSession,
): Observable<HttpEvent<unknown>> {
  return from(encryptedRequest(req, encryption, session)).pipe(
    switchMap(({ request, requestId, path }) =>
      next(request).pipe(
        switchMap((event) =>
          event instanceof HttpResponse
            ? decryptResponse(event, encryption, session, requestId, req.method, path)
            : from([event]),
        ),
        catchError((error) =>
          decryptError(error, encryption, session, requestId, req.method, path),
        ),
      ),
    ),
  );
}

function sendWithRenewal(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  encryption: PayloadEncryptionService,
  session: PayloadEncryptionSession,
  alreadyRenewed = false,
): Observable<HttpEvent<unknown>> {
  return sendEncrypted(req, next, encryption, session).pipe(
    catchError((error) => {
      const code = (error as { error?: { code?: unknown } })?.error?.code;
      if (alreadyRenewed || code !== 'ENCRYPTION_SESSION_EXPIRED') {
        return throwError(() => error);
      }
      encryption.invalidate();
      return from(encryption.ensureSession()).pipe(
        switchMap((renewed) =>
          renewed ? sendWithRenewal(req, next, encryption, renewed, true) : next(req),
        ),
      );
    }),
  );
}

export const payloadEncryptionInterceptor: HttpInterceptorFn = (req, next) => {
  const encryption = inject(PayloadEncryptionService);
  if (!encryption.enabled || isExcluded(req)) return next(req);

  return from(encryption.ensureSession()).pipe(
    switchMap((session) => (session ? sendWithRenewal(req, next, encryption, session) : next(req))),
  );
};
