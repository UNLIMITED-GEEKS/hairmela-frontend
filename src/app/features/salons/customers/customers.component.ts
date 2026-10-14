import { Component, inject, signal, computed, effect, untracked, DestroyRef } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Subject, debounceTime } from 'rxjs';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CustomersService } from './customers.service';
import { SalonFavoritedUserDto } from '../../../api/models/salon-favorited-user-dto';
import { StaffFavoritesSummaryDto } from '../../../api/models/staff-favorites-summary-dto';
import { StaffFavoritedUserDto } from '../../../api/models/staff-favorited-user-dto';
import { FavoritedCustomerDto } from '../../../api/models/favorited-customer-dto';
import { PaginatedMetaDto } from '../../../api/models/paginated-meta-dto';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { ChatService } from '../../../core/chat/chat.service';
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
    RouterLink,
    PageHeaderComponent,
    TabsComponent,
    AvatarComponent,
    IconComponent,
    PaginationComponent,
    SkeletonComponent,
    DatePipe,
  ],
})
export class CustomersComponent  {
  private readonly _customersService = inject(CustomersService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _chatService = inject(ChatService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);
  protected readonly salonContext = inject(SalonContextService);

  private _context = '';
  private _summaryReqId = 0;
  private readonly _routeParams = toSignal(this._route.paramMap, { initialValue: this._route.snapshot.paramMap });
  private readonly _searchInput$ = new Subject<string>();
  private _salonReqId = 0;
  private _myReqId = 0;
  private _lastSalonQuery = '';

  readonly salonId = computed(
    () => this._routeParams().get(RouteParam.SALON_ID) ?? this.salonContext.activeSalonId() ?? '',
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
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((query) => {
        this._isDebouncing.set(false);
        if (query && query === this.searchQuery().trim()) this._triggerSearch(query);
      });

    effect(() => {
      const membership = this.salonContext.membership();
      const salonId = this.salonId();
      if (!membership || !salonId) return;
      const context = `${salonId}:${membership.role}:${membership.staffId}`;
      if (context === this._context) return;
      this._context = context;
      untracked(() => {
        this._salonReqId++;
        this._myReqId++;
        this._summaryReqId++;
        this.salonCustomers.set([]);
        this.staffSummaries.set([]);
        this.myCustomers.set([]);
        this.salonMeta.set(null);
        this.myMeta.set(null);
        this.searchQuery.set('');
        this.expandedStaffIds.set(new Set());
        this._isDebouncing.set(false);
        this._initData();
      });
    });
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
    this._salonReqId++;
    this._myReqId++;
    this._isDebouncing.set(!!trimmed);
    this._searchInput$.next(trimmed);
    if (!trimmed) this._triggerSearch('');
  }

  protected clearSearch(): void {
    this.onSearchInput('');
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
  protected loadSalonCustomers(page: number, query = this.searchQuery()): void {
    const sId = this.salonId();
    if (!sId) return;
    const trimmed = (query ?? '').trim();
    let received = false;
    const reqId = ++this._salonReqId;
    this.salonLoading.set(true);
    this.salonError.set(false);
    this._customersService
      .getSalonFavorites(sId, page, 100, trimmed)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          received = true;
          if (reqId !== this._salonReqId) return;
          this._lastSalonQuery = trimmed;
          this.salonCustomers.set(res.data);
          this.salonMeta.set(res.meta);
          this.salonPage.set(page);
          this.salonLoading.set(false);
          this._isDebouncing.set(false);
        },
        error: () => {
          if (reqId !== this._salonReqId) return;
          this.salonError.set(!received && this.salonCustomers().length === 0);
          this.salonLoading.set(false);
          this._isDebouncing.set(false);
        },
      });
  }

  // ── Owner & Admin: Staff tab ──
  protected loadStaffSummaries(): void {
    const sId = this.salonId();
    if (!sId) return;
    const reqId = ++this._summaryReqId;
    let received = false;
    this.staffLoading.set(true);
    this.staffError.set(false);
    this._customersService
      .getStaffFavoritesSummary(sId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (list) => {
          if (reqId !== this._summaryReqId) return;
          received = true;
          this.staffSummaries.set(list);
          this.staffLoading.set(false);
          // Auto-expand staff who have favorited users if there are few
          if (list.length === 1 && list[0].staffId) {
            this.expandedStaffIds.set(new Set([list[0].staffId]));
          }
        },
        error: () => {
          if (reqId !== this._summaryReqId) return;
          this.staffError.set(!received && this.staffSummaries().length === 0);
          this.staffLoading.set(false);
        },
      });
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
  protected loadMyCustomers(page: number, query = this.searchQuery()): void {
    const trimmed = (query ?? '').trim();
    let received = false;
    const reqId = ++this._myReqId;
    this.myLoading.set(true);
    this.myError.set(false);
    this._customersService
      .getMyFavoritedUsers(page, 100, trimmed)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          received = true;
          if (reqId !== this._myReqId) return;
          this.myCustomers.set(res.data);
          this.myMeta.set(res.meta);
          this.myPage.set(page);
          this.myLoading.set(false);
          this._isDebouncing.set(false);
        },
        error: () => {
          if (reqId !== this._myReqId) return;
          this.myError.set(!received && this.myCustomers().length === 0);
          this.myLoading.set(false);
          this._isDebouncing.set(false);
        },
      });
  }

  protected copyPhone(event: Event, phone: string): void {
    event.stopPropagation();
    event.preventDefault();
    copyToClipboard(this._toast, phone, 'Phone number');
  }

  protected getChatRoute(): string[] {
    return RoutePath.chat();
  }

  protected getChatParams(): Record<string, string> {
    return this.isStaffOnly() ? { tab: 'clients' } : { tab: 'salon' };
  }

  /**
   * Opens (or creates) a conversation with a customer.
   *
   * `staffId` decides which inbox the thread lives in:
   *  - `null`      → salon chat (Customers → Salon tab; shows under "Salon Chats").
   *  - a staff id  → that staff member's client chat (Customers → Staff tab; shows under
   *                  that staff member's "Salon Client Chats" and the owner/admin "Staff" tab).
   *  - omitted     → the caller's own staff id (staff working their own customer list).
   */
  protected messageCustomer(
    customer: StaffFavoritedUserDto | SalonFavoritedUserDto | FavoritedCustomerDto,
    staffIdOverride?: string | null,
  ): void {
    const salonId = this.salonId();
    const staffId =
      staffIdOverride === undefined
        ? this.salonContext.membership()?.staffId || undefined
        : staffIdOverride || undefined;
    const customerId = (customer as any).userId;
    const customerName =
      (customer as any).displayName ||
      `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
      'Customer';
    this._chatService.createOrOpenConversation(salonId, staffId, { customerId, customerName }).subscribe({
      next: (conv) => {
        this._router.navigate(RoutePath.chatThread(conv.id), { state: { conversation: conv } });
      },
      error: (err) => {
        if (err?.status === 403) {
          this._toast.error(
            err?.error?.message ||
              'Salons cannot initiate conversations with users who have not favourited or visited them.',
          );
        } else {
          this._toast.error('Could not open conversation');
        }
      },
    });
  }
}

