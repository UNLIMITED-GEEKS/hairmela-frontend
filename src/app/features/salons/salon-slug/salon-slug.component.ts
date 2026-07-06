import { Component, inject, OnInit, effect } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonSettingsService } from '../salon-settings/salon-settings.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-salon-slug',
  templateUrl: './salon-slug.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
})
export class SalonSlugComponent implements OnInit {
  private readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _settings = inject(SalonSettingsService);

  protected readonly loading = this._settings.loading;

  protected readonly form = this._fb.group({
    slug: ['', [Validators.required, Validators.minLength(3), Validators.pattern(/^[a-z0-9-]+$/)]],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  constructor() {
    effect(() => {
      const s = this._settings.salon();
      if (s) this.form.patchValue({ slug: s.slug });
    });
  }

  ngOnInit(): void {
    this._settings.load(this._salonId);
  }

  protected save(): void {
    if (this.form.invalid) return;
    this._settings.updateSlug(
      this._salonId,
      { slug: this.form.value.slug! },
      () => this._location.back(),
      () => this.form.get('slug')?.setErrors({ taken: true }),
    );
  }
}
