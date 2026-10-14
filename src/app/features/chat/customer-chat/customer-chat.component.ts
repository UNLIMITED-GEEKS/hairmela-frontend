import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, merge } from 'rxjs';
import { ChatService } from '../../../core/chat/chat.service';
import { ChatSocketService } from '../../../core/chat/chat-socket.service';
import { ConversationItemDto } from '../../../core/chat/chat.types';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ChatStatusIconComponent } from '../chat-status-icon/chat-status-icon.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RoutePath } from '../../../core/routing/route-paths';
import { StaffService } from '../../staff/staff.service';
import { StaffWithQueueDto } from '../../../api/models/staff-with-queue-dto';
import { BroadcastModalComponent } from '../../salons/salon-chat/broadcast-modal.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

export type ChatTab = 'my' | 'clients' | 'salon' | 'staff';

/**
 * The one and only chat inbox (`/chat`). The tabs shown depend on the user's role:
 *
 *  - Regular user  → My Chats
 *  - Salon staff   → My Chats · Salon Client Chats
 *  - Owner / Admin → My Chats · Salon Chats · Staff
 *
 * Where a thread lives:
 *  - My Chats           → every conversation where I am the customer.
 *  - Salon Client Chats → (staff) conversations between me and my clients.
 *  - Salon Chats        → (owner/admin) salon-level threads (no staff attached) + broadcasts.
 *  - Staff              → (owner/admin) pick a staff member to view / reply to their client chats.
 *    A staff member's client chats never appear in Salon Chats.
 */
@Component({
  selector: 'app-customer-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IconComponent,
    ChatStatusIconComponent,
    PageHeaderComponent,
    BroadcastModalComponent,
    MediaUrlPipe,
  ],
  template: `
    <div class="max-w-2xl mx-auto px-4 py-4 pb-[calc(var(--bottom-nav-height)+2rem)] md:pb-8">
      <app-page-header backVariant="glass" />

      <!-- Title row -->
      <div class="flex items-start justify-between gap-3 mt-4 mb-3">
        <div class="min-w-0">
          <h1 class="text-xl font-bold text-text-primary truncate">{{ heading() }}</h1>
          <p class="text-xs text-text-secondary mt-0.5">{{ subheading() }}</p>
        </div>

        @if (activeTab() === 'salon' && isManager()) {
          <button
            type="button"
            (click)="showBroadcastModal.set(true)"
            class="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-xs shrink-0"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            <span>Broadcast</span>
          </button>
        }
      </div>

      <!-- Tabs (only when the user has more than one) -->
      @if (tabs().length > 1) {
        <div class="flex items-center gap-1 p-1 bg-surface-sunken rounded-xl mb-4 w-fit max-w-full overflow-x-auto border border-border">
          @for (tab of tabs(); track tab.id) {
            <button
              type="button"
              (click)="setTab(tab.id)"
              [ngClass]="activeTab() === tab.id ? 'bg-surface-card text-text-primary shadow-xs font-semibold' : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay font-medium'"
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg transition whitespace-nowrap"
            >
              <span>{{ tab.label }}</span>
              @if (tab.unread > 0) {
                <span class="min-w-[18px] px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-primary text-white text-center">
                  {{ tab.unread }}
                </span>
              }
            </button>
          }
        </div>
      }

      <!-- ── STAFF TAB: staff directory ── -->
      @if (activeTab() === 'staff' && !selectedStaffId()) {
        @if (staffLoading() && staffList().length === 0) {
          <div class="flex flex-col items-center justify-center py-16">
            <div class="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p class="text-xs text-text-secondary mt-3">Loading staff…</p>
          </div>
        } @else if (staffList().length === 0) {
          <div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-surface-card rounded-2xl border border-border shadow-xs">
            <h3 class="font-semibold text-text-primary text-base">No staff members yet</h3>
            <p class="text-xs text-text-secondary mt-1 max-w-xs">
              Add staff to your salon to see their client conversations here.
            </p>
          </div>
        } @else {
          <div class="space-y-2.5">
            @for (item of filteredStaffList(); track item.staff.id) {
              <button
                type="button"
                (click)="openStaff(item.staff.id)"
                class="w-full flex items-center gap-3.5 p-4 bg-surface-card border border-border rounded-2xl shadow-xs text-left transition hover:bg-surface-overlay active:bg-surface-sunken"
              >
                <div class="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
                  <span>{{ staffName(item).slice(0, 1).toUpperCase() }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="font-semibold text-text-primary text-sm truncate">{{ staffName(item) }}</h3>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide uppercase bg-surface-sunken border border-border text-text-secondary">
                      {{ item.staff.role }}
                    </span>
                    <span class="text-[11px] text-text-secondary">
                      {{ staffChatCount(item.staff.id) }}
                      {{ staffChatCount(item.staff.id) === 1 ? 'chat' : 'chats' }}
                    </span>
                  </div>
                </div>
                @if (staffUnread(item.staff.id) > 0) {
                  <span class="w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    {{ staffUnread(item.staff.id) }}
                  </span>
                }
                <svg class="w-4 h-4 text-text-disabled shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            }
          </div>
        }
      } @else {
        <!-- Drill-in back link for a single staff member -->
        @if (activeTab() === 'staff' && selectedStaffId()) {
          <button
            type="button"
            (click)="closeStaff()"
            class="inline-flex items-center gap-1.5 mb-3 text-xs font-semibold text-text-secondary hover:text-text-primary transition"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span>All staff</span>
          </button>
        }

        <!-- Search -->
        <div class="relative mb-4">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-text-disabled">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            [ngModel]="searchQuery()"
            (ngModelChange)="onSearchChange($event)"
            [placeholder]="searchPlaceholder()"
            class="w-full bg-surface-card text-text-primary placeholder:text-text-disabled rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-border focus:border-primary"
          />
          @if (isSearching()) {
            <span class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <div class="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </span>
          } @else if (searchQuery()) {
            <button
              type="button"
              (click)="clearSearch()"
              class="absolute inset-y-0 right-0 flex items-center pr-3 text-text-disabled hover:text-text-primary transition"
              aria-label="Clear search"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          }
        </div>

        @if (loading()) {
          <div class="flex flex-col items-center justify-center py-20">
            <div class="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p class="text-xs text-text-secondary mt-3">Loading conversations…</p>
          </div>
        } @else if (visibleConversations().length === 0) {
          <div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-surface-card rounded-2xl border border-border shadow-xs">
            <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
              <app-icon name="chat" class="w-7 h-7" />
            </div>
            <h3 class="font-semibold text-text-primary text-base">{{ emptyTitle() }}</h3>
            <p class="text-xs text-text-secondary mt-1 max-w-xs">{{ emptyHint() }}</p>
            @if (activeTab() !== 'my' && salonId()) {
              <a
                [routerLink]="customersLink()"
                class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover active:scale-95 transition shadow-2xs"
              >
                Go to Customers
              </a>
            }
          </div>
        } @else {
          <div class="divide-y divide-border-subtle rounded-2xl bg-surface-card border border-border overflow-hidden shadow-xs">
            @for (conv of visibleConversations(); track conv.id) {
              <a
                [routerLink]="threadLink(conv)"
                [state]="{ conversation: conv }"
                class="flex items-center gap-3.5 px-4 py-3.5 hover:bg-surface-overlay active:bg-surface-sunken transition relative"
              >
                <!-- Avatar -->
                <div class="relative w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
                  @if (conv.type === 'BROADCAST') {
                    <span class="text-xl select-none" aria-hidden="true">📢</span>
                  } @else if (avatarUrl(conv); as url) {
                    <img [src]="url | mediaUrl:'thumb'" alt="Avatar" class="w-full h-full object-cover" />
                  } @else {
                    <span>{{ title(conv).slice(0, 1).toUpperCase() }}</span>
                  }
                </div>

                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2 mb-0.5">
                    <div class="flex items-center gap-2 min-w-0">
                      <h3 class="font-medium text-text-primary text-sm truncate">{{ title(conv) }}</h3>
                      @if (conv.type === 'BROADCAST') {
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary shrink-0">
                          Broadcast
                        </span>
                      }
                    </div>
                    @if (conv.lastMessageAt) {
                      <span class="text-[11px] text-text-disabled shrink-0 select-none">
                        {{ conv.lastMessageAt | date: 'shortTime' }}
                      </span>
                    }
                  </div>

                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1 min-w-0 text-xs text-text-secondary truncate">
                      @if (isLastMessageMine(conv)) {
                        <app-chat-status-icon [status]="conv.lastMessage!.status" />
                      }
                      <span class="truncate">
                        {{ conv.lastMessage?.body || (conv.type === 'BROADCAST' ? 'No broadcast announcements yet' : 'No messages yet') }}
                      </span>
                    </div>
                    @if (conv.unreadCount > 0) {
                      <span class="w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                        {{ conv.unreadCount }}
                      </span>
                    }
                  </div>

                  @if (subtitle(conv); as sub) {
                    <p class="text-[11px] text-text-disabled truncate mt-0.5">{{ sub }}</p>
                  }
                </div>
              </a>
            }
          </div>
        }
      }

      @if (showBroadcastModal() && salonId()) {
        <app-broadcast-modal
          [salonId]="salonId()"
          (closed)="showBroadcastModal.set(false)"
          (sent)="reload()"
        />
      }
    </div>
  `,
})
export class CustomerChatComponent implements OnInit {
  private readonly _chatService = inject(ChatService);
  private readonly _socket = inject(ChatSocketService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _salonsStore = inject(SalonsStore);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _staffService = inject(StaffService);

  protected readonly searchQuery = signal<string>('');
  protected readonly isSearching = signal<boolean>(false);
  private readonly _searchInput$ = new Subject<string>();
  private readonly _lastServerSearch = signal<string>('');
  protected readonly showBroadcastModal = signal<boolean>(false);

  /** Conversations where I am the customer (the "My Chats" inbox). */
  private readonly _personal = signal<ConversationItemDto[]>([]);
  /** Salon-side conversations visible to me (backend scopes these by role). */
  private readonly _salonConvs = signal<ConversationItemDto[]>([]);
  private readonly _personalLoading = signal<boolean>(true);
  private readonly _salonLoading = signal<boolean>(false);
  private readonly _requestedTab = signal<ChatTab | null>(null);
  protected readonly selectedStaffId = signal<string | null>(null);

  protected readonly staffLoading = computed(() => this._staffService.loading());
  protected readonly staffList = computed<StaffWithQueueDto[]>(() => this._staffService.staffList());
  protected readonly filteredStaffList = computed(() => {
    const list = this.staffList();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const name = this.staffName(item).toLowerCase();
      const email = item.staff?.email?.toLowerCase() || '';
      return name.includes(q) || email.includes(q);
    });
  });

  private readonly _myUserId = computed(() => this._currentUser.user()?.id ?? null);

  // ── Salon / role resolution ────────────────────────────────────────────────
  // The salon whose chats the user works from: the one currently selected in
  // the shell, falling back to the first salon they work at.
  private readonly _membership = computed(() => {
    const salons = this._salonsStore.salons();
    if (salons.length === 0) return null;
    const preferred = this._salonContext.activeSalonId() ?? this._salonContext.displaySalonId();
    return salons.find((s) => s.salon.id === preferred) ?? salons[0];
  });

  protected readonly salonId = computed(() => this._membership()?.salon.id ?? '');

  protected readonly isManager = computed(() => {
    const r = this._membership()?.role;
    return r === SalonRole.OWNER || r === SalonRole.ADMIN;
  });
  protected readonly isStaffOnly = computed(() => this._membership()?.role === SalonRole.STAFF);

  // ── Conversation buckets ───────────────────────────────────────────────────
  // Threads where I'm the customer always belong to My Chats, never to a salon tab.
  private readonly _salonSideConvs = computed(() => {
    const me = this._myUserId();
    return this._salonConvs().filter((c) => !(me && c.customerId === me));
  });

  /** Staff: my own client chats (backend already scopes to my staffId). */
  protected readonly clientConversations = computed(() =>
    this._salonSideConvs().filter((c) => c.type !== 'BROADCAST'),
  );

  /** Owner/Admin: salon-level threads (no staff attached) + broadcast announcements. */
  protected readonly salonConversations = computed(() =>
    this._salonSideConvs().filter((c) => c.type === 'BROADCAST' || !c.staffId),
  );

  /** Owner/Admin: every thread that belongs to a specific staff member. */
  private readonly _staffThreads = computed(() =>
    this._salonSideConvs().filter((c) => c.type !== 'BROADCAST' && !!c.staffId),
  );

  // ── Tabs ───────────────────────────────────────────────────────────────────
  protected readonly tabs = computed<{ id: ChatTab; label: string; unread: number }[]>(() => {
    const tabs: { id: ChatTab; label: string; unread: number }[] = [
      { id: 'my', label: 'My Chats', unread: this._sumUnread(this._personal()) },
    ];
    if (this.isStaffOnly()) {
      tabs.push({
        id: 'clients',
        label: 'Salon Client Chats',
        unread: this._sumUnread(this.clientConversations()),
      });
    } else if (this.isManager()) {
      tabs.push({
        id: 'salon',
        label: 'Salon Chats',
        unread: this._sumUnread(this.salonConversations()),
      });
      tabs.push({ id: 'staff', label: 'Staff', unread: this._sumUnread(this._staffThreads()) });
    }
    return tabs;
  });

  protected readonly activeTab = computed<ChatTab>(() => {
    const available = this.tabs();
    const requested = this._requestedTab();
    return available.find((t) => t.id === requested)?.id ?? available[0].id;
  });

  protected readonly loading = computed(() =>
    this.activeTab() === 'my' ? this._personalLoading() : this._salonLoading(),
  );

  protected readonly visibleConversations = computed(() => {
    let list: ConversationItemDto[];
    switch (this.activeTab()) {
      case 'clients':
        list = this.clientConversations();
        break;
      case 'salon':
        list = this.salonConversations();
        break;
      case 'staff': {
        const id = this.selectedStaffId();
        list = id ? this._staffThreads().filter((c) => c.staffId === id) : [];
        break;
      }
      default:
        list = this._personal();
    }
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    if (this._lastServerSearch().trim().toLowerCase() === q) {
      return list;
    }
    return list.filter(
      (c) =>
        (c.customerName && c.customerName.toLowerCase().includes(q)) ||
        (c.customerPhone && c.customerPhone.includes(q)) ||
        (c.staffName && c.staffName.toLowerCase().includes(q)) ||
        (c.salonName && c.salonName.toLowerCase().includes(q)) ||
        (c.lastMessage?.body && c.lastMessage.body.toLowerCase().includes(q)),
    );
  });

  // ── Copy ───────────────────────────────────────────────────────────────────
  private readonly _selectedStaffName = computed(() => {
    const id = this.selectedStaffId();
    if (!id) return '';
    const item = this.staffList().find((s) => s.staff.id === id);
    return item ? this.staffName(item) : 'Staff member';
  });

  protected readonly heading = computed(() => {
    switch (this.activeTab()) {
      case 'clients':
        return 'Salon Client Chats';
      case 'salon':
        return 'Salon Chats';
      case 'staff':
        return this.selectedStaffId() ? `${this._selectedStaffName()}'s Chats` : 'Staff';
      default:
        return 'My Chats';
    }
  });

  protected readonly subheading = computed(() => {
    switch (this.activeTab()) {
      case 'clients':
        return 'Conversations with your clients.';
      case 'salon':
        return 'Salon-level conversations and broadcast announcements.';
      case 'staff':
        return this.selectedStaffId()
          ? 'Client conversations for this staff member. You can reply too.'
          : 'Pick a staff member to view their client chats.';
      default:
        return 'Your personal conversations.';
    }
  });

  protected readonly searchPlaceholder = computed(() =>
    this.activeTab() === 'my' ? 'Search my chats…' : 'Search conversations…',
  );

  protected readonly emptyTitle = computed(() => {
    switch (this.activeTab()) {
      case 'clients':
        return 'No client chats yet';
      case 'salon':
        return 'No salon chats yet';
      case 'staff':
        return 'No chats for this staff member';
      default:
        return 'No chats yet';
    }
  });

  protected readonly emptyHint = computed(() => {
    switch (this.activeTab()) {
      case 'clients':
        return 'Message a customer from the Customers page and the chat will show up here.';
      case 'salon':
        return 'Message a customer from the Customers → Salon tab to start a salon chat.';
      case 'staff':
        return 'Open Customers → Staff, pick one of this staff member’s customers and start a chat.';
      default:
        return 'Start a chat with your favourite barbers or salons from their profile pages!';
    }
  });

  constructor() {
    // Load salon-side data whenever the active salon (or my role there) changes.
    effect(() => {
      const sId = this.salonId();
      if (!sId) {
        this._salonConvs.set([]);
        this._salonLoading.set(false);
        return;
      }
      this._loadSalonConversations(sId);
      if (this.isManager()) {
        this._staffService.load(sId);
      }
    });

    // Keep lists fresh when messages arrive in real time.
    merge(this._socket.messageReceived$, this._socket.badgeUpdated$)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.reload());

    // Debounced server search
    this._searchInput$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((query) => {
        this._triggerSearch(query);
      });
  }

  private static readonly TAB_STORAGE_KEY = 'hm_active_chat_tab';

  ngOnInit(): void {
    const q = this._route.snapshot.queryParamMap;
    const tab = q.get('tab') as ChatTab | null;
    if (tab) {
      this._requestedTab.set(tab);
      if (typeof window !== 'undefined') {
        localStorage.setItem(CustomerChatComponent.TAB_STORAGE_KEY, tab);
      }
    } else if (typeof window !== 'undefined') {
      const savedTab = localStorage.getItem(CustomerChatComponent.TAB_STORAGE_KEY) as ChatTab | null;
      if (savedTab) {
        this._requestedTab.set(savedTab);
      }
    }
    this.selectedStaffId.set(q.get('staff'));
    this._loadPersonal();
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  protected onSearchChange(term: string): void {
    this.searchQuery.set(term);
    this._searchInput$.next(term);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
    this._lastServerSearch.set('');
    this._searchInput$.next('');
    this._triggerSearch('');
  }

  private _triggerSearch(query: string): void {
    const q = query.trim() || undefined;
    if (this.activeTab() === 'my') {
      this._loadPersonal(false, q);
    } else {
      const sId = this.salonId();
      if (sId) {
        this._loadSalonConversations(sId, false, q);
      }
    }
  }

  protected setTab(tab: ChatTab): void {
    this._requestedTab.set(tab);
    this.selectedStaffId.set(null);
    this.searchQuery.set('');
    this._lastServerSearch.set('');
    if (typeof window !== 'undefined') {
      localStorage.setItem(CustomerChatComponent.TAB_STORAGE_KEY, tab);
    }
    this._syncQuery({ tab, staff: null });
    if (tab === 'my') {
      this._loadPersonal(false);
    } else {
      const sId = this.salonId();
      if (sId) this._loadSalonConversations(sId, false);
    }
  }

  protected openStaff(staffId: string): void {
    this.selectedStaffId.set(staffId);
    this.searchQuery.set('');
    this._lastServerSearch.set('');
    this._syncQuery({ tab: 'staff', staff: staffId });
    const sId = this.salonId();
    if (sId) this._loadSalonConversations(sId, false);
  }

  protected closeStaff(): void {
    this.selectedStaffId.set(null);
    this.searchQuery.set('');
    this._lastServerSearch.set('');
    this._syncQuery({ tab: 'staff', staff: null });
    const sId = this.salonId();
    if (sId) this._loadSalonConversations(sId, false);
  }

  reload(): void {
    const q = this.searchQuery().trim() || undefined;
    this._loadPersonal(false, q);
    const sId = this.salonId();
    if (sId) this._loadSalonConversations(sId, false, q);
  }

  // ── Row helpers ────────────────────────────────────────────────────────────
  /** True when I'm the customer in this thread (so the "other side" is the salon/staff). */
  private _isCustomerView(conv: ConversationItemDto): boolean {
    const me = this._myUserId();
    return !!me && conv.customerId === me;
  }

  protected title(conv: ConversationItemDto): string {
    if (conv.type === 'BROADCAST') return 'Broadcast Announcements';
    if (this._isCustomerView(conv)) return conv.staffName || conv.salonName || 'HairMela';
    return conv.customerName || 'Customer';
  }

  protected avatarUrl(conv: ConversationItemDto): string | null {
    if (this._isCustomerView(conv)) return conv.staffAvatarUrl || conv.salonLogoUrl || null;
    return conv.customerAvatarUrl || conv.staffAvatarUrl || conv.salonLogoUrl || null;
  }

  protected subtitle(conv: ConversationItemDto): string {
    if (conv.type === 'BROADCAST') return 'All favourited customers';
    if (this._isCustomerView(conv)) return conv.staffName ? conv.salonName : '';
    return conv.customerPhone || '';
  }

  protected isLastMessageMine(conv: ConversationItemDto): boolean {
    const last = conv.lastMessage;
    if (!last) return false;
    return this._isCustomerView(conv) ? last.senderRole === 'CUSTOMER' : last.senderRole === 'STAFF';
  }

  protected threadLink(conv: ConversationItemDto): string[] {
    return RoutePath.chatThread(conv.id);
  }

  protected customersLink(): string[] {
    return RoutePath.salonCustomers(this.salonId());
  }

  // ── Staff-tab helpers ──────────────────────────────────────────────────────
  protected staffName(item: StaffWithQueueDto): string {
    const u = item.staff?.user;
    if (!u) return item.staff?.email || 'Staff member';
    return `${u.firstName || ''} ${u.lastName || ''}`.trim() || item.staff.email || 'Staff member';
  }

  protected staffChatCount(staffId: string): number {
    return this._staffThreads().filter((c) => c.staffId === staffId).length;
  }

  protected staffUnread(staffId: string): number {
    return this._sumUnread(this._staffThreads().filter((c) => c.staffId === staffId));
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  private _sumUnread(list: ConversationItemDto[]): number {
    return list.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  }

  private _loadPersonal(showSpinner = true, q?: string): void {
    if (showSpinner) this._personalLoading.set(true);
    if (q !== undefined) this.isSearching.set(true);
    this._chatService.getCustomerConversations(1, 100, q).subscribe({
      next: (res) => {
        this._personal.set(res.data);
        this._lastServerSearch.set(q ?? '');
        this._personalLoading.set(false);
        this.isSearching.set(false);
      },
      error: () => {
        this._personalLoading.set(false);
        this.isSearching.set(false);
      },
    });
  }

  private _loadSalonConversations(salonId: string, showSpinner = true, q?: string): void {
    if (showSpinner) this._salonLoading.set(true);
    if (q !== undefined) this.isSearching.set(true);
    this._chatService.getSalonConversations(salonId, 1, 100, undefined, q).subscribe({
      next: (res) => {
        this._salonConvs.set(res.data);
        this._lastServerSearch.set(q ?? '');
        this._salonLoading.set(false);
        this.isSearching.set(false);
      },
      error: () => {
        this._salonLoading.set(false);
        this.isSearching.set(false);
      },
    });
  }

  private _syncQuery(params: { tab: ChatTab; staff: string | null }): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
