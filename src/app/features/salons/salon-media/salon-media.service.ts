import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { of, retry } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Media } from '../../../api/models/media';
import { ReorderMediaDto } from '../../../api/models/reorder-media-dto';
import { publicMediaControllerGetSalonMedia } from '../../../api/fn/media/public-media-controller-get-salon-media';
import { mediaControllerUpload } from '../../../api/fn/media/media-controller-upload';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { mediaReorderControllerReorderSalonGallery } from '../../../api/fn/media/media-reorder-controller-reorder-salon-gallery';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService, ReadToken } from '../../../core/optimistic/optimistic.service';

@Injectable({ providedIn: 'root' })
export class SalonMediaService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, Media[]>();
  private readonly _media = signal<Media[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = new Set<string>();

  readonly media = this._media.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(salonId: string): void {
    const token = this._optimistic.beginRead(this._media, salonId);
    const cached = this._cache.get(salonId);
    if (cached) {
      this._optimistic.commitRead(this._media, cached, token, (v) => this._cache.set(salonId, v));
      return;
    }
    if (this._inflight.has(salonId)) return;
    this._fetch(salonId, token);
  }

  refresh(salonId: string): void {
    const token = this._optimistic.beginRead(this._media, salonId);
    this._cache.delete(salonId);
    this._fetch(salonId, token);
  }

  upload(salonId: string, file: File, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const blobUrl = URL.createObjectURL(file);
    const optimisticTile = { id: tempId, url: blobUrl, pending: true } as Media & {
      pending?: boolean;
    };
    this._optimistic.run({
      signal: this._media,
      apply: (list) => [...list, optimisticTile],
      reconcile: (list, res) => list.map((m) => (m.id === tempId ? res.body : m)),
      tempId,
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () =>
        mediaControllerUpload(this._http, this._apiConfig.rootUrl, {
          body: { file, entityType: 'SALON', entityId: salonId, type: 'GALLERY' },
        }),
      errorMessage: 'Upload failed. Removed.',
      onSuccess: () => onSuccess?.(),
      onSettled: () => URL.revokeObjectURL(blobUrl),
    });
  }

  delete(salonId: string, mediaId: string, onSuccess?: () => void): void {
    if (this._optimistic.isPending(mediaId)) return;
    this._optimistic.run({
      signal: this._media,
      apply: (list) => list.filter((m) => m.id !== mediaId),
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () => mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: mediaId }),
      errorMessage: 'Could not delete image. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  reorder(salonId: string, body: ReorderMediaDto, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._media,
      apply: (list) => {
        const idxMap = new Map(body.orderedIds.map((id, i) => [id, i]));
        return [...list].sort(
          (a, b) => (idxMap.get(a.id) ?? Infinity) - (idxMap.get(b.id) ?? Infinity),
        );
      },
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () =>
        mediaReorderControllerReorderSalonGallery(this._http, this._apiConfig.rootUrl, {
          salonId,
          body,
        }),
      errorMessage: 'Could not save order. Reverted.',
      onSuccess: () => onSuccess?.(),
    });
  }

  clear(): void {
    this._cache.clear();
    this._media.set([]);
  }

  /** Apply a client-side patch without an API call (API already completed in a child component). */
  patchMedia(salonId: string, updater: (list: Media[]) => Media[]): void {
    this._optimistic.run({
      signal: this._media,
      apply: updater,
      mirror: (v) => this._cache.set(salonId, v),
      contextKey: salonId,
      request: () => of(null),
    });
  }

  private _fetch(salonId: string, token: ReadToken): void {
    this._inflight.add(salonId);
    this._loading.set(true);
    this._error.set(false);
    publicMediaControllerGetSalonMedia(this._http, this._apiConfig.rootUrl, { entityId: salonId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(salonId);
          this._cache.set(salonId, res.body);
          this._optimistic.commitRead(this._media, res.body, token, (v) =>
            this._cache.set(salonId, v),
          );
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(salonId);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
