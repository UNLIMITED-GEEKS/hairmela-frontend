import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Organization } from '../../../api/models/organization';
import { organizationsControllerFindOne } from '../../../api/fn/organizations/organizations-controller-find-one';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-org-overview',
  templateUrl: './org-overview.component.html',
  imports: [RouterLink],
})
export class OrgOverviewComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  protected readonly org = signal<Organization | null>(null);
  protected readonly loading = signal(true);

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get('orgId') ?? '';
  }

  ngOnInit(): void {
    organizationsControllerFindOne(this._http, this._apiConfig.rootUrl, { orgId: this._orgId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        this.org.set(res.body);
        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Organisation not found');
        this._router.navigate(['/dashboard']);
      },
    });
  }

  protected tierLabel(tier: number): string {
    const labels: Record<number, string> = { 1: 'Free', 2: 'Pro', 3: 'Business' };
    return labels[tier] ?? `Tier ${tier}`;
  }
}
