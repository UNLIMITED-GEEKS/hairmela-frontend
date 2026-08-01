import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Media } from '../../../api/models/media';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { SalonMediaService } from './salon-media.service';
import { ImageUploaderComponent } from '../../../shared/components/image-uploader/image-uploader.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { GalleryEditModalComponent } from '../../../shared/components/gallery-edit-modal/gallery-edit-modal.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-salon-media',
  templateUrl: './salon-media.component.html',
  imports: [
    ImageUploaderComponent,
    AvatarComponent,
    GalleryModalComponent,
    GalleryEditModalComponent,
    SkeletonComponent,
    PageHeaderComponent,
    IconComponent,
    InlineSpinnerComponent,
    MediaUrlPipe,
  ],
})
export class SalonMediaComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _salonMediaService = inject(SalonMediaService);

  protected readonly salonContext = inject(SalonContextService);

  protected readonly loading = this._salonMediaService.loading;
  protected readonly error = this._salonMediaService.error;
  protected readonly media = this._salonMediaService.media;

  protected static readonly MAX_GALLERY_PHOTOS = 12;

  protected readonly profilePhoto = computed(
    () => this.media().find((m) => m.type === 'PROFILE') ?? null,
  );
  protected readonly profilePhotoPending = computed(() => this.isPending(this.profilePhoto()));
  protected readonly galleryPhotos = computed(() =>
    this.media().filter((m) => m.type === 'GALLERY'),
  );
  protected readonly galleryUrls = computed(() => this.galleryPhotos().map((m) => m.url));

  // Optimistic upload tiles carry an ad hoc `pending` flag not part of the
  // real Media model (see SalonMediaService.upload()'s optimisticTile) — a
  // real Media from the server never has it, so this reads false for those.
  protected isPending(photo: Media | null): boolean {
    return !!(photo as (Media & { pending?: boolean }) | null)?.pending;
  }
  protected readonly remainingGallerySlots = computed(() =>
    Math.max(0, SalonMediaComponent.MAX_GALLERY_PHOTOS - this.galleryPhotos().length),
  );

  // Preview (view-only lightbox) vs edit (reorder/delete) are separate
  // modals — GalleryModalComponent has no editing capability, so the pen
  // icon opens GalleryEditModalComponent (wraps the existing drag/delete
  // <app-gallery>) instead.
  protected readonly previewOpen = signal(false);
  protected readonly previewIndex = signal(0);
  // What the lightbox shows — the gallery grid by default, or just the
  // profile photo when opened from the avatar. A single reused modal
  // instance rather than a second <app-gallery-modal>, since it's already
  // fully driven by inputs (images/startIndex) with no internal state of its
  // own to collide between the two openers.
  protected readonly previewImages = signal<string[]>([]);
  protected readonly editOpen = signal(false);

  protected openPreview(index: number): void {
    this.previewImages.set(this.galleryUrls());
    this.previewIndex.set(index);
    this.previewOpen.set(true);
  }

  protected openProfilePreview(): void {
    const url = this.profilePhoto()?.url;
    if (!url) return;
    this.previewImages.set([url]);
    this.previewIndex.set(0);
    this.previewOpen.set(true);
  }

  protected readonly canEdit = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  ngOnInit(): void {
    this._salonMediaService.load(this._salonId);
  }

  protected retry(): void {
    this._salonMediaService.refresh(this._salonId);
  }

  protected onProfileFilesSelected(files: File[]): void {
    const file = files[0];
    if (file) this._salonMediaService.upload(this._salonId, file, 'PROFILE');
  }

  // Each file gets its own optimistic tile + independent request via
  // upload()'s OptimisticService.run() call — a fork-join-style parallel
  // upload with no extra plumbing needed here, and a failure in one file
  // reverts only its own tile rather than the whole batch.
  protected onGalleryFilesSelected(files: File[]): void {
    for (const file of files) this._salonMediaService.upload(this._salonId, file, 'GALLERY');
  }

  protected onReordered(reordered: Media[]): void {
    this._salonMediaService.patchMedia(this._salonId, (list) => [
      ...list.filter((m) => m.type === 'PROFILE'),
      ...reordered,
    ]);
  }

  protected onDeleted(id: string): void {
    this._salonMediaService.patchMedia(this._salonId, (list) => list.filter((m) => m.id !== id));
  }
}
