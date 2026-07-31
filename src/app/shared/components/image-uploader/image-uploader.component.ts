import { Component, inject, input, output } from '@angular/core';
import { ToastService } from '../../../core/toast/toast.service';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 5 * 1024 * 1024;
const HEIC_TYPES = ['image/heic', 'image/heif'];

// iOS Safari often reports an empty file.type for HEIC/HEIF photos picked
// from the Photos library — the extension is the only reliable signal there.
function isHeic(file: File): boolean {
  return HEIC_TYPES.includes(file.type) || /\.hei[cf]$/i.test(file.name);
}

@Component({
  selector: 'app-image-uploader',
  templateUrl: './image-uploader.component.html',
})
export class ImageUploaderComponent {
  private readonly _toast = inject(ToastService);

  readonly label = input('Upload image');
  readonly disabled = input(false);
  readonly uploading = input(false);
  readonly multiple = input(false);
  // Remaining slots the caller has room for. Only enforced when multiple() is
  // true — single-file (profile) mode has nothing to cap against. null means
  // no cap (parent doesn't compute one, e.g. profile mode never sets it).
  readonly maxFiles = input<number | null>(null);

  readonly filesSelected = output<File[]>();

  protected async onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0 || this.disabled()) return;

    const max = this.maxFiles();
    if (this.multiple() && max !== null && files.length > max) {
      this._toast.error(
        max === 0
          ? 'You have reached the photo limit.'
          : `You can only add ${max} more photo${max === 1 ? '' : 's'}.`,
      );
      input.value = '';
      return;
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type) && !isHeic(file)) {
        this._toast.error('Only JPEG, PNG, WebP, HEIC, or HEIF images are allowed');
        input.value = '';
        return;
      }
    }

    let converted: File[];
    try {
      converted = await Promise.all(files.map((file) => this._toJpegIfHeic(file)));
    } catch {
      this._toast.error('Could not process that photo. Please try another.');
      input.value = '';
      return;
    }

    for (const file of converted) {
      if (file.size > MAX_BYTES) {
        this._toast.error('Image must be 5 MB or smaller');
        input.value = '';
        return;
      }
    }

    this.filesSelected.emit(converted);
    input.value = '';
  }

  // iOS hands out HEIC/HEIF for camera-roll photos, and no browser (including
  // Safari) can decode that format outside the OS — the backend can't either,
  // so convert to JPEG client-side before sending.
  private async _toJpegIfHeic(file: File): Promise<File> {
    if (!isHeic(file)) return file;

    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    const jpegBlob = Array.isArray(result) ? result[0] : result;
    return new File([jpegBlob], file.name.replace(/\.hei[cf]$/i, '.jpg'), {
      type: 'image/jpeg',
    });
  }
}
