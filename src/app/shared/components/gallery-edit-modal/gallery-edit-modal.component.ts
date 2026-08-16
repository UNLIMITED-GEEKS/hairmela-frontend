import { Component, input, output } from '@angular/core';
import { Media } from '../../../api/models/media';
import { GalleryComponent } from '../gallery/gallery.component';
import { IconComponent } from '../icon/icon.component';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';

// Modal wrapper around the existing reorder/delete-capable <app-gallery> —
// keeps the drag-drop editing UI out of the page's normal flow (a Recent
// Work-style thumbnail grid is what's shown inline instead), opened via a
// pen/edit icon. Purely a shell: all reorder/delete logic still lives in
// GalleryComponent, forwarded through unchanged.
@Component({
  selector: 'app-gallery-edit-modal',
  templateUrl: './gallery-edit-modal.component.html',
  imports: [GalleryComponent, IconComponent],
})
export class GalleryEditModalComponent {
  readonly open = input.required<boolean>();
  readonly items = input.required<Media[]>();
  readonly salonId = input<string | null>(null);
  readonly staffId = input<string | null>(null);

  readonly closed = output<void>();
  readonly reordered = output<Media[]>();
  readonly deleted = output<string>();

  constructor() {
    // Android back dismisses this modal instead of navigating underneath it.
    registerOverlayWhileOpen(this.open, () => this.close());
  }

  protected close(): void {
    this.closed.emit();
  }
}
