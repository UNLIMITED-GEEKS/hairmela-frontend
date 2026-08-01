import { Component, inject, input, output } from '@angular/core';
import { ToastService } from '../../../core/toast/toast.service';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
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

  // Best-effort, not all-or-nothing: an oversized/wrong-type file or picking
  // more than the remaining slots no longer blocks the whole selection —
  // whatever's valid still gets uploaded, and a toast explains what was
  // skipped and why.
  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (picked.length === 0 || this.disabled()) return;

    let wrongType = 0;
    let tooLarge = 0;
    const valid: File[] = [];
    for (const file of picked) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        wrongType++;
      } else if (file.size > MAX_BYTES) {
        tooLarge++;
      } else {
        valid.push(file);
      }
    }

    const max = this.maxFiles();
    let overLimit = 0;
    let toUpload = valid;
    if (this.multiple() && max !== null && valid.length > max) {
      overLimit = valid.length - max;
      toUpload = valid.slice(0, max);
    }

    const skippedReasons: string[] = [];
    if (wrongType > 0) skippedReasons.push(`${wrongType} not JPEG/PNG/WebP`);
    if (tooLarge > 0) skippedReasons.push(`${tooLarge} over 5 MB`);
    if (overLimit > 0) skippedReasons.push(`${overLimit} over the photo limit`);
    if (skippedReasons.length > 0) {
      const skippedCount = wrongType + tooLarge + overLimit;
      this._toast.error(
        `Skipped ${skippedCount} photo${skippedCount === 1 ? '' : 's'} (${skippedReasons.join(', ')}).`,
      );
    }

    if (toUpload.length > 0) this.filesSelected.emit(toUpload);
  }
}
