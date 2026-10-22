import { Component, EventEmitter, OnInit, Output, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { ChatService } from '../../../core/chat/chat.service';
import { ToastService } from '../../../core/toast/toast.service';
import { uploadMedia } from '../../../core/media/media-upload';
import { RoutePath } from '../../../core/routing/route-paths';
import { BroadcastChannel, CHANNEL_OPTIONS } from '../broadcasts/broadcast-automation.types';
import { BroadcastAutomationsService } from '../broadcasts/broadcast-automations.service';

@Component({
  selector: 'app-broadcast-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
      (click)="close()"
    >
      <div
        class="bg-surface-card rounded-2xl max-w-md w-full p-6 shadow-xl border border-border"
        (click)="$event.stopPropagation()"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between pb-3 border-b border-border">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <h3 class="font-semibold text-text-primary text-base">Salon Broadcast</h3>
          </div>
          <button
            type="button"
            (click)="close()"
            class="p-1 rounded-lg text-text-disabled hover:text-text-primary transition"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Description -->
        <p class="text-xs text-text-secondary mt-3">
          Send an announcement or promotion directly into 1-on-1 chats of customers who favourited your salon or have been served by it.
        </p>

        <!-- Message Body -->
        <div class="mt-4">
          <label class="block text-xs font-medium text-text-primary mb-1.5">
            Broadcast Message
          </label>
          <textarea
            [(ngModel)]="body"
            rows="4"
            maxlength="500"
            placeholder="e.g. Special Tuesday offer: 20% off all haircuts today between 12pm and 4pm! Walk-ins welcome."
            class="w-full bg-surface-sunken text-text-primary placeholder:text-text-disabled rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition border border-border focus:border-primary resize-none"
          ></textarea>
          <div class="flex justify-between items-center text-[11px] text-text-disabled mt-1 px-1">
            <span>Powered by WhatsApp Standard Broadcast</span>
            <span>{{ body().length }}/500</span>
          </div>
        </div>

        <!-- Optional Image Attachment -->
        <div class="mt-3">
          <input
            #fileInput
            type="file"
            accept="image/*"
            class="hidden"
            (change)="onFileSelected($event)"
          />

          @if (mediaUrl()) {
            <div class="relative inline-block rounded-xl overflow-hidden border border-border group mt-1">
              <img [src]="mediaUrl()!" alt="Broadcast preview" class="h-28 w-auto max-w-full object-cover rounded-xl" />
              <button
                type="button"
                (click)="removeMedia()"
                class="absolute top-1.5 right-1.5 p-1 bg-black/70 hover:bg-black text-white rounded-full transition"
                title="Remove image"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          } @else {
            <button
              type="button"
              (click)="fileInput.click()"
              [disabled]="uploadingMedia()"
              class="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-surface-sunken border border-border text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition disabled:opacity-50"
            >
              @if (uploadingMedia()) {
                <div class="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span>Uploading image...</span>
              } @else {
                <svg class="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Attach Promo Image (Optional)</span>
              }
            </button>
          }
        </div>

        <!-- Channels -->
        <div class="mt-4">
          <span class="block text-xs font-medium text-text-primary mb-1.5">Send via</span>
          <div class="flex flex-wrap gap-2">
            @for (opt of channelOptions; track opt.value) {
              @let available = availableChannels().includes(opt.value);
              <button
                type="button"
                (click)="toggleChannel(opt.value)"
                [disabled]="!available"
                [attr.aria-pressed]="channels().includes(opt.value)"
                [class]="'px-3 py-1.5 rounded-full border text-xs font-medium transition disabled:cursor-not-allowed ' +
                  (channels().includes(opt.value)
                    ? 'bg-primary text-white border-primary'
                    : available
                      ? 'bg-surface-sunken text-text-body border-border hover:border-primary/40'
                      : 'bg-surface-sunken text-text-disabled border-border')"
              >
                {{ opt.label }}@if (!available) { · Coming soon }
              </button>
            }
          </div>
          @if (audience() !== null) {
            <p class="mt-2 text-xs text-text-secondary">
              Will reach <span class="font-semibold text-text-primary">{{ audience() }} customers</span>
            </p>
          }
        </div>

        <a
          [routerLink]="broadcastsLink()"
          (click)="close()"
          class="inline-block mt-4 text-xs font-medium text-primary hover:underline"
        >
          Schedule automated broadcasts instead
        </a>

        <!-- Modal Actions -->
        <div class="flex items-center justify-end gap-2.5 mt-6 pt-3 border-t border-border">
          <button
            type="button"
            (click)="close()"
            class="px-4 py-2 rounded-xl text-sm font-medium text-text-secondary hover:bg-surface-overlay transition"
          >
            Cancel
          </button>
          <button
            type="button"
            (click)="sendBroadcast()"
            [disabled]="!body().trim() || sending() || uploadingMedia()"
            class="px-5 py-2 rounded-xl text-sm font-medium bg-primary text-white hover:bg-primary-hover active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
          >
            @if (sending()) {
              <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Queuing...</span>
            } @else {
              <span>Send Broadcast</span>
            }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class BroadcastModalComponent implements OnInit {
  private readonly _chatService = inject(ChatService);
  private readonly _automations = inject(BroadcastAutomationsService);
  private readonly _toast = inject(ToastService);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  readonly salonId = input.required<string>();
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly sent = new EventEmitter<void>();

  protected readonly broadcastsLink = computed(() => RoutePath.salonBroadcasts(this.salonId()));
  protected readonly channelOptions = CHANNEL_OPTIONS;
  protected readonly audience = signal<number | null>(null);
  // Availability comes from the API; anything not listed shows "Coming soon".
  protected readonly availableChannels = signal<BroadcastChannel[]>(['IN_APP']);
  protected readonly channels = signal<BroadcastChannel[]>(['IN_APP']);
  protected readonly body = signal<string>('');
  protected readonly mediaUrl = signal<string | null>(null);
  protected readonly uploadingMedia = signal<boolean>(false);
  protected readonly sending = signal<boolean>(false);

  ngOnInit(): void {
    this._automations.getAudience(this.salonId()).subscribe({
      next: (res) => {
        this.audience.set(res.recipientCount);
        this.availableChannels.set(res.availableChannels);
      },
    });
  }

  // FIXME: toggleChannel and the channel chips in the template are duplicated in
  // broadcasts/broadcast-automations.component — extract one shared component.
  protected toggleChannel(channel: BroadcastChannel): void {
    if (!this.availableChannels().includes(channel)) return;
    const current = this.channels();
    if (current.includes(channel)) {
      if (current.length > 1) this.channels.set(current.filter((c) => c !== channel));
    } else {
      this.channels.set([...current, channel]);
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadingMedia.set(true);
    uploadMedia(this._http, this._apiConfig, {
      file,
      entityType: 'SALON',
      entityId: this.salonId(),
      type: 'GALLERY',
    }).subscribe({
      next: (media) => {
        this.mediaUrl.set(media.url);
        this.uploadingMedia.set(false);
      },
      error: (err) => {
        this.uploadingMedia.set(false);
        this._toast.error(err?.message || 'Failed to upload image');
      },
    });
    input.value = '';
  }

  protected removeMedia(): void {
    this.mediaUrl.set(null);
  }

  protected sendBroadcast(): void {
    const text = this.body().trim();
    if (!text || this.sending() || this.uploadingMedia()) return;

    this.sending.set(true);
    this._chatService
      .sendBroadcast(this.salonId(), {
        body: text,
        mediaUrl: this.mediaUrl() || undefined,
        channels: this.channels(),
      })
      .subscribe({
        next: (res) => {
          this.sending.set(false);
          this._toast.success(res.message || 'Broadcast queued successfully!');
          this.sent.emit();
          this.close();
        },
        error: (err) => {
          this.sending.set(false);
          this._toast.error(err?.error?.message || 'Failed to dispatch broadcast');
        },
      });
  }
}

