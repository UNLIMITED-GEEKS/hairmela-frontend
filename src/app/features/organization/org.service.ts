import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { retry } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { Organization } from '../../api/models/organization';
import { UpdateOrganizationDto } from '../../api/models/update-organization-dto';
import { organizationsControllerFindOne } from '../../api/fn/organizations/organizations-controller-find-one';
import { organizationsControllerUpdate } from '../../api/fn/organizations/organizations-controller-update';
import { ToastService } from '../../core/toast/toast.service';
import { OptimisticService, ReadToken } from '../../core/optimistic/optimistic.service';

@Injectable({ providedIn: 'root' })
export class OrgService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _optimistic = inject(OptimisticService);

  constructor() {
    this._cacheRegistry.register(this);
  }

  private readonly _cache = new Map<string, Organization>();
  private readonly _org = signal<Organization | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight: string | null = null;

  readonly org = this._org.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(orgId: string): void {
    const token = this._optimistic.beginRead(this._org);
    const cached = this._cache.get(orgId);
    if (cached) {
      this._optimistic.commitRead(this._org, cached, token);
      return;
    }
    if (this._inflight === orgId) return;
    this._fetch(orgId, token);
  }

  refresh(orgId: string): void {
    const token = this._optimistic.beginRead(this._org);
    this._cache.delete(orgId);
    this._fetch(orgId, token);
  }

  update(orgId: string, body: UpdateOrganizationDto, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._org,
      dedupeKey: `OrgService.update:${orgId}`,
      apply: (org) => (org ? { ...org, name: body.name ?? org.name } : org),
      reconcile: (_, res) => res.body,
      request: () =>
        organizationsControllerUpdate(this._http, this._apiConfig.rootUrl, { orgId, body }),
      errorMessage: 'Could not rename organisation. Reverted.',
      onSuccess: (res) => {
        this._cache.set(orgId, res.body);
        this._toast.success('Organisation renamed');
        onSuccess?.();
      },
    });
  }

  clear(): void {
    this._cache.clear();
    this._org.set(null);
  }

  private _fetch(orgId: string, token: ReadToken): void {
    this._inflight = orgId;
    this._loading.set(true);
    this._error.set(false);
    organizationsControllerFindOne(this._http, this._apiConfig.rootUrl, { orgId })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight = null;
          this._cache.set(orgId, res.body);
          this._optimistic.commitRead(this._org, res.body, token);
          this._loading.set(false);
        },
        error: () => {
          this._inflight = null;
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
