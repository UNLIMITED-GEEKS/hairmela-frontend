import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { ChatService } from '../../../core/chat/chat.service';
import { ChatSocketService } from '../../../core/chat/chat-socket.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RouteParam } from '../../../core/routing/route-paths';
import {
  ConversationItemDto,
  ConversationMessageDto,
  MessageSenderRole,
} from '../../../core/chat/chat.types';
import { ChatStatusIconComponent } from '../chat-status-icon/chat-status-icon.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ToastService } from '../../../core/toast/toast.service';
import { uploadAdHocImage } from '../../../core/media/media-upload';

@Component({
  selector: 'app-chat-thread',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatStatusIconComponent, IconComponent],
  host: {
    class: 'block w-full',
  },
  template: `
    <div class="flex flex-col h-[calc(100vh-5.5rem-var(--bottom-nav-height))] supports-[height:100dvh]:h-[calc(100dvh-5.5rem-var(--bottom-nav-height))] md:h-[calc(100vh-4rem)] md:supports-[height:100dvh]:h-[calc(100dvh-4rem)] max-w-3xl mx-auto bg-slate-50 dark:bg-zinc-950 border border-border/40 shadow-sm relative overflow-hidden rounded-2xl md:rounded-xl">
      <!-- Chat Header -->
      <header class="flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-zinc-900 border-b border-border z-10 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <button
            type="button"
            (click)="goBack()"
            class="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 text-text-primary transition"
            aria-label="Back"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <!-- Avatar -->
          <div class="relative w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
            @if (avatarUrl()) {
              <img [src]="avatarUrl()" alt="Avatar" class="w-full h-full object-cover" />
            } @else {
              <span>{{ displayName().slice(0, 1).toUpperCase() }}</span>
            }
          </div>

          <!-- Title & Status -->
          <div class="min-w-0">
            <h2 class="font-semibold text-text-primary truncate text-base leading-tight">
              {{ displayName() }}
            </h2>
            <p class="text-xs text-text-secondary truncate mt-0.5">
              @if (isPartnerTyping()) {
                <span class="text-emerald-500 font-medium animate-pulse">
                  {{ partnerTypingName() ? partnerTypingName() + ' is typing...' : 'typing...' }}
                </span>
              } @else if (isBlocked()) {
                <span class="text-error font-medium">Blocked</span>
              } @else if (subTitle()) {
                <span>{{ subTitle() }}</span>
              } @else {
                <span class="text-emerald-500 font-medium">Active</span>
              }
            </p>
          </div>
        </div>

        <!-- Header Actions: Block / Unblock -->
        @if (!isBroadcastConversation()) {
          <div class="flex items-center gap-2 shrink-0">
            @if (isBlocked()) {
              <button
                type="button"
                (click)="unblock()"
                [disabled]="blockingAction()"
                class="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-2xs"
              >
                Unblock
              </button>
            } @else {
              <button
                type="button"
                (click)="block()"
                [disabled]="blockingAction()"
                class="px-2.5 py-1.5 rounded-full text-xs font-medium text-text-secondary hover:text-error hover:bg-error-light/50 transition"
                title="Block conversation"
              >
                Block
              </button>
            }
          </div>
        }
      </header>

      <!-- Blocked In-Thread Banner -->
      @if (isBlocked()) {
        <div class="px-4 py-2.5 bg-error-light/70 dark:bg-error/10 border-b border-error/20 flex items-center justify-between gap-3 text-xs z-10 shrink-0">
          <div class="flex items-center gap-2 text-error">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span class="font-medium">This conversation has been blocked.</span>
          </div>
          <button
            type="button"
            (click)="unblock()"
            [disabled]="blockingAction()"
            class="text-xs font-semibold text-error underline hover:no-underline"
          >
            Unblock
          </button>
        </div>
      }

      <!-- Messages Stream -->
      <div
        #scrollContainer
        (scroll)="onScroll()"
        class="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-100/70 dark:bg-zinc-900/40 relative"
      >
        <!-- Loading Older Spinner -->
        @if (loadingOlder()) {
          <div class="flex justify-center py-2">
            <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        }

        <!-- Empty State -->
        @if (!loading() && messages().length === 0) {
          <div class="flex flex-col items-center justify-center h-full text-center py-12 px-4 text-text-secondary">
            <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
              <app-icon name="chat" class="w-7 h-7" />
            </div>
            <p class="font-medium text-text-primary">No messages yet</p>
            <p class="text-xs text-text-disabled mt-1 max-w-xs">
              Say hello! Messages are delivered in real time with WhatsApp standard checkmarks.
            </p>
          </div>
        }

        <!-- Message Bubbles -->
        @for (msg of messages(); track msg.clientMessageId || msg.id) {
          <div
            class="flex flex-col"
            [ngClass]="isMine(msg) ? 'items-end' : 'items-start'"
          >
            <!-- Sender Display Name (Section 3.1) -->
            @if (!isMine(msg) && msg.senderDisplayName) {
              <span class="text-[11px] font-semibold text-text-muted mb-1 px-1">
                {{ msg.senderDisplayName }}
              </span>
            }

            <div
              class="max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-sm text-sm break-words relative transition"
              [ngClass]="
                isMine(msg)
                  ? 'bg-primary text-white rounded-br-xs'
                  : 'bg-white dark:bg-zinc-800 text-text-primary border border-border/30 rounded-bl-xs'
              "
            >
              <!-- Broadcast pill (Section 3.2) -->
              @if (msg.isBroadcast) {
                <div
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mb-1.5 self-start select-none"
                  [ngClass]="isMine(msg) ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'"
                >
                  <span aria-hidden="true">📢</span>
                  <span>Broadcast from {{ msg.senderDisplayName || 'Salon' }}</span>
                </div>
              }

              <!-- Media attachment preview if present -->
              @if (msg.mediaUrl) {
                <div class="mb-2 rounded-lg overflow-hidden border border-black/10">
                  <img [src]="msg.mediaUrl" alt="Attachment" class="max-h-60 w-auto object-cover" />
                </div>
              }

              <!-- Body text -->
              <p class="whitespace-pre-wrap leading-relaxed">{{ msg.body }}</p>

              <!-- Footer with time & checkmarks -->
              <div
                class="flex items-center justify-end gap-1 text-[11px] mt-1 shrink-0 select-none"
                [ngClass]="isMine(msg) ? 'text-white/80' : 'text-text-disabled'"
              >
                <span>{{ msg.createdAt | date: 'shortTime' }}</span>
                @if (isMine(msg)) {
                  <app-chat-status-icon [status]="msg.status" />
                }
              </div>
            </div>
          </div>
        }

        <!-- Typing Indicator Bubble -->
        @if (isPartnerTyping()) {
          <div class="flex items-start">
            <div class="bg-white dark:bg-zinc-800 border border-border/30 rounded-2xl rounded-bl-xs px-3.5 py-2 shadow-sm flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"></span>
              <span class="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]"></span>
              <span class="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        }
      </div>

      <!-- Input Bar -->
      <footer class="bg-white dark:bg-zinc-900 border-t border-border z-10 shrink-0">
        @if (isBroadcastConversation()) {
          <div class="px-4 py-3.5 bg-slate-50 dark:bg-zinc-850 flex items-center justify-center text-center">
            <div class="flex items-center gap-2 text-xs text-text-secondary">
              <span aria-hidden="true">📢</span>
              <span>Broadcast Channel (Read-only). Announcements are posted using the Broadcast modal.</span>
            </div>
          </div>
        } @else {
          <!-- Pending Media Preview -->
          @if (pendingMediaUrl()) {
            <div class="px-4 py-2 bg-slate-50 dark:bg-zinc-850 border-b border-border/60 flex items-center justify-between gap-3 animate-fade-in">
              <div class="flex items-center gap-3 min-w-0">
                <div class="relative w-12 h-12 rounded-lg overflow-hidden border border-border shrink-0">
                  <img [src]="pendingMediaUrl()!" alt="Pending attachment" class="w-full h-full object-cover" />
                </div>
                <span class="text-xs text-text-secondary truncate">Image attached</span>
              </div>
              <button
                type="button"
                (click)="removePendingMedia()"
                class="p-1 rounded-full text-text-disabled hover:text-text-primary hover:bg-slate-200 dark:hover:bg-zinc-750 transition"
                title="Remove attachment"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          }

          <form (ngSubmit)="send()" class="p-3 flex items-center gap-2">
            <!-- Attachment Button -->
            <input
              #chatFileInput
              type="file"
              accept="image/*"
              class="hidden"
              (change)="onFileSelected($event)"
            />
            <button
              type="button"
              (click)="chatFileInput.click()"
              [disabled]="isBlocked() || uploadingMedia()"
              class="p-2 rounded-full text-text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-zinc-800 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              title="Attach image"
              aria-label="Attach image"
            >
              @if (uploadingMedia()) {
                <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              } @else {
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              }
            </button>

            <input
              type="text"
              [(ngModel)]="draft"
              (ngModelChange)="onDraftChange()"
              name="draft"
              [disabled]="isBlocked()"
              [placeholder]="isBlocked() ? 'This conversation has been blocked' : 'Type a message...'"
              autocomplete="off"
              class="flex-1 bg-slate-100 dark:bg-zinc-800 text-text-primary placeholder:text-text-disabled rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-transparent focus:border-primary/30 disabled:opacity-60 disabled:cursor-not-allowed"
            />

            <button
              type="submit"
              [disabled]="(!draft().trim() && !pendingMediaUrl()) || isBlocked() || uploadingMedia()"
              class="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover active:scale-95 transition shadow-sm"
              aria-label="Send message"
            >
              <svg class="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
        }
      </footer>
    </div>
  `,
})
export class ChatThreadComponent implements OnInit, OnDestroy {
  @ViewChild('scrollContainer') private _scrollContainer?: ElementRef<HTMLDivElement>;

  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _location = inject(Location);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _chatService = inject(ChatService);
  private readonly _socket = inject(ChatSocketService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _toast = inject(ToastService);

  readonly conversationIdInput = input<string | null>(null, { alias: 'conversationId' });
  readonly backFallbackRoute = input<string[] | null>(null);

  protected readonly conversationId = signal<string>('');
  protected readonly conversation = signal<ConversationItemDto | null>(null);
  protected readonly messages = signal<ConversationMessageDto[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly loadingOlder = signal<boolean>(false);
  protected readonly hasMore = signal<boolean>(false);
  protected readonly draft = signal<string>('');
  protected readonly pendingMediaUrl = signal<string | null>(null);
  protected readonly uploadingMedia = signal<boolean>(false);
  protected readonly isPartnerTyping = signal<boolean>(false);
  protected readonly partnerTypingName = signal<string>('');
  protected readonly blockingAction = signal<boolean>(false);

  private _typingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  private _partnerTypingClearTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _subs = new Subscription();

  protected readonly isBlocked = computed(() => {
    return this.conversation()?.status === 'BLOCKED';
  });

  protected readonly isBroadcastConversation = computed(() => {
    return this.conversation()?.type === 'BROADCAST';
  });

  protected readonly displayName = computed(() => {
    const c = this.conversation();
    if (!c) return 'Conversation';
    if (c.type === 'BROADCAST') {
      return 'Broadcast Announcements';
    }
    const me = this._currentUser.user();
    if (c.customerId && c.customerId === me?.id) {
      return c.staffName || c.salonName || 'HairMela';
    }
    return c.customerName || c.staffName || c.salonName || 'Customer';
  });

  protected readonly subTitle = computed(() => {
    const c = this.conversation();
    if (!c) return '';
    if (c.type === 'BROADCAST') {
      return 'Salon Announcement Channel';
    }
    const me = this._currentUser.user();
    if (c.customerId && c.customerId === me?.id) {
      return c.staffName ? `${c.salonName}` : 'General Inquiries';
    }
    return c.customerPhone || (c.staffName ? `with ${c.staffName}` : c.salonName);
  });

  protected readonly avatarUrl = computed(() => {
    const c = this.conversation();
    if (!c) return null;
    if (c.type === 'BROADCAST') return null;
    const me = this._currentUser.user();
    if (c.customerId && c.customerId === me?.id) {
      return c.staffAvatarUrl || c.salonLogoUrl || null;
    }
    return c.customerAvatarUrl || c.staffAvatarUrl || null;
  });

  ngOnInit(): void {
    const id = this.conversationIdInput() || this._route.snapshot.paramMap.get(RouteParam.CONVERSATION_ID) || '';
    this.conversationId.set(id);

    if (id) {
      this._loadThread(id);
      this._socket.joinConversation(id, (ack) => {
        if (ack?.status === 'forbidden') {
          this._toast.error('You do not have access to this conversation.');
          this.goBack();
        }
      });
      this._setupSubscriptions(id);
    }
  }

  private _loadThread(conversationId: string): void {
    this.loading.set(true);

    const salonId = this._route.snapshot.paramMap.get(RouteParam.SALON_ID);
    if (salonId) {
      this._chatService.getSalonConversations(salonId, 1, 100).subscribe({
        next: (res) => {
          const found = res.data.find((c) => c.id === conversationId);
          if (found) {
            this.conversation.set(found);
          }
        },
      });
    }

    // Fetch conversation details from customer inbox
    this._chatService.getCustomerConversations(1, 100).subscribe({
      next: (res) => {
        const found = res.data.find((c) => c.id === conversationId);
        if (found) {
          this.conversation.set(found);
        }
      },
    });

    // Fetch messages
    this._chatService.getMessageHistory(conversationId).subscribe({
      next: (res) => {
        this.messages.set(res.data);
        this.hasMore.set(res.hasMore);
        this.loading.set(false);
        this._chatService.markAsRead(conversationId).subscribe();
        this._scrollToBottom();
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  private _setupSubscriptions(conversationId: string): void {
    // New message arrived via socket
    this._subs.add(
      this._socket.messageReceived$.subscribe((msg) => {
        if (msg.conversationId === conversationId) {
          const current = this.messages();
          const existingIdx = current.findIndex(
            (m) => m.id === msg.id || (m.clientMessageId && m.clientMessageId === msg.clientMessageId),
          );
          if (existingIdx >= 0) {
            const updated = [...current];
            updated[existingIdx] = msg;
            this.messages.set(updated);
          } else {
            this.messages.set([...current, msg]);
          }
          this._chatService.markAsRead(conversationId).subscribe();
          this._scrollToBottom();
        }
      }),
    );

    // Status updated via socket (receipt checkmarks)
    this._subs.add(
      this._socket.statusUpdated$.subscribe((payload) => {
        if (payload.conversationId === conversationId) {
          const current = this.messages();
          let changed = false;

          if (payload.upToMessageId) {
            const upToIdx = current.findIndex(
              (m) => m.id === payload.upToMessageId || m.clientMessageId === payload.upToMessageId,
            );
            if (upToIdx >= 0) {
              for (let i = 0; i <= upToIdx; i++) {
                if (current[i].status !== 'READ') {
                  current[i].status = payload.status;
                  if (payload.readAt) current[i].readAt = payload.readAt;
                  if (payload.deliveredAt) current[i].deliveredAt = payload.deliveredAt;
                  changed = true;
                }
              }
            }
          }

          if (payload.messageId || payload.clientMessageId) {
            const target = current.find(
              (m) =>
                (payload.messageId && m.id === payload.messageId) ||
                (payload.clientMessageId && m.clientMessageId === payload.clientMessageId),
            );
            if (target) {
              target.status = payload.status;
              if (payload.readAt) target.readAt = payload.readAt;
              if (payload.deliveredAt) target.deliveredAt = payload.deliveredAt;
              changed = true;
            }
          }

          if (changed) {
            this.messages.set([...current]);
          }
        }
      }),
    );

    // Typing indicator with 4-second auto-clear
    this._subs.add(
      this._socket.typingIndicator$.subscribe((payload) => {
        if (payload.conversationId === conversationId) {
          const myId = this._currentUser.user()?.id;
          if (payload.userId !== myId) {
            if (payload.isTyping) {
              this.isPartnerTyping.set(true);
              this.partnerTypingName.set(payload.userName || '');
              this._scrollToBottom();

              if (this._partnerTypingClearTimer) clearTimeout(this._partnerTypingClearTimer);
              this._partnerTypingClearTimer = setTimeout(() => {
                this.isPartnerTyping.set(false);
              }, 4000);
            } else {
              if (this._partnerTypingClearTimer) clearTimeout(this._partnerTypingClearTimer);
              this.isPartnerTyping.set(false);
            }
          }
        }
      }),
    );
  }

  protected onDraftChange(): void {
    const id = this.conversationId();
    if (!id || this.isBlocked()) return;

    const text = this.draft().trim();
    if (!text) {
      if (this._typingDebounceTimer) clearTimeout(this._typingDebounceTimer);
      if (this._typingStopTimer) clearTimeout(this._typingStopTimer);
      this._socket.stopTyping(id);
      return;
    }

    if (this._typingDebounceTimer) clearTimeout(this._typingDebounceTimer);
    this._typingDebounceTimer = setTimeout(() => {
      this._socket.startTyping(id);
    }, 300);

    if (this._typingStopTimer) clearTimeout(this._typingStopTimer);
    this._typingStopTimer = setTimeout(() => {
      this._socket.stopTyping(id);
    }, 2500);
  }

  protected block(): void {
    const id = this.conversationId();
    if (!id || this.blockingAction()) return;

    this.blockingAction.set(true);
    this._chatService.blockConversation(id).subscribe({
      next: (updated) => {
        this.blockingAction.set(false);
        this.conversation.set(updated);
        this._toast.success('Conversation blocked.');
      },
      error: () => {
        this.blockingAction.set(false);
        this._toast.error('Could not block conversation.');
      },
    });
  }

  protected unblock(): void {
    const id = this.conversationId();
    if (!id || this.blockingAction()) return;

    this.blockingAction.set(true);
    this._chatService.unblockConversation(id).subscribe({
      next: (updated) => {
        this.blockingAction.set(false);
        this.conversation.set(updated);
        this._toast.success('Conversation unblocked.');
      },
      error: () => {
        this.blockingAction.set(false);
        this._toast.error('Could not unblock conversation.');
      },
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadingMedia.set(true);
    uploadAdHocImage(this._http, this._apiConfig, file, 'COMMENT').subscribe({
      next: (res) => {
        this.pendingMediaUrl.set(res.url);
        this.uploadingMedia.set(false);
      },
      error: (err) => {
        this.uploadingMedia.set(false);
        this._toast.error(err?.message || 'Failed to upload image.');
      },
    });
    input.value = '';
  }

  protected removePendingMedia(): void {
    this.pendingMediaUrl.set(null);
  }

  protected send(): void {
    const text = this.draft().trim();
    const mediaUrl = this.pendingMediaUrl();
    const id = this.conversationId();
    if ((!text && !mediaUrl) || !id || this.isBlocked() || this.uploadingMedia()) return;

    const bodyText = text || 'Photo';
    const clientMessageId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'cli_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();

    const user = this._currentUser.user();

    let senderRole: MessageSenderRole = 'CUSTOMER';
    const c = this.conversation();
    if (c && user?.id && c.staffId && c.customerId !== user.id) {
      senderRole = 'STAFF';
    }

    // Optimistic message bubble
    const optimisticMsg: ConversationMessageDto = {
      id: 'opt_' + clientMessageId,
      clientMessageId,
      conversationId: id,
      senderUserId: user?.id || 'u_me',
      senderRole: senderRole as 'CUSTOMER' | 'STAFF',
      senderDisplayName: user ? `${user.firstName} ${user.lastName}`.trim() : 'Me',
      body: bodyText,
      mediaUrl: mediaUrl || null,
      status: 'PENDING',
      isBroadcast: false,
      createdAt: new Date().toISOString(),
    };

    this.messages.set([...this.messages(), optimisticMsg]);
    this.draft.set('');
    this.pendingMediaUrl.set(null);
    this._socket.stopTyping(id);
    this._scrollToBottom();

    this._chatService
      .sendMessage(id, {
        clientMessageId,
        body: bodyText,
        mediaUrl: mediaUrl || undefined,
      })
      .subscribe({
        next: (saved) => {
          const list = this.messages();
          const idx = list.findIndex((m) => m.clientMessageId === clientMessageId);
          if (idx >= 0) {
            const updated = [...list];
            updated[idx] = saved;
            this.messages.set(updated);
          }
        },
        error: (err) => {
          if (err?.status === 403) {
            this._toast.error(err?.error?.message || 'This conversation has been blocked.');
            this.conversation.update((curr) => (curr ? { ...curr, status: 'BLOCKED' } : null));
            // Remove optimistic message
            this.messages.update((list) => list.filter((m) => m.clientMessageId !== clientMessageId));
          } else {
            this._toast.error('Failed to send message.');
          }
        },
      });
  }

  protected onScroll(): void {
    const el = this._scrollContainer?.nativeElement;
    if (!el) return;

    if (el.scrollTop === 0 && this.hasMore() && !this.loadingOlder()) {
      this._loadOlderMessages();
    }
  }

  private _loadOlderMessages(): void {
    const id = this.conversationId();
    const oldest = this.messages()[0];
    if (!id || !oldest) return;

    this.loadingOlder.set(true);
    const el = this._scrollContainer?.nativeElement;
    const oldScrollHeight = el ? el.scrollHeight : 0;

    this._chatService.getMessageHistory(id, oldest.id).subscribe({
      next: (res) => {
        this.messages.set([...res.data, ...this.messages()]);
        this.hasMore.set(res.hasMore);
        this.loadingOlder.set(false);

        setTimeout(() => {
          if (el) {
            el.scrollTop = el.scrollHeight - oldScrollHeight;
          }
        });
      },
      error: () => {
        this.loadingOlder.set(false);
      },
    });
  }

  protected isMine(msg: ConversationMessageDto): boolean {
    const myId = this._currentUser.user()?.id;
    if (myId && msg.senderUserId === myId) return true;
    if (!myId && msg.senderRole === 'CUSTOMER') return true;
    return false;
  }

  protected goBack(): void {
    const fallback = this.backFallbackRoute();
    if (fallback) {
      this._router.navigate(fallback);
      return;
    }
    if (window.history.length > 1) {
      this._location.back();
    } else {
      this._router.navigate(['/chat']);
    }
  }

  private _scrollToBottom(): void {
    setTimeout(() => {
      const el = this._scrollContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 50);
  }

  ngOnDestroy(): void {
    const id = this.conversationId();
    if (id) {
      this._socket.leaveConversation(id);
    }
    if (this._typingDebounceTimer) clearTimeout(this._typingDebounceTimer);
    if (this._typingStopTimer) clearTimeout(this._typingStopTimer);
    if (this._partnerTypingClearTimer) clearTimeout(this._partnerTypingClearTimer);
    this._subs.unsubscribe();
  }
}
