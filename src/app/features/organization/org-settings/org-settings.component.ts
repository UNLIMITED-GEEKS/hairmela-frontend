import { Component, OnInit, inject, effect } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { OrgService } from '../org.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-org-settings',
  templateUrl: './org-settings.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
})
export class OrgSettingsComponent implements OnInit {
  private readonly _location = inject(Location);
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
    return this._route.snapshot.paramMap.get('orgId') ?? '';
  }

  ngOnInit(): void {
    this._orgService.load(this._orgId);
  }

  protected save(): void {
    if (this.form.invalid) return;
    this._orgService.update(this._orgId, { name: this.form.value.name! }, () =>
      this._location.back(),
    );
  }
}
