import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

@Component({
  selector: 'app-chat-audio-bubble',
  standalone: true,
  imports: [CommonModule, MediaUrlPipe],
  template: `
    <div class="flex items-center gap-2.5 sm:gap-3 py-1 select-none w-full min-w-[220px] max-w-[320px]">
      <!-- Sender Avatar with Mic Badge -->
      <div class="relative shrink-0">
        <div
          class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm overflow-hidden"
          [ngClass]="isMine ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'"
        >
          @if (avatarUrl) {
            <img [src]="avatarUrl | mediaUrl:'thumb'" alt="" class="w-full h-full object-cover" />
          } @else {
            <span>{{ (senderName || 'U').slice(0, 1).toUpperCase() }}</span>
          }
        </div>
        <!-- Micro badge -->
        <span
          class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px]"
          [ngClass]="isMine ? 'bg-[#ffffff] text-[#660029]' : 'bg-primary text-white'"
        >
          <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </span>
      </div>

      <!-- Audio Body -->
      <div class="flex-1 min-w-0 flex flex-col justify-center">
        <div class="flex items-center gap-2">
          <!-- Play / Pause Button -->
          <button
            type="button"
            (click)="togglePlay()"
            [disabled]="loadingError()"
            class="w-11 h-11 p-0 leading-none rounded-full flex items-center justify-center shrink-0 transition active:scale-95"
            [class]="isMine ? 'bg-[#ffffff] text-[#660029] hover:opacity-90' : 'bg-primary text-white hover:bg-primary-hover'"
            [attr.aria-label]="isPlaying() ? 'Pause voice message' : 'Play voice message'"
          >
            @if (isPlaying()) {
              <!-- Pause Icon -->
              <svg class="block w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            } @else {
              <!-- Play Icon -->
              <svg class="block w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4v16l12-8z" />
              </svg>
            }
          </button>

          <!-- Interactive Waveform Scrubber -->
          <div
            #waveformContainer
            (click)="onSeek($event)"
            class="flex-1 h-8 flex items-center gap-[2.5px] cursor-pointer group py-1"
            title="Click to seek"
            role="slider"
            tabindex="0"
            aria-label="Seek voice message"
            (keydown)="onSeekKey($event)"
            [attr.aria-valuenow]="currentTime()"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="effectiveDuration()"
          >
            @for (bar of waveformBars; track $index) {
              <span
                class="w-[2.5px] rounded-full transition-colors duration-75 shrink-0"
                [style.height.%]="bar"
                [ngClass]="getBarClass($index)"
              ></span>
            }
          </div>

          <!-- Speed Toggle Pill -->
          <button
            type="button"
            (click)="cycleSpeed()"
            class="px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-tight transition shrink-0 self-center"
            [ngClass]="
              isMine
                ? 'bg-white/20 text-white hover:bg-white/30'
                : 'bg-surface-sunken text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-border/50'
            "
            title="Playback speed"
            aria-label="Toggle playback speed"
          >
            {{ playbackRate() }}x
          </button>
        </div>

        <!-- Timer / Elapsed Display -->
        <div class="flex items-center justify-between text-[11px] font-medium leading-none px-1 mt-0.5">
          <span [ngClass]="isMine ? 'text-white/80' : 'text-text-secondary'">
            {{ formattedTime() }}
          </span>
          @if (loadingError()) {
            <span class="text-error text-[10px]">Failed to load audio</span>
          }
        </div>
      </div>
    </div>
  `,
})
export class ChatAudioBubbleComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) audioUrl!: string;
  @Input() duration: number | null | undefined = 0;
  @Input() isMine = false;
  @Input() avatarUrl: string | null = null;
  @Input() senderName = 'Sender';

  @ViewChild('waveformContainer') private _waveformContainer?: ElementRef<HTMLDivElement>;

  // Global static coordinator to ensure only one audio plays at a time
  private static _activeAudio: HTMLAudioElement | null = null;
  private static _activeComponent: ChatAudioBubbleComponent | null = null;

  protected readonly isPlaying = signal<boolean>(false);
  protected readonly currentTime = signal<number>(0);
  protected readonly playbackRate = signal<number>(1.0);
  protected readonly loadingError = signal<boolean>(false);
  protected readonly audioDuration = signal<number>(0);

  // 28 normalized waveform bar heights (percentage) for WhatsApp-like aesthetic
  readonly waveformBars: number[] = [
    30, 50, 75, 40, 85, 100, 55, 80, 95, 65, 40, 90, 75, 45, 95, 60, 35, 75,
    100, 45, 65, 85, 50, 40, 70, 55, 35, 25,
  ];

  private _audio: HTMLAudioElement | null = null;
  private _audioEvents: AbortController | null = null;
  private _pendingSeek: number | null = null;

  ngOnInit(): void {
    if (this.duration && this.duration > 0) {
      this.audioDuration.set(this.duration);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['duration'] && this.duration && this.duration > 0) {
      this.audioDuration.set(this.duration);
    }
    if (changes['audioUrl'] && !changes['audioUrl'].firstChange) {
      this._cleanupAudio();
      this.loadingError.set(false);
      this.audioDuration.set(this.duration || 0);
    }
  }

  ngOnDestroy(): void {
    this._cleanupAudio();
  }

  protected effectiveDuration(): number {
    return this.audioDuration() || this.duration || 0;
  }

  protected formattedTime(): string {
    const current = this.currentTime();
    if (this.isPlaying()) {
      return this._formatTime(current);
    }
    return this._formatTime(this.effectiveDuration());
  }

  protected getBarClass(index: number): string {
    const totalBars = this.waveformBars.length;
    const dur = this.effectiveDuration() || 1;
    const progress = Math.min(1, this.currentTime() / dur);
    const barProgress = index / totalBars;

    const isPlayed = barProgress <= progress;

    if (this.isMine) {
      return isPlayed ? 'bg-white' : 'bg-white/35';
    } else {
      return isPlayed ? 'bg-primary' : 'bg-border dark:bg-zinc-700';
    }
  }

  protected togglePlay(): void {
    if (this.loadingError()) return;

    if (!this._audio) {
      this._initAudio();
    }

    if (!this._audio) return;

    if (this.isPlaying()) {
      this._audio.pause();
    } else {
      // Pause any other playing voice note in the thread
      if (
        ChatAudioBubbleComponent._activeAudio &&
        ChatAudioBubbleComponent._activeAudio !== this._audio
      ) {
        ChatAudioBubbleComponent._activeAudio.pause();
      }
      if (
        ChatAudioBubbleComponent._activeComponent &&
        ChatAudioBubbleComponent._activeComponent !== this
      ) {
        ChatAudioBubbleComponent._activeComponent.isPlaying.set(false);
      }

      ChatAudioBubbleComponent._activeAudio = this._audio;
      ChatAudioBubbleComponent._activeComponent = this;

      this._audio.playbackRate = this.playbackRate();
      const audio = this._audio;
      audio.play().catch(() => {
        if (this._audio === audio) {
          this.loadingError.set(true);
          this.isPlaying.set(false);
        }
      });
    }
  }

  protected cycleSpeed(): void {
    const current = this.playbackRate();
    let next = 1.0;
    if (current === 1.0) next = 1.5;
    else if (current === 1.5) next = 2.0;
    else next = 1.0;

    this.playbackRate.set(next);
    if (this._audio) {
      this._audio.playbackRate = next;
    }
  }

  protected onSeek(event: MouseEvent): void {
    const container = this._waveformContainer?.nativeElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));

    if (!this._audio) {
      this._initAudio();
    }

    if (!this._audio) return;

    this._seekTo(pct, true);
  }

  protected onSeekKey(event: KeyboardEvent): void {
    const duration = this.effectiveDuration();
    if (!duration) return;
    const offsets: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 };
    let target: number;
    if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = duration;
    else if (event.key in offsets) target = this.currentTime() + offsets[event.key];
    else return;
    event.preventDefault();
    if (!this._audio) this._initAudio();
    this._seekTo(target / duration, false);
  }

  private _seekTo(progress: number, play: boolean): void {
    const audio = this._audio;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration : this.effectiveDuration();
    const target = Math.max(0, Math.min(1, progress)) * duration;
    if (audio.readyState >= 1) audio.currentTime = target;
    else this._pendingSeek = target;
    this.currentTime.set(target);
    if (play && !this.isPlaying()) this.togglePlay();
  }

  private _initAudio(): void {
    if (typeof Audio === 'undefined') return;
    try {
      const audio = new Audio(this.audioUrl);
      this._audio = audio;
      audio.preload = 'metadata';
      audio.playbackRate = this.playbackRate();
      this._audioEvents = new AbortController();
      const listen = (event: string, handler: () => void) =>
        audio.addEventListener(event, handler, { signal: this._audioEvents!.signal });
      listen('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          this.audioDuration.set(audio.duration);
        }
        if (this._pendingSeek !== null) {
          audio.currentTime = Math.min(this._pendingSeek, this.effectiveDuration());
          this._pendingSeek = null;
        }
      });
      listen('timeupdate', () => this.currentTime.set(audio.currentTime));
      listen('play', () => this.isPlaying.set(true));
      listen('pause', () => this.isPlaying.set(false));
      listen('ended', () => { this.isPlaying.set(false); this.currentTime.set(0); });
      listen('error', () => { this.loadingError.set(true); this.isPlaying.set(false); });
    } catch {
      this.loadingError.set(true);
    }
  }

  private _cleanupAudio(): void {
    const audio = this._audio;
    this._audioEvents?.abort();
    this._audioEvents = null;
    if (ChatAudioBubbleComponent._activeComponent === this) {
      ChatAudioBubbleComponent._activeAudio = null;
      ChatAudioBubbleComponent._activeComponent = null;
    }
    this._audio = null;
    this._pendingSeek = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.isPlaying.set(false);
    this.currentTime.set(0);
  }

  private _formatTime(sec: number): string {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

