import { Component, inject, OnInit, effect, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonSettingsService } from '../salon-settings/salon-settings.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-salon-slug',
  templateUrl: './salon-slug.component.html',
  imports: [
    SkeletonComponent, ReactiveFormsModule, FieldErrorComponent],
})
export class SalonSlugComponent implements OnInit {
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _settings = inject(SalonSettingsService);

  protected readonly loading = this._settings.loading;

  protected readonly form = this._fb.group({
    slug: ['', [Validators.required, Validators.minLength(3), Validators.pattern(/^[a-z0-9-]+$/)]],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
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
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._formEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }
    this._settings.updateSlug(
      this._salonId,
      { slug: this.form.value.slug! },
      () => this._router.navigate(RoutePath.salonSettings(this._salonId), { replaceUrl: true }),
      () => this.form.get('slug')?.setErrors({ taken: true }),
    );
  }
}
