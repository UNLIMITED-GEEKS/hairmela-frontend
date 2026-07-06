import { CacheRegistry } from '../../core/cache-registry.service';
import { Injectable, inject, signal } from '@angular/core';
import { map } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { Organization } from '../../api/models/organization';
import { UpdateOrganizationDto } from '../../api/models/update-organization-dto';
import { organizationsControllerFindOne } from '../../api/fn/organizations/organizations-controller-find-one';
import { organizationsControllerUpdate } from '../../api/fn/organizations/organizations-controller-update';
import { ToastService } from '../../core/toast/toast.service';
import { OptimisticService } from '../../core/optimistic/optimistic.service';
import { CachedLoader } from '../../core/optimistic/cached-loader';

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

  private readonly _cache = new Map<string, Organization | null>();
  private readonly _org = signal<Organization | null>(null);

  private readonly _loader = new CachedLoader({
    signal: this._org,
    optimistic: this._optimistic,
    cache: this._cache,
    fetch: (orgId) =>
      organizationsControllerFindOne(this._http, this._apiConfig.rootUrl, { orgId }).pipe(
        map((r) => r.body as Organization | null),
      ),
    shouldCache: (v) => v !== null,
  });

  readonly org = this._org.asReadonly();
  readonly loading = this._loader.loading;
  readonly error = this._loader.error;

  load(orgId: string): void {
    this._loader.load(orgId);
  }

  refresh(orgId: string): void {
    this._loader.refresh(orgId);
  }

  update(orgId: string, body: UpdateOrganizationDto, onSuccess?: () => void): void {
    this._optimistic.run({
      signal: this._org,
      dedupeKey: `OrgService.update:${orgId}`,
      apply: (org) => (org ? { ...org, name: body.name ?? org.name } : org),
      reconcile: (_, res) => res.body,
      mirror: this._loader.mirrorFn(orgId),
      request: () =>
        organizationsControllerUpdate(this._http, this._apiConfig.rootUrl, { orgId, body }),
      errorMessage: 'Could not rename organisation. Reverted.',
      onSuccess: () => {
        this._toast.success('Organisation renamed');
        onSuccess?.();
      },
    });
  }

  clear(): void {
    this._cache.clear();
    this._optimistic.reset(this._org, null);
  }
}
