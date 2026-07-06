import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Media } from '../../../api/models/media';
import { publicMediaControllerGetStaffMedia } from '../../../api/fn/media/public-media-controller-get-staff-media';
import { mediaControllerUpload } from '../../../api/fn/media/media-controller-upload';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService, ReadToken } from '../../../core/optimistic/optimistic.service';

@Injectable({ providedIn: 'root' })
export class StaffMediaService {
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

  load(staffId: string): void {
    const token = this._optimistic.beginRead(this._media, staffId);
    const cached = this._cache.get(staffId);
    if (cached) {
      this._optimistic.commitRead(this._media, cached, token, (v) => this._cache.set(staffId, v));
      return;
    }
    if (this._inflight.has(staffId)) return;
    this._fetch(staffId, token);
  }

  refresh(staffId: string): void {
    const token = this._optimistic.beginRead(this._media, staffId);
    this._cache.delete(staffId);
    this._fetch(staffId, token);
  }

  upload(staffId: string, file: File, onSuccess?: () => void): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const blobUrl = URL.createObjectURL(file);
    const optimisticTile = { id: tempId, url: blobUrl, pending: true } as Media & {
      pending?: boolean;
    };
    this._optimistic.run({
      signal: this._media,
      // apply is REPLAYED on every recompute (e.g. a concurrent load()'s
      // commitRead landing while this upload is still pending) — must be
      // idempotent or a replay duplicates the tile. Guard by tempId.
      apply: (list) => (list.some((m) => m.id === tempId) ? list : [...list, optimisticTile]),
      reconcile: (list, res) => list.map((m) => (m.id === tempId ? res.body : m)),
      tempId,
      dedupeKey: `StaffMediaService.upload:${staffId}:${file.name}:${file.size}:${file.lastModified}`,
      mirror: (v) => this._cache.set(staffId, v),
      contextKey: staffId,
      request: () =>
        mediaControllerUpload(this._http, this._apiConfig.rootUrl, {
          body: { file, entityType: 'STAFF', entityId: staffId, type: 'GALLERY' },
        }),
      errorMessage: 'Upload failed. Removed.',
      onSuccess: () => onSuccess?.(),
      onSettled: () => URL.revokeObjectURL(blobUrl),
    });
  }

  delete(staffId: string, mediaId: string, onSuccess?: () => void): void {
    if (this._optimistic.isPending(mediaId)) return;
    this._optimistic.run({
      signal: this._media,
      apply: (list) => list.filter((m) => m.id !== mediaId),
      mirror: (v) => this._cache.set(staffId, v),
      contextKey: staffId,
      dedupeKey: `delete-media:${staffId}:${mediaId}`,
      request: () => mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: mediaId }),
      errorMessage: 'Could not delete image. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  clear(): void {
    this._cache.clear();
    this._media.set([]);
  }

  /** Apply a client-side patch without an API call (API already completed in a child component). */
  patchMedia(staffId: string, updater: (list: Media[]) => Media[]): void {
    this._optimistic.run({
      signal: this._media,
      apply: updater,
      mirror: (v) => this._cache.set(staffId, v),
      contextKey: staffId,
      dedupeKey: `patch-media:${staffId}:${crypto.randomUUID()}`,
      request: () => of(null),
    });
  }

  private _fetch(staffId: string, token: ReadToken): void {
    this._inflight.add(staffId);
    this._loading.set(true);
    this._error.set(false);
    publicMediaControllerGetStaffMedia(this._http, this._apiConfig.rootUrl, { entityId: staffId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight.delete(staffId);
          this._cache.set(staffId, res.body);
          this._optimistic.commitRead(this._media, res.body, token, (v) =>
            this._cache.set(staffId, v),
          );
          this._loading.set(false);
        },
        error: () => {
          this._inflight.delete(staffId);
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
