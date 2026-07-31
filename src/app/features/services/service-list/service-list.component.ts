import { Component, OnInit, inject, computed, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Service } from '../../../api/models/service';
import { ServicesService } from '../services.service';
import { CategoriesService } from '../../../core/categories/categories.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { AnimatedListComponent } from '../../../shared/components/animated-list/animated-list.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { ScreenLayoutComponent } from '../../../shared/components/screen-layout/screen-layout.component';
import { RouteParam, RouteSegment } from '../../../core/routing/route-paths';
import { CurrencyNgnPipe } from '../../../shared/pipes/currency-ngn.pipe';
import { filter } from 'rxjs';

@Component({
  selector: 'app-service-list',
  templateUrl: './service-list.component.html',
  imports: [
    RouterLink,
    SkeletonComponent,
    FrozenBannerComponent,
    AnimatedListComponent,
    AccordionComponent,
    PageHeaderComponent,
    ScreenLayoutComponent,
    CurrencyNgnPipe,
  ],
})
export class ServiceListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _servicesService = inject(ServicesService);
  private readonly _categoriesService = inject(CategoriesService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly loading = this._servicesService.loading;
  protected readonly error = this._servicesService.error;
  protected readonly services = this._servicesService.services;

  protected readonly canManage = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  // Write controls also require an unfrozen salon (frozen = over plan limit,
  // backend rejects writes). Links can't be directive-disabled, so we hide them.
  protected readonly canWrite = computed(() => this.canManage() && !this.salonContext.isFrozen());

  protected readonly newServiceLink = [RouteSegment.NEW];

  // Services grouped by category, ordered by each category's sortOrder
  // (services within a category keep services()'s existing order). Same
  // grouping/open-state pattern as salon-landing.component.ts's public
  // Services tab.
  //
  // service.category can be undefined here — ServicesService.create()'s
  // optimistic row is spread from CreateServiceDto, which only carries
  // categoryId, not the nested category object (that only exists once the
  // real server response reconciles the row). Falls back to categoryId +
  // categoriesService's own loaded list (ngOnInit loads it) to resolve the
  // name/sortOrder in that case; if even that lookup misses (categories
  // still loading), the group falls back to categoryId itself as a
  // placeholder name rather than crashing on `undefined.id`.
  protected readonly serviceCategories = computed(() => {
    const categoriesById = new Map(this._categoriesService.categories().map((c) => [c.id, c]));
    const groups = new Map<
      string,
      { id: string; name: string; sortOrder: number; services: Service[] }
    >();
    for (const service of this.services()) {
      const cat = service.category ?? categoriesById.get(service.categoryId);
      const id = cat?.id ?? service.categoryId;
      let group = groups.get(id);
      if (!group) {
        group = {
          id,
          name: cat?.name ?? service.categoryId,
          sortOrder: cat?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          services: [],
        };
        groups.set(id, group);
      }
      group.services.push(service);
    }
    return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  });

  // A single category is always expanded (nothing to collapse against); with
  // multiple categories, all start collapsed. Explicit toggles are
  // remembered here rather than recomputed, so a background services
  // refresh doesn't snap a user's open section shut.
  private readonly _openCategoryIds = signal<ReadonlySet<string>>(new Set());

  protected isCategoryOpen(categoryId: string): boolean {
    if (this.serviceCategories().length <= 1) return true;
    return this._openCategoryIds().has(categoryId);
  }

  protected setCategoryOpen(categoryId: string, open: boolean): void {
    this._openCategoryIds.update((ids) => {
      const next = new Set(ids);
      open ? next.add(categoryId) : next.delete(categoryId);
      return next;
    });
  }

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected editServiceLink(serviceId: string): string[] {
    return [serviceId, RouteSegment.EDIT];
  }

  ngOnInit(): void {
    this._servicesService.load(this._salonId);
    this._categoriesService.load();
  }

  protected retry(): void {
    this._servicesService.refresh(this._salonId);
  }

  protected deactivate(service: Service): void {
    this._confirmDialog
      .open({
        title: `Delete "${service.name}"?`,
        message:
          'This service will be unassigned from all staff and removed from new queues. In-flight queue entries keep their duration.',
        confirmLabel: 'Delete',
        danger: true,
      })
      .pipe(filter((ok) => ok))
      .subscribe(() => {
        this._servicesService.deactivate(this._salonId, service.id);
      });
  }

  protected formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
}
