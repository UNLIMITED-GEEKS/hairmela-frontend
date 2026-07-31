import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Media } from '../../../api/models/media';
import { ReorderMediaDto } from '../../../api/models/reorder-media-dto';
import { publicMediaControllerGetSalonMedia } from '../../../api/fn/media/public-media-controller-get-salon-media';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { uploadMedia } from '../../../core/media/upload-media';
import { mediaReorderControllerReorderSalonGallery } from '../../../api/fn/media/media-reorder-controller-reorder-salon-gallery';
import { ToastService } from '../../../core/toast/toast.service';
import { OptimisticService } from '../../../core/caching/optimistic/optimistic.service';
import { CachedLoader } from '../../../core/caching/optimistic/cached-loader';

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

  private readonly _loader = new CachedLoader({
    signal: this._media,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (salonId) =>
      publicMediaControllerGetSalonMedia(this._http, this._apiConfig.rootUrl, {
        entityId: salonId,
      }).pipe(map((r) => r.body)),
  });

  readonly media = this._media.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  load(salonId: string): void {
    this._loader.load(salonId);
  }

  refresh(salonId: string): void {
    this._loader.refresh(salonId);
  }

  upload(
    salonId: string,
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
      reconcile: (list, res) => list.map((m) => (m.id === tempId ? res.body : m)),
      tempId,
      dedupeKey: `SalonMediaService.upload:${salonId}:${file.name}:${file.size}:${file.lastModified}`,
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      request: () =>
        uploadMedia(this._http, this._apiConfig.rootUrl, {
          file,
          entityType: 'SALON',
          entityId: salonId,
          type: mediaType,
        }),
      errorMessage: 'Upload failed. Removed.',
      onSuccess: () => onSuccess?.(),
      onSettled: () => URL.revokeObjectURL(blobUrl),
    });
  }

  delete(salonId: string, mediaId: string, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._media,
      dedupeKey: `SalonMediaService.delete:${mediaId}`,
      apply: (list) => list.filter((m) => m.id !== mediaId),
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      targetId: mediaId,
      request: () => mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: mediaId }),
      errorMessage: 'Could not delete image. Restored.',
      onSuccess: () => onSuccess?.(),
    });
  }

  reorder(salonId: string, body: ReorderMediaDto, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._media,
      dedupeKey: `SalonMediaService.reorder:${salonId}`,
      apply: (list) => {
        const idxMap = new Map(body.orderedIds.map((id, i) => [id, i]));
        return [...list].sort(
          (a, b) => (idxMap.get(a.id) ?? Infinity) - (idxMap.get(b.id) ?? Infinity),
        );
      },
      mirror: this._loader.mirrorFn(salonId),
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
    this._optimistic.reset(this._media, []);
  }

  patchMedia(salonId: string, updater: (list: Media[]) => Media[]): void {
    this._optimistic.run({
      signal: this._media,
      dedupeKey: `SalonMediaService.patchMedia:${salonId}:${crypto.randomUUID()}`,
      apply: updater,
      mirror: this._loader.mirrorFn(salonId),
      contextKey: salonId,
      request: () => of(null),
    });
  }
}
