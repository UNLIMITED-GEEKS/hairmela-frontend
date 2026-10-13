import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChatService } from '../../../core/chat/chat.service';
import { ConversationItemDto } from '../../../core/chat/chat.types';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ChatStatusIconComponent } from '../chat-status-icon/chat-status-icon.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RoutePath } from '../../../core/routing/route-paths';

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
  ],
  template: `
    <div class="max-w-2xl mx-auto px-4 py-4 pb-[calc(var(--bottom-nav-height)+2rem)] md:pb-8">
      <app-page-header backVariant="glass" />

      <!-- Search Box -->
      <div class="relative my-4">
        <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-text-disabled">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          type="text"
          [(ngModel)]="searchQuery"
          placeholder="Search chats..."
          class="w-full bg-slate-100 dark:bg-zinc-800 text-text-primary placeholder:text-text-disabled rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-transparent focus:border-primary/30"
        />
      </div>

      <!-- Loading State -->
      @if (loading()) {
        <div class="flex flex-col items-center justify-center py-20">
          <div class="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p class="text-xs text-text-secondary mt-3">Loading conversations...</p>
        </div>
      } @else if (filteredConversations().length === 0) {
        <!-- Empty State -->
        <div class="flex flex-col items-center justify-center text-center py-20 px-4">
          <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
            <app-icon name="chat" class="w-8 h-8" />
          </div>
          <h3 class="font-semibold text-text-primary text-base">No conversations yet</h3>
          <p class="text-xs text-text-secondary mt-1 max-w-xs">
            Start a chat with your favourite barbers or salons from their profile pages!
          </p>
        </div>
      } @else {
        <!-- Conversation List -->
        <div class="divide-y divide-border/40 rounded-2xl bg-white dark:bg-zinc-900 border border-border/60 overflow-hidden shadow-xs">
          @for (conv of filteredConversations(); track conv.id) {
            <a
              [routerLink]="['/chat', conv.id]"
              class="flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-zinc-800/60 active:bg-slate-100 transition relative"
            >
              <!-- Avatar -->
              <div class="relative w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
                @if (conv.staffAvatarUrl || conv.salonLogoUrl) {
                  <img
                    [src]="conv.staffAvatarUrl || conv.salonLogoUrl"
                    alt="Avatar"
                    class="w-full h-full object-cover"
                  />
                } @else {
                  <span>{{ (conv.staffName || conv.salonName).slice(0, 1).toUpperCase() }}</span>
                }
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 mb-0.5">
                  <h3 class="font-medium text-text-primary text-sm truncate">
                    {{ conv.staffName || conv.salonName }}
                  </h3>
                  @if (conv.lastMessageAt) {
                    <span class="text-[11px] text-text-disabled shrink-0 select-none">
                      {{ conv.lastMessageAt | date: 'shortTime' }}
                    </span>
                  }
                </div>

                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1 min-w-0 text-xs text-text-secondary truncate">
                    @if (conv.lastMessage?.senderRole === 'CUSTOMER') {
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

                <!-- Salon Subtitle if Staff 1-on-1 -->
                @if (conv.staffName) {
                  <p class="text-[11px] text-text-disabled truncate mt-0.5">
                    {{ conv.salonName }}
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
export class CustomerChatComponent implements OnInit {
  private readonly _chatService = inject(ChatService);
  private readonly _router = inject(Router);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _salonsStore = inject(SalonsStore);

  protected readonly conversations = signal<ConversationItemDto[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly searchQuery = signal<string>('');

  constructor() {
    effect(() => {
      const sId = this._salonContext.activeSalonId() || this._salonContext.displaySalonId();
      const role = this._salonContext.membership()?.role || this._salonContext.displayMembership()?.role;
      if (sId && (role === SalonRole.OWNER || role === SalonRole.ADMIN)) {
        this._router.navigate(RoutePath.salonChats(sId));
        return;
      }
      const mySalons = this._salonsStore.salons();
      const ownerOrAdmin = mySalons.find((s) => s.role === 'OWNER' || s.role === 'ADMIN');
      if (ownerOrAdmin) {
        this._router.navigate(RoutePath.salonChats(ownerOrAdmin.salon.id));
      }
    });
  }

  protected readonly filteredConversations = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.conversations();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.staffName && c.staffName.toLowerCase().includes(q)) ||
        (c.salonName && c.salonName.toLowerCase().includes(q)) ||
        (c.lastMessage?.body && c.lastMessage.body.toLowerCase().includes(q)),
    );
  });

  ngOnInit(): void {
    const sId = this._salonContext.activeSalonId() || this._salonContext.displaySalonId();
    const role = this._salonContext.membership()?.role || this._salonContext.displayMembership()?.role;
    if (sId && (role === SalonRole.OWNER || role === SalonRole.ADMIN)) {
      this._router.navigate(RoutePath.salonChats(sId));
      return;
    }
    const mySalons = this._salonsStore.salons();
    const ownerOrAdmin = mySalons.find((s) => s.role === 'OWNER' || s.role === 'ADMIN');
    if (ownerOrAdmin) {
      this._router.navigate(RoutePath.salonChats(ownerOrAdmin.salon.id));
      return;
    }
    this._load();
  }

  private _load(): void {
    this.loading.set(true);
    this._chatService.getCustomerConversations().subscribe({
      next: (res) => {
        this.conversations.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}

