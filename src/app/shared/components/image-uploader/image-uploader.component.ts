import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { mediaControllerUpload } from '../../../api/fn/media/media-controller-upload';
import { Media } from '../../../api/models/media';
import { ToastService } from '../../../core/toast/toast.service';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

@Component({
  selector: 'app-image-uploader',
  templateUrl: './image-uploader.component.html',
})
export class ImageUploaderComponent {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  readonly entityType = input.required<'USER' | 'SALON' | 'STAFF'>();
  readonly entityId = input.required<string>();
  readonly mediaType = input.required<'PROFILE' | 'GALLERY'>();
  readonly label = input('Upload image');
  readonly disabled = input(false);

  readonly uploaded = output<Media>();

  protected readonly uploading = signal(false);

  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.disabled()) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      this._toast.error('Only JPEG, PNG, or WebP images are allowed');
      input.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      this._toast.error('Image must be 5 MB or smaller');
      input.value = '';
      return;
    }

    this.uploading.set(true);
    mediaControllerUpload(this._http, this._apiConfig.rootUrl, {
      body: {
        file,
        entityType: this.entityType(),
        entityId: this.entityId(),
        type: this.mediaType(),
      },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.uploaded.emit(res.body);
      },
      error: () => {
        this.uploading.set(false);
        input.value = '';
      },
    });
  }
}
