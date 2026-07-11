import { Component, DestroyRef, inject, input, output, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { mediaControllerDelete } from '../../../api/fn/media/media-controller-delete';
import { mediaReorderControllerReorderSalonGallery } from '../../../api/fn/media/media-reorder-controller-reorder-salon-gallery';
import { Media } from '../../../api/models/media';
import { ConfirmDialogService } from '../confirm-dialog/confirm-dialog.service';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';
import { filter, switchMap } from 'rxjs';

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
  imports: [DragDropModule, MediaUrlPipe],
})
export class GalleryComponent {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  readonly items = input.required<Media[]>();
  readonly salonId = input<string | null>(null);
  readonly canEdit = input(false);

  readonly reordered = output<Media[]>();
  readonly deleted = output<string>();

  protected readonly saving = signal(false);

  protected drop(event: CdkDragDrop<Media[]>): void {
    const list = [...this.items()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.reordered.emit(list);

    const sid = this.salonId();
    if (!sid) return;

    this.saving.set(true);
    mediaReorderControllerReorderSalonGallery(this._http, this._apiConfig.rootUrl, {
      salonId: sid,
      body: { orderedIds: list.map((m) => m.id) },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }

  protected deleteItem(item: Media): void {
    this._confirmDialog.open({
      title: 'Delete photo?',
      message: 'This photo will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    }).pipe(
      filter((ok) => ok),
      switchMap(() => {
        this.saving.set(true);
        return mediaControllerDelete(this._http, this._apiConfig.rootUrl, { id: item.id });
      }),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.deleted.emit(item.id);
      },
      error: () => this.saving.set(false),
    });
  }
}
