import { Component, OnInit, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CustomersService } from './customers.service';
import { SalonFavoritedUserDto } from '../../../api/models/salon-favorited-user-dto';
import { StaffFavoritesSummaryDto } from '../../../api/models/staff-favorites-summary-dto';
import { StaffFavoritedUserDto } from '../../../api/models/staff-favorited-user-dto';
import { PaginatedMetaDto } from '../../../api/models/paginated-meta-dto';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RouteParam } from '../../../core/routing/route-paths';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { TabsComponent, TabItem } from '../../../shared/components/tabs/tabs.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../../shared/components/pagination/pagination.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ToastService } from '../../../core/toast/toast.service';
import { copyToClipboard } from '../../../core/clipboard/copy-to-clipboard';

@Component({
  selector: 'app-salon-customers',
  templateUrl: './customers.component.html',
  imports: [
    PageHeaderComponent,
    TabsComponent,
    AvatarComponent,
    IconComponent,
    PaginationComponent,
    SkeletonComponent,
    DatePipe,
  ],
})
export class CustomersComponent implements OnInit {
  private readonly _customersService = inject(CustomersService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);
  protected readonly salonContext = inject(SalonContextService);

  private _initialized = false;
  private readonly _searchInput$ = new Subject<string>();
  private _salonReqId = 0;
  private _myReqId = 0;
  private _lastSalonQuery = '';

  readonly salonId = computed(
    () => this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? this.salonContext.activeSalonId() ?? '',
  );

  readonly role = computed(() => this.salonContext.membership()?.role);
  readonly isOwnerOrAdmin = computed(
    () => this.role() === SalonRole.OWNER || this.role() === SalonRole.ADMIN,
  );
  readonly isStaffOnly = computed(() => this.role() === SalonRole.STAFF);

  // Search filter
  protected readonly searchQuery = signal('');

  // Tabs for owner & admin
  protected readonly activeTab = signal<'salon' | 'staff'>('salon');
  protected readonly tabs: TabItem[] = [
    { id: 'salon', label: 'Salon' },
    { id: 'staff', label: 'Staff' },
  ];

  // Baseline (unfiltered page 1) cache for instant local filtering & zero-latency clear
  private readonly _baseSalonCustomers = signal<SalonFavoritedUserDto[]>([]);
  private readonly _baseSalonMeta = signal<PaginatedMetaDto | null>(null);

  private readonly _baseMyCustomers = signal<StaffFavoritedUserDto[]>([]);
  private readonly _baseMyMeta = signal<PaginatedMetaDto | null>(null);

  // Search pipeline state
  private readonly _isDebouncing = signal(false);

  // Salon customers (Owner/Admin)
  protected readonly salonCustomers = signal<SalonFavoritedUserDto[]>([]);
  protected readonly salonMeta = signal<PaginatedMetaDto | null>(null);
  protected readonly salonLoading = signal(false);
  protected readonly salonError = signal(false);
  protected readonly salonPage = signal(1);

  // Staff summary accordion (Owner/Admin)
  protected readonly staffSummaries = signal<StaffFavoritesSummaryDto[]>([]);
  protected readonly staffLoading = signal(false);
  protected readonly staffError = signal(false);
  protected readonly expandedStaffIds = signal<Set<string>>(new Set());

  // My favorited customers (Staff only)
  protected readonly myCustomers = signal<StaffFavoritedUserDto[]>([]);
  protected readonly myMeta = signal<PaginatedMetaDto | null>(null);
  protected readonly myLoading = signal(false);
  protected readonly myError = signal(false);
  protected readonly myPage = signal(1);

  protected readonly isSearching = computed(() => {
    if (!this.searchQuery().trim()) return false;
    if (this.isOwnerOrAdmin()) {
      if (this.activeTab() !== 'salon') return false;
      return this._isDebouncing() || this.salonLoading();
    }
    return this._isDebouncing() || this.myLoading();
  });

  // Server-side authoritative customer lists
  protected readonly filteredSalonCustomers = computed(() => this.salonCustomers());
  protected readonly filteredMyCustomers = computed(() => this.myCustomers());

  // Staff summary accordion filter (client-side because staff summary is loaded once in-memory)
  protected readonly filteredStaffSummaries = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.staffSummaries();
    if (!q) return list;
    const digits = q.replace(/\D/g, '');
    return list
      .map((s) => {
        const staffMatch = (s.name?.toLowerCase().includes(q)) || (s.nickname?.toLowerCase().includes(q));
        if (staffMatch) return s;
        const matchingUsers = s.users.filter((u) =>
          (u.firstName?.toLowerCase().includes(q)) ||
          (u.lastName?.toLowerCase().includes(q)) ||
          (u.displayName?.toLowerCase().includes(q)) ||
          (`${u.firstName} ${u.lastName}`.trim().toLowerCase().includes(q)) ||
          (u.nickname?.toLowerCase().includes(q)) ||
          (u.email?.toLowerCase().includes(q)) ||
          (u.phone?.toLowerCase().includes(q)) ||
          (digits.length > 2 && u.phone && u.phone.replace(/\D/g, '').includes(digits))
        );
        return matchingUsers.length > 0 ? { ...s, users: matchingUsers } : null;
      })
      .filter((s): s is StaffFavoritesSummaryDto => s !== null);
  });

  constructor() {
    this._searchInput$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((query) => {
        this._isDebouncing.set(false);
        this._triggerSearch(query);
      });

    effect(() => {
      const m = this.salonContext.membership();
      const sId = this.salonId();
      if (!m || !sId) return;
      if (this._initialized) return;
      this._initialized = true;
      this._initData();
    });
  }

  ngOnInit(): void {
    if (this.salonContext.membership() && this.salonId() && !this._initialized) {
      this._initialized = true;
      this._initData();
    }
  }

  private _initData(): void {
    if (this.isOwnerOrAdmin()) {
      this.loadSalonCustomers(1);
      this.loadStaffSummaries();
    } else {
      this.loadMyCustomers(1);
    }
  }

  protected onSearchInput(query: string): void {
    const trimmed = query.trim();
    this.searchQuery.set(query);
    if (!trimmed) {
      this._isDebouncing.set(false);
      this._searchInput$.next('');
      if (this.isOwnerOrAdmin() && this._baseSalonCustomers().length > 0) {
        this.salonCustomers.set(this._baseSalonCustomers());
        this.salonMeta.set(this._baseSalonMeta());
        this.salonPage.set(1);
        this._lastSalonQuery = '';
      } else if (this.isStaffOnly() && this._baseMyCustomers().length > 0) {
        this.myCustomers.set(this._baseMyCustomers());
        this.myMeta.set(this._baseMyMeta());
        this.myPage.set(1);
      }
      return;
    }

    this._isDebouncing.set(true);
    this._searchInput$.next(trimmed);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
    this._isDebouncing.set(false);
    this._searchInput$.next('');
    if (this.isOwnerOrAdmin() && this._baseSalonCustomers().length > 0) {
      this.salonCustomers.set(this._baseSalonCustomers());
      this.salonMeta.set(this._baseSalonMeta());
      this.salonPage.set(1);
      this._lastSalonQuery = '';
    } else if (this.isStaffOnly() && this._baseMyCustomers().length > 0) {
      this.myCustomers.set(this._baseMyCustomers());
      this.myMeta.set(this._baseMyMeta());
      this.myPage.set(1);
    }
  }

  private _triggerSearch(query: string): void {
    if (this.isOwnerOrAdmin()) {
      if (this.activeTab() === 'salon') {
        this.loadSalonCustomers(1, query);
      }
    } else if (this.isStaffOnly()) {
      this.loadMyCustomers(1, query);
    }
  }

  protected setTab(tabId: string): void {
    const prev = this.activeTab();
    this.activeTab.set(tabId as 'salon' | 'staff');
    if (prev !== tabId && tabId === 'salon') {
      const currentQuery = this.searchQuery().trim();
      if (this._lastSalonQuery !== currentQuery) {
        this.loadSalonCustomers(1, currentQuery);
      }
    }
  }

  // ── Owner & Admin: Salon tab ──
  protected async loadSalonCustomers(page: number, query = this.searchQuery()): Promise<void> {
    const sId = this.salonId();
    if (!sId) return;
    const trimmed = (query ?? '').trim();
    const reqId = ++this._salonReqId;
    this.salonLoading.set(true);
    this.salonError.set(false);
    try {
      const res = await this._customersService.getSalonFavorites(sId, page, 100, trimmed);
      if (reqId !== this._salonReqId) return;
      this._lastSalonQuery = trimmed;
      this.salonCustomers.set(res.data);
      this.salonMeta.set(res.meta);
      this.salonPage.set(page);
      if (!trimmed && page === 1) {
        this._baseSalonCustomers.set(res.data);
        this._baseSalonMeta.set(res.meta);
      }
    } catch {
      if (reqId !== this._salonReqId) return;
      this.salonError.set(true);
    } finally {
      if (reqId === this._salonReqId) {
        this.salonLoading.set(false);
        this._isDebouncing.set(false);
      }
    }
  }

  // ── Owner & Admin: Staff tab ──
  protected async loadStaffSummaries(): Promise<void> {
    const sId = this.salonId();
    if (!sId) return;
    this.staffLoading.set(true);
    this.staffError.set(false);
    try {
      const list = await this._customersService.getStaffFavoritesSummary(sId);
      this.staffSummaries.set(list);
      // Auto-expand staff who have favorited users if there are few
      if (list.length === 1 && list[0].staffId) {
        this.expandedStaffIds.set(new Set([list[0].staffId]));
      }
    } catch {
      this.staffError.set(true);
    } finally {
      this.staffLoading.set(false);
    }
  }

  protected toggleStaffAccordion(staffId: string): void {
    this.expandedStaffIds.update((set) => {
      const next = new Set(set);
      if (next.has(staffId)) {
        next.delete(staffId);
      } else {
        next.add(staffId);
      }
      return next;
    });
  }

  protected isStaffExpanded(staffId: string): boolean {
    if (this.searchQuery().trim()) {
      return true;
    }
    return this.expandedStaffIds().has(staffId);
  }

  // ── Staff only: My customers ──
  protected async loadMyCustomers(page: number, query = this.searchQuery()): Promise<void> {
    const trimmed = (query ?? '').trim();
    const reqId = ++this._myReqId;
    this.myLoading.set(true);
    this.myError.set(false);
    try {
      const res = await this._customersService.getMyFavoritedUsers(page, 100, trimmed);
      if (reqId !== this._myReqId) return;
      this.myCustomers.set(res.data);
      this.myMeta.set(res.meta);
      this.myPage.set(page);
      if (!trimmed && page === 1) {
        this._baseMyCustomers.set(res.data);
        this._baseMyMeta.set(res.meta);
      }
    } catch {
      if (reqId !== this._myReqId) return;
      this.myError.set(true);
    } finally {
      if (reqId === this._myReqId) {
        this.myLoading.set(false);
        this._isDebouncing.set(false);
      }
    }
  }

  protected copyPhone(event: Event, phone: string): void {
    event.stopPropagation();
    event.preventDefault();
    copyToClipboard(this._toast, phone, 'Phone number');
  }
}

