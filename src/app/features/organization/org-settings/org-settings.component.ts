import { Component, OnInit, inject, effect, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { OrgService } from '../org.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-org-settings',
  templateUrl: './org-settings.component.html',
  imports: [
    SkeletonComponent, ReactiveFormsModule, FieldErrorComponent],
})
export class OrgSettingsComponent implements OnInit {
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _orgService = inject(OrgService);

  protected readonly loading = this._orgService.loading;
  protected readonly error = this._orgService.error;

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  constructor() {
    effect(() => {
      const org = this._orgService.org();
      if (org) this.form.patchValue({ name: org.name });
    });
  }

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  }

  ngOnInit(): void {
    this._orgService.load(this._orgId);
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
    this._orgService.update(this._orgId, { name: this.form.value.name! }, () =>
      this._router.navigate(RoutePath.org(this._orgId), { replaceUrl: true }),
    );
  }
}
