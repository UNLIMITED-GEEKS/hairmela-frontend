import { Component, inject, input, output } from '@angular/core';
import { ToastService } from '../../../core/toast/toast.service';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
];
const MAX_BYTES = 5 * 1024 * 1024;

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

  protected onFileChange(event: Event): void {
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
      if (!ALLOWED_TYPES.includes(file.type)) {
        this._toast.error('Only JPEG, PNG, WebP, HEIC, HEIF, or AVIF images are allowed');
        input.value = '';
        return;
      }
      if (file.size > MAX_BYTES) {
        this._toast.error('Image must be 5 MB or smaller');
        input.value = '';
        return;
      }
    }

    this.filesSelected.emit(files);
    input.value = '';
  }
}
