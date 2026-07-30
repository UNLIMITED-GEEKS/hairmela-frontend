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
  protected readonly galleryPhotos = computed(() =>
    this.media().filter((m) => m.type === 'GALLERY'),
  );
  protected readonly galleryUrls = computed(() => this.galleryPhotos().map((m) => m.url));
  protected readonly remainingGallerySlots = computed(() =>
    Math.max(0, SalonMediaComponent.MAX_GALLERY_PHOTOS - this.galleryPhotos().length),
  );

  // Preview (view-only lightbox) vs edit (reorder/delete) are separate
  // modals — GalleryModalComponent has no editing capability, so the pen
  // icon opens GalleryEditModalComponent (wraps the existing drag/delete
  // <app-gallery>) instead.
  protected readonly previewOpen = signal(false);
  protected readonly previewIndex = signal(0);
  protected readonly editOpen = signal(false);

  protected openPreview(index: number): void {
    this.previewIndex.set(index);
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
