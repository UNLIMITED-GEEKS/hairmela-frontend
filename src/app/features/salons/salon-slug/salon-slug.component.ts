import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { salonsControllerUpdateSlug } from '../../../api/fn/salons/salons-controller-update-slug';
import { ToastService } from '../../../core/toast/toast.service';
import { isApiError } from '../../../core/errors/api-error.types';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-salon-slug',
  templateUrl: './salon-slug.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
})
export class SalonSlugComponent implements OnInit {
  private readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly form = this._fb.group({
    slug: ['', [Validators.required, Validators.minLength(3), Validators.pattern(/^[a-z0-9-]+$/)]],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        this.form.patchValue({ slug: res.body.slug });
        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Salon not found');
        this._router.navigate(['/dashboard']);
      },
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    salonsControllerUpdateSlug(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      body: { slug: this.form.value.slug! },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this._toast.success('Slug updated');
        this._location.back();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (isApiError(err) && err.code === ErrorCodes.SALON_SLUG_TAKEN) {
          this.form.get('slug')?.setErrors({ taken: true });
        }
      },
    });
  }
}
