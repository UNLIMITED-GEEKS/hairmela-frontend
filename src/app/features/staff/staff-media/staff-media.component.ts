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
import { IconComponent } from '../../../shared/components/icon/icon.component';
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
    IconComponent,
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

  protected readonly profilePhoto = computed(
    () => this.media().find((m) => m.type === 'PROFILE') ?? null,
  );
  protected readonly galleryPhotos = computed(() =>
    this.media().filter((m) => m.type === 'GALLERY'),
  );
  protected readonly galleryUrls = computed(() => this.galleryPhotos().map((m) => m.url));

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

  protected get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  ngOnInit(): void {
    this._staffMediaService.load(this._staffId);
  }

  protected retry(): void {
    this._staffMediaService.refresh(this._staffId);
  }

  protected onProfileUploaded(m: Media): void {
    this._staffMediaService.patchMedia(this._staffId, (list) => [
      m,
      ...list.filter((x) => x.type !== 'PROFILE'),
    ]);
  }

  protected onGalleryUploaded(m: Media): void {
    this._staffMediaService.patchMedia(this._staffId, (list) => [...list, m]);
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

