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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { ChatService } from '../../../core/chat/chat.service';
import { ChatSocketService } from '../../../core/chat/chat-socket.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import {
  ConversationItemDto,
  ConversationMessageDto,
  MessageSenderRole,
} from '../../../core/chat/chat.types';
import { ChatStatusIconComponent } from '../chat-status-icon/chat-status-icon.component';
import { ChatAudioBubbleComponent } from '../chat-audio-bubble/chat-audio-bubble.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ToastService } from '../../../core/toast/toast.service';
import { uploadAdHocImage } from '../../../core/media/media-upload';
import { publicMediaControllerPresignUpload } from '../../../api/fn/media/public-media-controller-presign-upload';
import { BroadcastModalComponent } from '../../salons/salon-chat/broadcast-modal.component';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

@Component({
  selector: 'app-chat-thread',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ChatStatusIconComponent,
    ChatAudioBubbleComponent,
    IconComponent,
    BroadcastModalComponent,
    MediaUrlPipe,
  ],
  host: {
    class: 'block w-full',
  },
  template: `
    <div class="flex flex-col h-[calc(100vh-5.5rem-var(--bottom-nav-height))] supports-[height:100dvh]:h-[calc(100dvh-5.5rem-var(--bottom-nav-height))] md:h-[calc(100vh-4rem)] md:supports-[height:100dvh]:h-[calc(100dvh-4rem)] max-w-3xl mx-auto bg-surface-card border border-border shadow-xs relative overflow-hidden rounded-2xl md:rounded-xl">
      <!-- Chat Header -->
      <header class="flex items-center justify-between gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3 bg-surface-card border-b border-border z-10 shrink-0">
        <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            (click)="goBack()"
            class="p-2 -ml-2 rounded-full hover:bg-surface-overlay text-text-primary transition"
            aria-label="Back"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <!-- Avatar -->
          @if (viewTarget(); as target) {
            <a
              [routerLink]="target.link"
              [queryParams]="target.queryParams"
              [title]="target.label"
              class="relative w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden hover:opacity-90 transition active:scale-95"
            >
              @if (avatarUrl()) {
                <img [src]="avatarUrl()! | mediaUrl:'thumb'" alt="Avatar" class="w-full h-full object-cover" />
              } @else {
                <span>{{ displayName().slice(0, 1).toUpperCase() }}</span>
              }
            </a>
          } @else {
            <div class="relative w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0 overflow-hidden">
              @if (avatarUrl()) {
                <img [src]="avatarUrl()! | mediaUrl:'thumb'" alt="Avatar" class="w-full h-full object-cover" />
              } @else {
                <span>{{ displayName().slice(0, 1).toUpperCase() }}</span>
              }
            </div>
          }

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

        <!-- Header Actions: View Staff / Salon, Block / Unblock OR Broadcast Button -->
        @if (!isBroadcastConversation()) {
          <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
            @if (viewTarget(); as target) {
              <a
                [routerLink]="target.link"
                [queryParams]="target.queryParams"
                class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold border border-primary/20 text-primary bg-primary/5 hover:bg-primary/10 active:scale-95 transition shadow-2xs"
              >
                <app-icon [name]="target.icon" class="w-3.5 h-3.5" />
                <span class="whitespace-nowrap">{{ target.label }}</span>
              </a>
            }

            @if (isBlocked()) {
              <button
                type="button"
                (click)="unblock()"
                [disabled]="blockingAction()"
                class="px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-2xs"
              >
                Unblock
              </button>
            } @else {
              <button
                type="button"
                (click)="block()"
                [disabled]="blockingAction()"
                class="px-2 sm:px-2.5 py-1.5 rounded-full text-xs font-medium text-text-secondary hover:text-error hover:bg-error-light/50 transition"
                title="Block conversation"
              >
                Block
              </button>
            }
          </div>
        } @else {
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              (click)="showBroadcastModal.set(true)"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-2xs shrink-0"
              title="Send Broadcast"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              <span>Broadcast</span>
            </button>
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
        class="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-surface relative"
      >
        <!-- Loading Older Spinner -->
        @if (loadingOlder()) {
          <div class="flex justify-center py-2">
            <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        }

        <!-- Empty State -->
        @if (!loading() && messages().length === 0) {
          @if (isBroadcastConversation()) {
            <div class="flex flex-col items-center justify-center h-full text-center py-12 px-4 text-text-secondary">
              <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3 text-2xl">
                📢
              </div>
              <p class="font-medium text-text-primary text-base">No broadcast announcements yet</p>
              <p class="text-xs text-text-disabled mt-1 max-w-xs">
                Announcements sent will reach all customers who have favourited your salon.
              </p>
              <button
                type="button"
                (click)="showBroadcastModal.set(true)"
                class="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-xs"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
                <span>Send First Broadcast</span>
              </button>
            </div>
          } @else {
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
        }

        <!-- Message Bubbles -->
        @for (msg of messages(); track msg.clientMessageId || msg.id) {
          <div
            class="flex flex-col"
            [ngClass]="isMine(msg) ? 'items-end' : 'items-start'"
          >
            <!-- Sender Display Name (Section 3.1) -->
            @if (!isMine(msg) && msg.senderDisplayName) {
              <div class="flex items-center gap-1.5 mb-1 px-1">
                @if (msg.senderAvatarUrl) {
                  <img [src]="msg.senderAvatarUrl | mediaUrl:'thumb'" alt="" class="w-4 h-4 rounded-full object-cover shrink-0" />
                }
                <span class="text-[11px] font-semibold text-text-muted">
                  {{ msg.senderDisplayName }}
                </span>
              </div>
            }

            <div
              class="max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-sm text-sm break-words relative transition"
              [ngClass]="
                isMine(msg)
                  ? 'bg-primary text-white rounded-br-xs'
                  : 'bg-surface-card text-text-primary border border-border shadow-2xs rounded-bl-xs'
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

              <!-- Media attachment / Voice Note preview if present -->
              @if (msg.mediaUrl) {
                @if (isAudio(msg)) {
                  <app-chat-audio-bubble
                    [audioUrl]="msg.mediaUrl"
                    [duration]="msg.mediaDurationSeconds || 0"
                    [isMine]="isMine(msg)"
                    [avatarUrl]="msg.senderAvatarUrl || null"
                    [senderName]="msg.senderDisplayName"
                  />
                } @else {
                  <div class="mb-2 rounded-lg overflow-hidden border border-black/10">
                    <img [src]="msg.mediaUrl" alt="Attachment" class="max-h-60 w-auto object-cover" />
                  </div>
                }
              }

              <!-- Body text (only if non-empty) -->
              @if (msg.body) {
                <p class="whitespace-pre-wrap leading-relaxed">{{ msg.body }}</p>
              }

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
            <div class="bg-surface-card border border-border rounded-2xl rounded-bl-xs px-3.5 py-2 shadow-2xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-text-disabled animate-bounce"></span>
              <span class="w-2 h-2 rounded-full bg-text-disabled animate-bounce [animation-delay:0.2s]"></span>
              <span class="w-2 h-2 rounded-full bg-text-disabled animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        }
      </div>

      <!-- Input Bar -->
      <footer class="bg-surface-card border-t border-border z-10 shrink-0">
        @if (isBroadcastConversation()) {
          <div class="px-4 py-3 bg-surface-sunken border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-xs text-text-secondary min-w-0">
              <span class="text-base shrink-0" aria-hidden="true">📢</span>
              <span class="truncate">Announcements are broadcast to all customers who favourited your salon.</span>
            </div>
            <button
              type="button"
              (click)="showBroadcastModal.set(true)"
              class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-primary text-white hover:bg-primary-hover active:scale-95 transition shadow-xs shrink-0 w-full sm:w-auto"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              <span>Broadcast to Customers</span>
            </button>
          </div>
        } @else {
          <!-- Pending Media Preview -->
          @if (pendingMediaUrl()) {
            <div class="px-4 py-2 bg-surface-sunken border-b border-border flex items-center justify-between gap-3 animate-fade-in">
              <div class="flex items-center gap-3 min-w-0">
                <div class="relative w-12 h-12 rounded-lg overflow-hidden border border-border shrink-0">
                  <img [src]="pendingMediaUrl()!" alt="Pending attachment" class="w-full h-full object-cover" />
                </div>
                <span class="text-xs text-text-secondary truncate">Image attached</span>
              </div>
              <button
                type="button"
                (click)="removePendingMedia()"
                class="p-1 rounded-full text-text-disabled hover:text-text-primary hover:bg-surface-overlay transition"
                title="Remove attachment"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          }

          @if (isRecording()) {
            <div class="p-3 flex items-center justify-between gap-3 bg-surface-sunken animate-fade-in">
              <!-- Blinking red recording indicator + Timer -->
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="relative flex h-3 w-3 shrink-0">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <span class="text-sm font-semibold text-text-primary tabular-nums shrink-0">
                  {{ formattedRecordingDuration() }}
                </span>
                <span class="text-xs text-text-muted truncate hidden sm:inline">Recording voice note...</span>
              </div>

              <!-- Cancel and Stop & Send Buttons -->
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  (click)="cancelRecording()"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-red-500 hover:bg-red-500/10 active:scale-95 transition"
                  aria-label="Cancel recording"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Cancel</span>
                </button>

                <button
                  type="button"
                  (click)="stopAndSendRecording()"
                  class="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-hover active:scale-95 transition shadow-sm"
                  aria-label="Send voice note"
                  title="Send voice note"
                >
                  <svg class="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          } @else {
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
                class="p-2 rounded-full text-text-secondary hover:text-primary hover:bg-surface-overlay transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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
                [disabled]="isBlocked() || uploadingMedia()"
                [placeholder]="isBlocked() ? 'This conversation has been blocked' : 'Type a message...'"
                autocomplete="off"
                class="flex-1 bg-surface-sunken text-text-primary placeholder:text-text-disabled rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-border focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
              />

              @if (draft().trim() || pendingMediaUrl()) {
                <button
                  type="submit"
                  [disabled]="isBlocked() || uploadingMedia()"
                  class="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover active:scale-95 transition shadow-sm"
                  aria-label="Send message"
                >
                  <svg class="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              } @else {
                <button
                  type="button"
                  (click)="startRecording()"
                  [disabled]="isBlocked() || uploadingMedia()"
                  class="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover active:scale-95 transition shadow-sm"
                  aria-label="Record voice note"
                  title="Record voice note"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
              }
            </form>
          }
        }
      </footer>

      <!-- Broadcast Modal Dialog -->
      @if (showBroadcastModal() && salonId()) {
        <app-broadcast-modal
          [salonId]="salonId()"
          (closed)="showBroadcastModal.set(false)"
          (sent)="onBroadcastSent()"
        />
      }
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
  private readonly _salonContext = inject(SalonContextService);
  private readonly _salonsStore = inject(SalonsStore);

  readonly conversationIdInput = input<string | null>(null, { alias: 'conversationId' });
  readonly backFallbackRoute = input<string[] | null>(null);

  protected readonly showBroadcastModal = signal<boolean>(false);
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
  protected readonly isRecording = signal<boolean>(false);
  protected readonly recordingSeconds = signal<number>(0);

  private _mediaRecorder: MediaRecorder | null = null;
  private _mediaStream: MediaStream | null = null;
  private _recordingTimer: ReturnType<typeof setInterval> | null = null;
  private _audioChunks: Blob[] = [];
  private _recordingStartTime = 0;
  private _recordingMimeType = 'audio/webm';
  private _recordingFileExt = 'webm';

  private _typingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  private _partnerTypingClearTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _subs = new Subscription();

  protected readonly formattedRecordingDuration = computed(() => {
    const sec = this.recordingSeconds();
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  });

  protected isAudio(msg: ConversationMessageDto): boolean {
    if (
      msg.mediaDurationSeconds !== undefined &&
      msg.mediaDurationSeconds !== null &&
      msg.mediaDurationSeconds > 0
    ) {
      return true;
    }
    if (!msg.mediaUrl) return false;
    const url = msg.mediaUrl.toLowerCase();
    return (
      url.endsWith('.webm') ||
      url.endsWith('.m4a') ||
      url.endsWith('.mp3') ||
      url.endsWith('.ogg') ||
      url.endsWith('.wav') ||
      url.endsWith('.aac') ||
      url.endsWith('.mp4')
    );
  }

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

  protected readonly viewTarget = computed<{
    label: string;
    link: string[];
    queryParams?: Record<string, string>;
    icon: string;
  } | null>(() => {
    const c = this.conversation();
    if (!c || c.type === 'BROADCAST' || !c.salonSlug) return null;
    const me = this._currentUser.user();
    const isCustomer = !!me && c.customerId === me.id;
    if (!isCustomer) return null;

    if (c.staffId) {
      if (c.staffQueueId) {
        return {
          label: 'View Staff',
          link: RoutePath.visitQueue('', c.salonSlug, c.staffQueueId),
          icon: 'queue',
        };
      }
      return {
        label: 'View Staff',
        link: RoutePath.visitSalon('', c.salonSlug),
        queryParams: { tab: 'staffs' },
        icon: 'person',
      };
    }

    return {
      label: 'View Salon',
      link: RoutePath.visitSalon('', c.salonSlug),
      icon: 'scissors',
    };
  });

  protected readonly avatarUrl = computed(() => {
    const c = this.conversation();
    if (!c) return null;
    if (c.type === 'BROADCAST') return null;
    const me = this._currentUser.user();
    if (c.customerId && c.customerId === me?.id) {
      return c.staffAvatarUrl || c.salonLogoUrl || null;
    }
    return c.customerAvatarUrl || c.staffAvatarUrl || c.salonLogoUrl || null;
  });

  protected readonly salonId = computed(() => {
    return (
      this.conversation()?.salonId ||
      this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ||
      this._route.parent?.snapshot.paramMap.get(RouteParam.SALON_ID) ||
      this._salonContext.activeSalonId() ||
      this._salonContext.displaySalonId() ||
      this._salonsStore.salons().find((s) => s.role === 'OWNER' || s.role === 'ADMIN')?.salon.id ||
      ''
    );
  });

  protected onBroadcastSent(): void {
    const id = this.conversationId();
    if (id) {
      this._loadThread(id);
    }
  }

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

    // 1. The inbox passes the conversation along via router state (survives refresh too).
    const stateConv =
      typeof window !== 'undefined'
        ? (window.history.state?.conversation as ConversationItemDto | undefined)
        : undefined;
    if (stateConv?.id === conversationId) {
      this.conversation.set(stateConv);
    } else {
      // 2. Deep link: look in my customer inbox...
      this._chatService.getCustomerConversations(1, 100).subscribe({
        next: (res) => {
          const found = res.data.find((c) => c.id === conversationId);
          if (found) {
            this.conversation.set(found);
          }
        },
        error: () => {},
      });

      // 3. ...and in every salon I work at (staff / owner / admin views).
      const salonIds = new Set<string>();
      const routeSalonId = this._route.snapshot.paramMap.get(RouteParam.SALON_ID);
      if (routeSalonId) salonIds.add(routeSalonId);
      for (const s of this._salonsStore.salons()) salonIds.add(s.salon.id);
      for (const salonId of salonIds) {
        this._chatService.getSalonConversations(salonId, 1, 100).subscribe({
          next: (res) => {
            const found = res.data.find((c) => c.id === conversationId);
            if (found) {
              this.conversation.set(found);
            }
          },
          error: () => {},
        });
      }
    }

    // Fetch messages
    this._chatService.getMessageHistory(conversationId).subscribe({
      next: (res) => {
        this.messages.set([...res.data].reverse());
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

  // ── Voice Notes (Audio Messages) ──────────────────────────────────────────

  protected async startRecording(): Promise<void> {
    if (this.isBlocked() || this.uploadingMedia()) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this._toast.error('Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._mediaStream = stream;

      const { mimeType, ext } = this._getSupportedAudioMimeType();
      this._recordingMimeType = mimeType;
      this._recordingFileExt = ext;
      this._audioChunks = [];

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this._mediaRecorder = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this._audioChunks.push(event.data);
        }
      };

      this._recordingStartTime = Date.now();
      this.recordingSeconds.set(0);
      this.isRecording.set(true);

      // Live timer tick every second
      this._recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this._recordingStartTime) / 1000);
        this.recordingSeconds.set(elapsed);
        if (elapsed >= 600) {
          // Max 10 minutes reached
          this.stopAndSendRecording();
        }
      }, 1000);

      recorder.start(250);
    } catch (err: any) {
      this._cleanupRecordingStream();
      this.isRecording.set(false);
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        this._toast.error('Microphone permission denied. Please allow microphone access to record voice notes.');
      } else {
        this._toast.error('Could not access microphone.');
      }
    }
  }

  protected cancelRecording(): void {
    if (this._recordingTimer) {
      clearInterval(this._recordingTimer);
      this._recordingTimer = null;
    }
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.onstop = null;
      this._mediaRecorder.stop();
    }
    this._cleanupRecordingStream();
    this._audioChunks = [];
    this.isRecording.set(false);
    this.recordingSeconds.set(0);
  }

  protected stopAndSendRecording(): void {
    if (!this.isRecording() || !this._mediaRecorder) return;

    if (this._recordingTimer) {
      clearInterval(this._recordingTimer);
      this._recordingTimer = null;
    }

    const elapsedSeconds = Math.max(1, Math.min(600, Math.floor((Date.now() - this._recordingStartTime) / 1000)));

    const recorder = this._mediaRecorder;
    const mimeType = this._recordingMimeType || 'audio/webm';
    const ext = this._recordingFileExt || 'webm';

    recorder.onstop = async () => {
      this._cleanupRecordingStream();
      this.isRecording.set(false);
      this.recordingSeconds.set(0);

      const audioBlob = new Blob(this._audioChunks, { type: mimeType });
      this._audioChunks = [];

      if (audioBlob.size === 0) {
        this._toast.error('No audio recorded.');
        return;
      }

      await this._uploadAndSendVoiceNote(audioBlob, mimeType, ext, elapsedSeconds);
    };

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  private async _uploadAndSendVoiceNote(
    blob: Blob,
    mimeType: string,
    ext: string,
    durationSeconds: number,
  ): Promise<void> {
    const id = this.conversationId();
    if (!id || this.isBlocked()) return;

    this.uploadingMedia.set(true);

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

    // Local object URL for instant, zero-latency playback preview
    const localBlobUrl = URL.createObjectURL(blob);

    // Optimistic voice message bubble
    const optimisticMsg: ConversationMessageDto = {
      id: 'opt_' + clientMessageId,
      clientMessageId,
      conversationId: id,
      senderUserId: user?.id || 'u_me',
      senderRole: senderRole as 'CUSTOMER' | 'STAFF',
      senderDisplayName: user ? `${user.firstName} ${user.lastName}`.trim() : 'Me',
      senderAvatarUrl: null,
      body: '',
      mediaUrl: localBlobUrl,
      mediaDurationSeconds: durationSeconds,
      status: 'PENDING',
      isBroadcast: false,
      createdAt: new Date().toISOString(),
    };

    this.messages.set([...this.messages(), optimisticMsg]);
    this._scrollToBottom();

    try {
      // 1. Request presigned upload URL from R2
      const presignRes = await firstValueFrom(
        publicMediaControllerPresignUpload(this._http, this._apiConfig.rootUrl, {
          body: {
            filename: `voice-note-${Date.now()}.${ext}`,
            contentType: mimeType as any,
            fileSize: blob.size,
            entityType: 'CHAT',
            type: 'GALLERY',
          },
        }),
      );

      const { uploadUrl, url: publicUrl } = presignRes.body;

      // 2. Direct binary PUT upload to Cloudflare R2
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
        },
        body: blob,
      });

      if (!putRes.ok) {
        throw new Error(`R2 upload failed with status ${putRes.status}`);
      }

      // 3. Commit voice note message to thread
      this._chatService
        .sendMessage(id, {
          clientMessageId,
          body: '',
          mediaUrl: publicUrl,
          mediaDurationSeconds: durationSeconds,
        })
        .subscribe({
          next: (saved) => {
            this.uploadingMedia.set(false);
            const list = this.messages();
            const idx = list.findIndex((m) => m.clientMessageId === clientMessageId);
            if (idx >= 0) {
              const updated = [...list];
              updated[idx] = saved;
              this.messages.set(updated);
            }
          },
          error: (err) => {
            this.uploadingMedia.set(false);
            if (err?.status === 403) {
              this._toast.error(err?.error?.message || 'This conversation has been blocked.');
              this.conversation.update((curr) => (curr ? { ...curr, status: 'BLOCKED' } : null));
              this.messages.update((list) => list.filter((m) => m.clientMessageId !== clientMessageId));
            } else {
              this._toast.error('Failed to deliver voice note.');
            }
          },
        });
    } catch (err: any) {
      this.uploadingMedia.set(false);
      this.messages.update((list) => list.filter((m) => m.clientMessageId !== clientMessageId));
      this._toast.error(err?.message || 'Failed to upload voice note.');
    }
  }

  private _getSupportedAudioMimeType(): { mimeType: string; ext: string } {
    if (typeof MediaRecorder === 'undefined') {
      return { mimeType: 'audio/webm', ext: 'webm' };
    }
    const candidates = [
      { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
      { mimeType: 'audio/webm', ext: 'webm' },
      { mimeType: 'audio/mp4', ext: 'm4a' },
      { mimeType: 'audio/aac', ext: 'aac' },
      { mimeType: 'audio/ogg', ext: 'ogg' },
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mimeType)) {
        return c;
      }
    }
    return { mimeType: 'audio/webm', ext: 'webm' };
  }

  private _cleanupRecordingStream(): void {
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((track) => track.stop());
      this._mediaStream = null;
    }
    this._mediaRecorder = null;
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
        const older = [...res.data].reverse();
        this.messages.set([...older, ...this.messages()]);
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
    this.cancelRecording();
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
