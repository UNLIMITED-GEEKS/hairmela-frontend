import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { Organization } from '../../api/models/organization';
import { UpdateOrganizationDto } from '../../api/models/update-organization-dto';
import { organizationsControllerFindOne } from '../../api/fn/organizations/organizations-controller-find-one';
import { organizationsControllerUpdate } from '../../api/fn/organizations/organizations-controller-update';
import { ToastService } from '../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class OrgService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);

  private readonly _cache = new Map<string, Organization>();
  private readonly _org = signal<Organization | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);

  readonly org = this._org.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();

  load(orgId: string): void {
    const cached = this._cache.get(orgId);
    if (cached) {
      this._org.set(cached);
      return;
    }
    this._fetch(orgId);
  }

  refresh(orgId: string): void {
    this._cache.delete(orgId);
    this._fetch(orgId);
  }

  update(orgId: string, body: UpdateOrganizationDto, onSuccess?: () => void): void {
    if (this._saving()) return;
    this._saving.set(true);
    organizationsControllerUpdate(this._http, this._apiConfig.rootUrl, { orgId, body }).subscribe({
      next: (res) => {
        this._saving.set(false);
        this._cache.set(orgId, res.body);
        this._org.set(res.body);
        this._toast.success('Organisation renamed');
        onSuccess?.();
      },
      error: () => this._saving.set(false),
    });
  }

  clear(): void {
    this._cache.clear();
    this._org.set(null);
  }

  private _fetch(orgId: string): void {
    this._loading.set(true);
    organizationsControllerFindOne(this._http, this._apiConfig.rootUrl, { orgId }).subscribe({
      next: (res) => {
        this._cache.set(orgId, res.body);
        this._org.set(res.body);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
  }
}
