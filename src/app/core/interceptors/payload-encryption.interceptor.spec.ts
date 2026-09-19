import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { payloadEncryptionInterceptor } from './payload-encryption.interceptor';
import { PayloadEncryptionService } from '../payload-encryption/payload-encryption.service';
import { PayloadEncryptionSession } from '../payload-encryption/payload-encryption.types';

describe('payloadEncryptionInterceptor request transport', () => {
  const session = {
    sessionId: 'session-id',
    ticket: 'opaque-ticket',
    expiresAt: Date.now() + 60_000,
    keys: {},
  } as PayloadEncryptionSession;
  const encryption = {
    enabled: true,
    ensureSession: async () => session,
    invalidate: vi.fn(),
    encryptHttp: vi.fn(async () => ({ iv: 'header-iv', ciphertext: 'header-ciphertext' })),
    decryptHttp: vi.fn(async () => ({ ok: true })),
    adoptAuthTicket: vi.fn(),
  };

  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    encryption.encryptHttp.mockClear();
    encryption.decryptHttp.mockClear();
    encryption.adoptAuthTicket.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([payloadEncryptionInterceptor])),
        provideHttpClientTesting(),
        { provide: PayloadEncryptionService, useValue: encryption },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('moves a GET query and encrypted envelope into headers with no body', async () => {
    const response = firstValueFrom(
      http.get<{ ok: boolean }>('http://localhost:3000/v1/salons?page=1&limit=18'),
    );
    await new Promise((resolve) => setTimeout(resolve));

    const request = controller.expectOne('http://localhost:3000/v1/salons');
    expect(request.request.body).toBeNull();
    expect(request.request.headers.get('X-HM-Encryption-IV')).toBe('header-iv');
    expect(request.request.headers.get('X-HM-Encryption-Payload')).toBe('header-ciphertext');
    expect(encryption.encryptHttp).toHaveBeenCalledWith(
      { query: { page: '1', limit: '18' } },
      session,
      expect.any(String),
      'GET',
      '/v1/salons',
    );
    request.flush({ iv: 'response-iv', ciphertext: 'response-ciphertext' });

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('keeps a POST encrypted envelope in the request body', async () => {
    const response = firstValueFrom(
      http.post<{ ok: boolean }>('http://localhost:3000/v1/salons', { name: 'Salon' }),
    );
    await new Promise((resolve) => setTimeout(resolve));

    const request = controller.expectOne('http://localhost:3000/v1/salons');
    expect(request.request.body).toEqual({
      iv: 'header-iv',
      ciphertext: 'header-ciphertext',
    });
    expect(request.request.headers.has('X-HM-Encryption-IV')).toBe(false);
    expect(request.request.headers.get('Content-Type')).toBe(
      'application/vnd.hairmela.encrypted+json',
    );
    request.flush({ iv: 'response-iv', ciphertext: 'response-ciphertext' });

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('leaves the public presign upload request plaintext', async () => {
    const body = {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
      entityType: 'USER',
      entityId: '5fe60392-2b86-4579-8ea1-ce9570548376',
      type: 'PROFILE',
    };

    http.post('http://localhost:3000/v1/media/presign-upload', body).subscribe();

    const request = controller.expectOne('http://localhost:3000/v1/media/presign-upload');
    expect(request.request.body).toEqual(body);
    expect(request.request.headers.has('X-HM-Encryption-Version')).toBe(false);
    expect(encryption.encryptHttp).not.toHaveBeenCalled();
    request.flush({ uploadUrl: 'https://r2.example/upload' });
  });

  it.each([
    ['POST', '/v1/payload-encryption/handshake'],
    ['GET', '/v1/health/ready'],
    ['POST', '/v1/media/upload'],
    ['POST', '/v1/media/presign-upload'],
    ['POST', '/v1/media/ad-hoc-upload'],
    ['POST', '/v1/payments/webhook/flutterwave'],
    ['GET', '/v1/payments/return/5fe60392-2b86-4579-8ea1-ce9570548376'],
    ['GET', '/v1/salons/slug/example/poster'],
    ['GET', '/docs'],
    ['GET', '/docs-json'],
  ])('does not encrypt %s %s', (method, path) => {
    const url = `http://localhost:3000${path}`;

    http.request(method, url, { body: { marker: true } }).subscribe();

    const request = controller.expectOne(url);
    expect(request.request.body).toEqual({ marker: true });
    expect(request.request.headers.has('X-HM-Encryption-Version')).toBe(false);
    expect(encryption.encryptHttp).not.toHaveBeenCalled();
    request.flush({});
  });

  it('does not encrypt direct requests to a different origin such as R2', () => {
    const url = 'https://example.r2.cloudflarestorage.com/signed-object';

    http.put(url, new Blob()).subscribe();

    const request = controller.expectOne(url);
    expect(request.request.headers.has('X-HM-Encryption-Version')).toBe(false);
    expect(encryption.encryptHttp).not.toHaveBeenCalled();
    request.flush('');
  });
});
