import { Component, computed, inject, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Media } from '../../../api/models/media';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { StaffMediaService } from './staff-media.service';
import { ImageUploaderComponent } from '../../../shared/components/image-uploader/image-uploader.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryComponent } from '../../../shared/components/gallery/gallery.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-staff-media',
  templateUrl: './staff-media.component.html',
  imports: [ImageUploaderComponent, AvatarComponent, GalleryComponent, SkeletonComponent],
})
export class StaffMediaComponent implements OnInit {
  protected readonly _location = inject(Location);
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

  protected readonly canEdit = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  protected get _staffId(): string {
    return this._route.snapshot.paramMap.get('staffId') ?? '';
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

  protected onDeleted(id: string): void {
    this._staffMediaService.patchMedia(this._staffId, (list) => list.filter((m) => m.id !== id));
  }
}

