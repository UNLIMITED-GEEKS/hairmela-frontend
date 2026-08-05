import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Media } from '../../../api/models/media';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { StaffMediaService } from './staff-media.service';
import { ImageUploaderComponent } from '../../../shared/components/image-uploader/image-uploader.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { GalleryEditModalComponent } from '../../../shared/components/gallery-edit-modal/gallery-edit-modal.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { PageDescriptionComponent } from '../../../shared/components/page-description/page-description.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-staff-media',
  templateUrl: './staff-media.component.html',
  imports: [
    ImageUploaderComponent,
    AvatarComponent,
    GalleryModalComponent,
    GalleryEditModalComponent,
    SkeletonComponent,
    PageHeaderComponent,
    PageDescriptionComponent,
    IconComponent,
    InlineSpinnerComponent,
    MediaUrlPipe,
  ],
})
export class StaffMediaComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _staffMediaService = inject(StaffMediaService);

  protected readonly salonContext = inject(SalonContextService);

  protected readonly loading = this._staffMediaService.loading;
  protected readonly error = this._staffMediaService.error;
  protected readonly media = this._staffMediaService.media;

  protected static readonly MAX_GALLERY_PHOTOS = 8;

  protected readonly profilePhoto = computed(
    () => this.media().find((m) => m.type === 'PROFILE') ?? null,
  );
  protected readonly profilePhotoPending = computed(() => this.isPending(this.profilePhoto()));
  protected readonly galleryPhotos = computed(() =>
    this.media().filter((m) => m.type === 'GALLERY'),
  );
  protected readonly galleryUrls = computed(() => this.galleryPhotos().map((m) => m.url));

  // Optimistic upload tiles carry an ad hoc `pending` flag not part of the
  // real Media model (see StaffMediaService.upload()'s optimisticTile) — a
  // real Media from the server never has it, so this reads false for those.
  protected isPending(photo: Media | null): boolean {
    return !!(photo as (Media & { pending?: boolean }) | null)?.pending;
  }

  protected readonly remainingGallerySlots = computed(() =>
    Math.max(0, StaffMediaComponent.MAX_GALLERY_PHOTOS - this.galleryPhotos().length),
  );

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

  // FIXME: not scoped to "is this MY staffId" — a STAFF member can currently
  // upload/edit/delete on ANY staff member's media page in this salon, not
  // just their own. Scoping this properly requires resolving the SalonStaff
  // record behind _staffId (it has userId) and comparing to
  // CurrentUserStore.user()?.id, which nothing here does yet. Fixing the
  // reported bug (staff couldn't upload their own photos at all) first;
  // tighten this to owner/admin-or-self once that comparison is wired up.
  protected readonly canEdit = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN || role === SalonRole.STAFF;
  });

  protected get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  ngOnInit(): void {
    this._staffMediaService.load(this._staffId);
  }

  protected retry(): void {
    this._staffMediaService.refresh(this._staffId);
  }

  protected onProfileFilesSelected(files: File[]): void {
    const file = files[0];
    if (file) this._staffMediaService.upload(this._staffId, file, 'PROFILE');
  }

  // Each file gets its own optimistic tile + independent request via
  // upload()'s OptimisticService.run() call — a fork-join-style parallel
  // upload with no extra plumbing needed here, and a failure in one file
  // reverts only its own tile rather than the whole batch.
  protected onGalleryFilesSelected(files: File[]): void {
    for (const file of files) this._staffMediaService.upload(this._staffId, file, 'GALLERY');
  }

  protected onReordered(reordered: Media[]): void {
    this._staffMediaService.patchMedia(this._staffId, (list) => [
      ...list.filter((m) => m.type === 'PROFILE'),
      ...reordered,
    ]);
  }

  protected onDeleted(id: string): void {
    this._staffMediaService.patchMedia(this._staffId, (list) => list.filter((m) => m.id !== id));
  }
}

