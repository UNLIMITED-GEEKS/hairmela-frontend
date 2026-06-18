import { Component, DestroyRef, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { publicMediaControllerGetSalonMedia } from '../../../api/fn/media/public-media-controller-get-salon-media';
import { Media } from '../../../api/models/media';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ImageUploaderComponent } from '../../../shared/components/image-uploader/image-uploader.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryComponent } from '../../../shared/components/gallery/gallery.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-salon-media',
  templateUrl: './salon-media.component.html',
  imports: [RouterLink, ImageUploaderComponent, AvatarComponent, GalleryComponent, SkeletonComponent],
})
export class SalonMediaComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly salonContext = inject(SalonContextService);

  protected readonly loading = signal(true);
  protected readonly media = signal<Media[]>([]);

  protected readonly profilePhoto = computed(() =>
    this.media().find((m) => m.type === 'PROFILE') ?? null,
  );
  protected readonly galleryPhotos = computed(() =>
    this.media().filter((m) => m.type === 'GALLERY'),
  );

  protected readonly canEdit = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    publicMediaControllerGetSalonMedia(this._http, this._apiConfig.rootUrl, {
      entityId: this._salonId,
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (res) => {
        this.media.set(res.body);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected onProfileUploaded(m: Media): void {
    this.media.update((list) => {
      const without = list.filter((x) => x.type !== 'PROFILE');
      return [m, ...without];
    });
  }

  protected onGalleryUploaded(m: Media): void {
    this.media.update((list) => [...list, m]);
  }

  protected onReordered(reordered: Media[]): void {
    this.media.update((list) => {
      const profile = list.filter((m) => m.type === 'PROFILE');
      return [...profile, ...reordered];
    });
  }

  protected onDeleted(id: string): void {
    this.media.update((list) => list.filter((m) => m.id !== id));
  }
}
