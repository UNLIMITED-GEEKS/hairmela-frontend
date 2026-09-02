import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrgService } from '../org.service';
import { RouteParam, RoutePath, RouteSegment } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-org-overview',
  templateUrl: './org-overview.component.html',
  imports: [
    SkeletonComponent, RouterLink],
})
export class OrgOverviewComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _orgService = inject(OrgService);

  protected readonly org = this._orgService.org;
  protected readonly loading = this._orgService.loading;
  protected readonly error = this._orgService.error;

  protected readonly planSegment = RouteSegment.PLAN;
  protected readonly settingsSegment = RouteSegment.SETTINGS;

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.ORG_ID) ?? '';
  }

  ngOnInit(): void {
    this._orgService.load(this._orgId);
    if (!this.org() && !this.loading()) {
      this._router.navigate(RoutePath.dashboard());
    }
  }

  protected retry(): void {
    this._orgService.refresh(this._orgId);
  }
}
