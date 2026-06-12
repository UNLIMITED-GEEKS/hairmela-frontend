import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Organization } from '../../../api/models/organization';
import { organizationsControllerFindOne } from '../../../api/fn/organizations/organizations-controller-find-one';
import { organizationsControllerUpdate } from '../../../api/fn/organizations/organizations-controller-update';
import { ToastService } from '../../../core/toast/toast.service';
import { isApiError } from '../../../core/errors/api-error.types';

@Component({
  selector: 'app-org-settings',
  templateUrl: './org-settings.component.html',
  imports: [ReactiveFormsModule],
})
export class OrgSettingsComponent implements OnInit {
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
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get('orgId') ?? '';
  }

  ngOnInit(): void {
    organizationsControllerFindOne(this._http, this._apiConfig.rootUrl, { orgId: this._orgId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        this.form.patchValue({ name: res.body.name });
        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Organisation not found');
        this._router.navigate(['/dashboard']);
      },
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    organizationsControllerUpdate(this._http, this._apiConfig.rootUrl, {
      orgId: this._orgId,
      body: { name: this.form.value.name! },
    }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this._toast.success('Organisation renamed');
        this._router.navigate(['..'], { relativeTo: this._route });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (isApiError(err) && err.statusCode === 400) {
          this.form.get('name')?.setErrors({ server: err.message });
        }
      },
    });
  }
}
