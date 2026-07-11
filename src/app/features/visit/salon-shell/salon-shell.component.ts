import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ConnectionBannerComponent } from '../../../shared/components/connection-banner/connection-banner.component';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-salon-shell',
  templateUrl: './salon-shell.component.html',
  imports: [RouterOutlet, SkeletonComponent, ConnectionBannerComponent],
})
export class SalonShellComponent implements OnInit, OnDestroy {
  protected readonly visit = inject(SalonVisitService);
  private readonly _route = inject(ActivatedRoute);

  ngOnInit(): void {
    const slug = this._route.snapshot.paramMap.get(RouteParam.SLUG) ?? '';
    const shellPrefix = this._route.snapshot.data['shellPrefix'] ?? '';
    this.visit.init(slug, shellPrefix);
  }

  ngOnDestroy(): void {
    this.visit.destroy();
  }
}
