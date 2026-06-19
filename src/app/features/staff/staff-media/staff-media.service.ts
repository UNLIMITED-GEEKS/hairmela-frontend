import { CacheRegistry } from '../../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Media } from '../../../api/models/media';
import { publicMediaControllerGetStaffMedia } from '../../../api/fn/media/public-media-controller-get-staff-media';
import { mediaControllerUpload } from '../../../api/fn/media/media-controller-upload';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { ToastService } from '../../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class StaffMediaService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);

  constructor() { this._cacheRegistry.register(this); }

  private readonly _cache = new Map<string, Media[]>();
  private readonly _media = signal<Media[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  readonly media = this._media.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();

  load(staffId: string): void {
    const cached = this._cache.get(staffId);
    if (cached) { this._media.set(cached); return; }
    this._fetch(staffId);
  }

  refresh(staffId: string): void {
    this._cache.delete(staffId);
    this._fetch(staffId);
  }

  upload(staffId: string, file: File, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    mediaControllerUpload(this._http, this._apiConfig.rootUrl, {
      body: { file, entityType: 'STAFF', entityId: staffId, type: 'GALLERY' },
    }).subscribe({
      next: () => { this._acting.set(false); this.refresh(staffId); onSuccess?.(); },
      error: () => { this._acting.set(false); this._toast.error('Upload failed.'); },
    });
  }

  delete(staffId: string, mediaId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: mediaId }).subscribe({
      next: () => { this._acting.set(false); this.refresh(staffId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  clear(): void {
    this._cache.clear();
    this._media.set([]);
  }

  private _fetch(staffId: string): void {
    this._loading.set(true);
    publicMediaControllerGetStaffMedia(this._http, this._apiConfig.rootUrl, { entityId: staffId }).subscribe({
      next: (res) => { this._cache.set(staffId, res.body); this._media.set(res.body); this._loading.set(false); },
      error: () => this._loading.set(false),
    });
  }
}
