import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Media } from '../../../api/models/media';
import { publicMediaControllerGetStaffMedia } from '../../../api/fn/media/public-media-controller-get-staff-media';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { uploadMedia } from '../../../core/media/media-upload';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService } from '../../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/caching/optimistic/cached-loader';

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

  private readonly _loader = new CachedLoader({
    signal: this._media,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (staffId) =>
      publicMediaControllerGetStaffMedia(this._http, this._apiConfig.rootUrl, {
        entityId: staffId,
      }).pipe(map((r) => r.body)),
  });

  readonly media = this._media.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  load(staffId: string): void {
    this._loader.load(staffId);
  }

  refresh(staffId: string): void {
    this._loader.refresh(staffId);
  }

  upload(
    staffId: string,
    file: File,
    mediaType: 'PROFILE' | 'GALLERY',
    onSuccess?: () => void,
  ): void {
    const tempId = `temp_${crypto.randomUUID()}`;
    const blobUrl = URL.createObjectURL(file);
    const optimisticTile = { id: tempId, url: blobUrl, type: mediaType, pending: true } as Media & {
      pending?: boolean;
    };
    this._optimistic.run({
      signal: this._media,
      // apply is REPLAYED on every recompute (e.g. a concurrent load()'s
      // commitRead landing while this upload is still pending) — must be
      // idempotent or a replay duplicates the tile. Guard by tempId.
      // PROFILE replaces any existing profile tile (same semantics as the
      // old patchMedia-based onProfileUploaded); GALLERY only appends.
      apply: (list) => {
        if (list.some((m) => m.id === tempId)) return list;
        return mediaType === 'PROFILE'
          ? [optimisticTile, ...list.filter((m) => m.type !== 'PROFILE')]
          : [...list, optimisticTile];
      },
      reconcile: (list, res) => list.map((m) => (m.id === tempId ? res : m)),
      tempId,
      dedupeKey: `StaffMediaService.upload:${staffId}:${file.name}:${file.size}:${file.lastModified}`,
      mirror: this._loader.mirrorFn(staffId),
      contextKey: staffId,
      request: () =>
        uploadMedia(this._http, this._apiConfig, {
          file,
          entityType: 'STAFF',
          entityId: staffId,
          type: mediaType,
        }),
      errorMessage: 'Upload failed. Removed.',
      onSuccess: () => onSuccess?.(),
      onSettled: () => URL.revokeObjectURL(blobUrl),
    });
  }

  delete(staffId: string, mediaId: string, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._media,
      apply: (list) => list.filter((m) => m.id !== mediaId),
      mirror: this._loader.mirrorFn(staffId),
      contextKey: staffId,
      targetId: mediaId,
      dedupeKey: `StaffMediaService.delete:${staffId}:${mediaId}`,
      request: () => mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: mediaId }),
      errorMessage: 'Could not delete image. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._media, []);
  }

  /** Apply a client-side patch without an API call (API already completed in a child component). */
  patchMedia(staffId: string, updater: (list: Media[]) => Media[]): void {
    this._optimistic.run({
      signal: this._media,
      apply: updater,
      mirror: this._loader.mirrorFn(staffId),
      contextKey: staffId,
      dedupeKey: `StaffMediaService.patchMedia:${staffId}:${crypto.randomUUID()}`,
      request: () => of(null),
    });
  }
}
