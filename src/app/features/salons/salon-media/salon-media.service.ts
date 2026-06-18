import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Media } from '../../../api/models/media';
import { ReorderMediaDto } from '../../../api/models/reorder-media-dto';
import { publicMediaControllerGetSalonMedia } from '../../../api/fn/media/public-media-controller-get-salon-media';
import { mediaControllerUpload } from '../../../api/fn/media/media-controller-upload';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { mediaReorderControllerReorderSalonGallery } from '../../../api/fn/media/media-reorder-controller-reorder-salon-gallery';
import { ToastService } from '../../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class SalonMediaService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);

  private readonly _cache = new Map<string, Media[]>();
  private readonly _media = signal<Media[]>([]);
  private readonly _loading = signal(false);
  private readonly _acting = signal(false);

  readonly media = this._media.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly acting = this._acting.asReadonly();

  load(salonId: string): void {
    const cached = this._cache.get(salonId);
    if (cached) { this._media.set(cached); return; }
    this._fetch(salonId);
  }

  refresh(salonId: string): void {
    this._cache.delete(salonId);
    this._fetch(salonId);
  }

  upload(salonId: string, file: File, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    mediaControllerUpload(this._http, this._apiConfig.rootUrl, {
      body: { file, entityType: 'SALON', entityId: salonId, type: 'GALLERY' },
    }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId); onSuccess?.(); },
      error: () => { this._acting.set(false); this._toast.error('Upload failed.'); },
    });
  }

  delete(salonId: string, mediaId: string, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: mediaId }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  reorder(salonId: string, body: ReorderMediaDto, onSuccess?: () => void): void {
    if (this._acting()) return;
    this._acting.set(true);
    mediaReorderControllerReorderSalonGallery(this._http, this._apiConfig.rootUrl, { salonId, body }).subscribe({
      next: () => { this._acting.set(false); this.refresh(salonId); onSuccess?.(); },
      error: () => this._acting.set(false),
    });
  }

  clear(): void {
    this._cache.clear();
    this._media.set([]);
  }

  private _fetch(salonId: string): void {
    this._loading.set(true);
    publicMediaControllerGetSalonMedia(this._http, this._apiConfig.rootUrl, { entityId: salonId }).subscribe({
      next: (res) => { this._cache.set(salonId, res.body); this._media.set(res.body); this._loading.set(false); },
      error: () => this._loading.set(false),
    });
  }
}
