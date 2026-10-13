import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ChatService } from '../../../core/chat/chat.service';
import { StaffService } from '../../staff/staff.service';
import { ConversationItemDto } from '../../../core/chat/chat.types';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ChatStatusIconComponent } from '../../chat/chat-status-icon/chat-status-icon.component';

@Component({
  selector: 'app-selected-staff-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    IconComponent,
    ChatStatusIconComponent,
  ],
  template: `
    <div class="max-w-3xl mx-auto px-4 py-4 pb-[calc(var(--bottom-nav-height)+2rem)] md:pb-8">
      <app-page-header backVariant="glass" />

      <!-- Back Link & Staff Header -->
      <div class="flex items-center gap-3 my-4">
        <a
          [routerLink]="backToSalonChats()"
          [queryParams]="{ tab: 'staff' }"
          class="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 text-text-primary transition"
          aria-label="Back to staff list"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </a>

        <div class="min-w-0">
          <h1 class="text-xl font-bold text-text-primary truncate">
            {{ staffName() }}'s Chats
          </h1>
          <p class="text-xs text-text-secondary mt-0.5">
            Viewing customer conversations assigned to this barber/stylist.
          </p>
        </div>
      </div>

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
          placeholder="Search customer conversations..."
          class="w-full bg-slate-100 dark:bg-zinc-800 text-text-primary placeholder:text-text-disabled rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-transparent focus:border-primary/30"
        />
      </div>

      <!-- Loading State -->
      @if (loading()) {
        <div class="flex flex-col items-center justify-center py-16">
          <div class="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p class="text-xs text-text-secondary mt-3">Loading staff conversations...</p>
        </div>
      } @else if (filteredConversations().length === 0) {
        <div class="flex flex-col items-center justify-center text-center py-16 px-4 bg-white dark:bg-zinc-900 rounded-2xl border border-border/60">
          <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
            <app-icon name="chat" class="w-7 h-7" />
          </div>
          <h3 class="font-semibold text-text-primary text-base">No chats for this staff</h3>
          <p class="text-xs text-text-secondary mt-1 max-w-xs">
            When customers message {{ staffName() }} directly, their conversations will show here.
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
              <div class="relative w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
                @if (conv.customerAvatarUrl) {
                  <img [src]="conv.customerAvatarUrl" alt="Avatar" class="w-full h-full object-cover" />
                } @else {
                  <span>{{ (conv.customerName || 'Customer').slice(0, 1).toUpperCase() }}</span>
                }
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 mb-0.5">
                  <h3 class="font-medium text-text-primary text-sm truncate">
                    {{ conv.customerName || 'Customer' }}
                  </h3>
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
                      {{ conv.lastMessage?.body || 'No messages yet' }}
                    </span>
                  </div>

                  @if (conv.unreadCount > 0) {
                    <span class="w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {{ conv.unreadCount }}
                    </span>
                  }
                </div>

                @if (conv.customerPhone) {
                  <p class="text-[11px] text-text-disabled truncate mt-0.5">
                    {{ conv.customerPhone }}
                  </p>
                }
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class SelectedStaffChatComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _chatService = inject(ChatService);
  private readonly _staffService = inject(StaffService);

  protected readonly salonId = signal<string>('');
  protected readonly staffId = signal<string>('');
  protected readonly conversations = signal<ConversationItemDto[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly searchQuery = signal<string>('');

  protected readonly staffName = computed(() => {
    const sId = this.staffId();
    const list = this._staffService.staffList();
    const item = list.find((s) => s.staff.id === sId);
    if (!item) return 'Staff';
    const u = item.staff.user;
    if (!u) return item.staff.email || 'Staff';
    return `${u.firstName || ''} ${u.lastName || ''}`.trim() || item.staff.email;
  });

  protected readonly filteredConversations = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.conversations();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.customerName && c.customerName.toLowerCase().includes(q)) ||
        (c.customerPhone && c.customerPhone.includes(q)) ||
        (c.lastMessage?.body && c.lastMessage.body.toLowerCase().includes(q)),
    );
  });

  ngOnInit(): void {
    const sId = this._route.snapshot.paramMap.get(RouteParam.SALON_ID) || '';
    const stId = this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) || '';
    this.salonId.set(sId);
    this.staffId.set(stId);

    if (sId) {
      this._staffService.load(sId);
      this._loadStaffConversations(sId, stId);
    }
  }

  private _loadStaffConversations(salonId: string, staffId: string): void {
    this.loading.set(true);
    this._chatService.getSalonConversations(salonId, 1, 50, staffId).subscribe({
      next: (res) => {
        this.conversations.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  protected backToSalonChats(): string[] {
    return RoutePath.salonChats(this.salonId());
  }

  protected getThreadRoute(conversationId: string): string[] {
    return RoutePath.salonChatThread(this.salonId(), conversationId);
  }
}

