import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatService } from '../../../core/chat/chat.service';
import { StaffService } from '../../staff/staff.service';
import { ConversationItemDto } from '../../../core/chat/chat.types';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ChatStatusIconComponent } from '../../chat/chat-status-icon/chat-status-icon.component';
import { BroadcastModalComponent } from './broadcast-modal.component';
import { StaffWithQueueDto } from '../../../api/models/staff-with-queue-dto';

@Component({
  selector: 'app-salon-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    IconComponent,
    ChatStatusIconComponent,
    BroadcastModalComponent,
  ],
  template: `
    <div class="max-w-3xl mx-auto px-4 py-4 pb-[calc(var(--bottom-nav-height)+2rem)] md:pb-8">
      <app-page-header backVariant="glass" />

      <!-- Page Title & Header Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 my-4">
        <div>
          <h1 class="text-xl font-bold text-text-primary">
            {{ isOwnerOrAdmin() ? 'Salon Messages' : 'My Client Messages' }}
          </h1>
          <p class="text-xs text-text-secondary mt-0.5">
            {{ isOwnerOrAdmin() ? 'Manage salon inquiries, broadcast updates, and inspect staff customer chats.' : 'View and reply to messages from your clients.' }}
          </p>
        </div>

        <!-- Broadcast Button (Owner / Admin Only) -->
        @if (isOwnerOrAdmin()) {
          <button
            type="button"
            (click)="showBroadcastModal.set(true)"
            class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-xs shrink-0"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            <span>Broadcast to Customers</span>
          </button>
        }
      </div>

      <!-- Segmented Navigation Tabs (Only for Owner / Admin) -->
      @if (isOwnerOrAdmin()) {
        <div class="flex items-center gap-2 p-1 bg-slate-100 dark:bg-zinc-800/80 rounded-xl mb-5 w-fit border border-border/40">
          <button
            type="button"
            (click)="setTab('salon')"
            [ngClass]="activeTab() === 'salon' ? 'bg-white dark:bg-zinc-700 text-text-primary shadow-xs font-semibold' : 'text-text-secondary hover:text-text-primary font-medium'"
            class="px-4 py-1.5 text-xs rounded-lg transition"
          >
            Salon Messages
          </button>
          <button
            type="button"
            (click)="setTab('staff')"
            [ngClass]="activeTab() === 'staff' ? 'bg-white dark:bg-zinc-700 text-text-primary shadow-xs font-semibold' : 'text-text-secondary hover:text-text-primary font-medium'"
            class="px-4 py-1.5 text-xs rounded-lg transition"
          >
            Staff Chats
          </button>
        </div>
      }

      <!-- TAB 1: SALON MESSAGES (or Staff's Assigned Messages) -->
      @if (activeTab() === 'salon' || !isOwnerOrAdmin()) {
        <!-- Search -->
        <div class="relative mb-4">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-text-disabled">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            [(ngModel)]="searchQuery"
            placeholder="Search conversations..."
            class="w-full bg-slate-100 dark:bg-zinc-800 text-text-primary placeholder:text-text-disabled rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-transparent focus:border-primary/30"
          />
        </div>

        @if (loading()) {
          <div class="flex flex-col items-center justify-center py-16">
            <div class="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p class="text-xs text-text-secondary mt-3">Loading messages...</p>
          </div>
        } @else if (filteredConversations().length === 0) {
          <div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-white dark:bg-zinc-900 rounded-2xl border border-border/60">
            <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
              <app-icon name="chat" class="w-7 h-7" />
            </div>
            <h3 class="font-semibold text-text-primary text-base">No messages</h3>
            <p class="text-xs text-text-secondary mt-1 max-w-xs">
              Direct inquiries and customer conversations will appear here.
            </p>
          </div>
        } @else {
          <div class="divide-y divide-border/40 rounded-2xl bg-white dark:bg-zinc-900 border border-border/60 overflow-hidden shadow-xs">
            @for (conv of filteredConversations(); track conv.id) {
              <a
                [routerLink]="getThreadRoute(conv.id)"
                class="flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-zinc-800/60 active:bg-slate-100 transition relative"
              >
                <!-- Avatar -->
                <div class="relative w-12 h-12 rounded-full flex items-center justify-center font-bold text-base shrink-0 overflow-hidden"
                  [ngClass]="conv.type === 'BROADCAST' ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary'">
                  @if (conv.type === 'BROADCAST') {
                    <span class="text-xl select-none" aria-hidden="true">📢</span>
                  } @else if (conv.customerAvatarUrl) {
                    <img [src]="conv.customerAvatarUrl" alt="Avatar" class="w-full h-full object-cover" />
                  } @else {
                    <span>{{ (conv.customerName || 'Customer').slice(0, 1).toUpperCase() }}</span>
                  }
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2 mb-0.5">
                    <div class="flex items-center gap-2 min-w-0">
                      <h3 class="font-medium text-text-primary text-sm truncate">
                        {{ conv.customerName || (conv.type === 'BROADCAST' ? 'Broadcast Announcements' : 'Customer') }}
                      </h3>
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
                      @if (conv.lastMessage?.senderRole === 'STAFF') {
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

                  <p class="text-[11px] text-text-disabled truncate mt-0.5">
                    @if (conv.type === 'BROADCAST') {
                      <span class="text-primary font-medium">All favourited customers</span>
                    } @else if (conv.isSalonGeneral) {
                      <span class="text-primary font-medium">Salon General Inbox</span>
                    } @else if (conv.staffName) {
                      <span>Assigned to {{ conv.staffName }}</span>
                    }
                    @if (conv.customerPhone && conv.type !== 'BROADCAST') {
                      <span> · {{ conv.customerPhone }}</span>
                    }
                  </p>
                </div>
              </a>
            }
          </div>
        }
      }

      <!-- TAB 2: STAFF LIST WITH VIEW CHATS BUTTON (Owner / Admin Only) -->
      @if (activeTab() === 'staff' && isOwnerOrAdmin()) {
        @if (staffLoading()) {
          <div class="flex flex-col items-center justify-center py-16">
            <div class="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p class="text-xs text-text-secondary mt-3">Loading staff directory...</p>
          </div>
        } @else if (staffList().length === 0) {
          <div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-white dark:bg-zinc-900 rounded-2xl border border-border/60">
            <h3 class="font-semibold text-text-primary text-base">No staff members found</h3>
            <p class="text-xs text-text-secondary mt-1">
              Add staff to your salon to inspect their 1-on-1 customer conversations.
            </p>
          </div>
        } @else {
          <div class="space-y-3">
            @for (item of staffList(); track item.staff.id) {
              <div class="flex items-center justify-between gap-3 p-4 bg-white dark:bg-zinc-900 border border-border/60 rounded-2xl shadow-xs transition hover:border-border">
                <div class="flex items-center gap-3.5 min-w-0">
                  <!-- Avatar -->
                  <div class="relative w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
                    <span>{{ getStaffName(item).slice(0, 1).toUpperCase() }}</span>
                  </div>

                  <!-- Details -->
                  <div class="min-w-0">
                    <h3 class="font-semibold text-text-primary text-sm truncate">
                      {{ getStaffName(item) }}
                    </h3>
                    <p class="text-xs text-text-secondary truncate mt-0.5">
                      {{ item.staff.email }}
                    </p>
                    <div class="flex items-center gap-2 mt-1">
                      <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide uppercase bg-slate-100 dark:bg-zinc-800 text-text-secondary">
                        {{ item.staff.role }}
                      </span>
                      @if (item.staff.isAcceptingClients) {
                        <span class="text-[11px] text-emerald-500 font-medium">Accepting clients</span>
                      }
                    </div>
                  </div>
                </div>

                <!-- View Chats Action Button -->
                <a
                  [routerLink]="getStaffChatsRoute(item.staff.id)"
                  class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-zinc-800 text-text-primary hover:bg-primary hover:text-white transition active:scale-95 shrink-0 shadow-xs"
                >
                  <app-icon name="chat" class="w-3.5 h-3.5" />
                  <span>View Chats</span>
                </a>
              </div>
            }
          </div>
        }
      }

      <!-- Broadcast Modal Dialog -->
      @if (showBroadcastModal()) {
        <app-broadcast-modal
          [salonId]="salonId()"
          (closed)="showBroadcastModal.set(false)"
          (sent)="onBroadcastSent()"
        />
      }
    </div>
  `,
})
export class SalonChatComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _chatService = inject(ChatService);
  private readonly _staffService = inject(StaffService);
  private readonly _salonsStore = inject(SalonsStore);
  protected readonly salonContext = inject(SalonContextService);

  readonly salonId = computed(
    () =>
      this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ??
      this._route.parent?.snapshot.paramMap.get(RouteParam.SALON_ID) ??
      this.salonContext.activeSalonId() ??
      this.salonContext.displaySalonId() ??
      this._salonsStore.salons().find((s) => s.role === 'OWNER' || s.role === 'ADMIN')?.salon.id ??
      '',
  );

  protected readonly activeTab = signal<'salon' | 'staff'>('salon');
  protected readonly conversations = signal<ConversationItemDto[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly staffLoading = computed(() => this._staffService.loading());
  protected readonly staffList = computed<StaffWithQueueDto[]>(() => this._staffService.staffList());
  protected readonly searchQuery = signal<string>('');
  protected readonly showBroadcastModal = signal<boolean>(false);

  protected readonly role = computed(() => {
    const sId = this.salonId();
    const fromMembership =
      this.salonContext.membership()?.role || this.salonContext.displayMembership()?.role;
    if (fromMembership) return fromMembership;
    const mySalon = this._salonsStore.salons().find((s) => s.salon.id === sId);
    return (mySalon?.role as SalonRole) || SalonRole.OWNER;
  });

  protected readonly isOwnerOrAdmin = computed(() => {
    const r = this.role();
    return r === SalonRole.OWNER || r === SalonRole.ADMIN;
  });

  protected readonly myStaffId = computed(() => this.salonContext.membership()?.staffId);

  protected readonly filteredConversations = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.conversations();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.customerName && c.customerName.toLowerCase().includes(q)) ||
        (c.customerPhone && c.customerPhone.includes(q)) ||
        (c.staffName && c.staffName.toLowerCase().includes(q)) ||
        (c.lastMessage?.body && c.lastMessage.body.toLowerCase().includes(q)),
    );
  });

  constructor() {
    effect(() => {
      const sId = this.salonId();
      if (!sId) return;
      this._loadConversations(sId);
      this._staffService.load(sId);
    });
  }

  ngOnInit(): void {
    const queryTab = this._route.snapshot.queryParamMap.get('tab');
    if (queryTab === 'staff') {
      this.activeTab.set('staff');
    }
  }

  protected setTab(tab: 'salon' | 'staff'): void {
    this.activeTab.set(tab);
    const sId = this.salonId();
    if (tab === 'staff' && sId && this.staffList().length === 0) {
      this._staffService.load(sId);
    }
  }

  private _loadConversations(salonId: string): void {
    this.loading.set(true);
    const staffIdParam = !this.isOwnerOrAdmin() ? this.myStaffId() || undefined : undefined;
    this._chatService.getSalonConversations(salonId, 1, 50, staffIdParam).subscribe({
      next: (res) => {
        this.conversations.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  protected onBroadcastSent(): void {
    const sId = this.salonId();
    if (sId) {
      this._loadConversations(sId);
    }
  }

  protected getThreadRoute(conversationId: string): string[] {
    return RoutePath.salonChatThread(this.salonId(), conversationId);
  }

  protected getStaffChatsRoute(staffId: string): string[] {
    return RoutePath.salonStaffChats(this.salonId(), staffId);
  }

  protected getStaffName(item: StaffWithQueueDto): string {
    const u = item.staff.user;
    if (!u) return item.staff.email || 'Staff Member';
    return `${u.firstName || ''} ${u.lastName || ''}`.trim() || item.staff.email;
  }
}
