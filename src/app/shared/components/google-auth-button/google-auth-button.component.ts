import {
  Component,
  ElementRef,
  NgZone,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { GoogleIdentityService } from '../../../core/auth/google-identity.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { InlineSpinnerComponent } from '../inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-google-auth-button',
  imports: [InlineSpinnerComponent],
  templateUrl: './google-auth-button.component.html',
})
export class GoogleAuthButtonComponent {
  private readonly _google = inject(GoogleIdentityService);
  private readonly _theme = inject(ThemeService);
  private readonly _zone = inject(NgZone);
  private readonly _webButton = viewChild<ElementRef<HTMLElement>>('webButton');

  readonly text = input<'continue_with' | 'signin_with' | 'signup_with'>('continue_with');
  readonly disabled = input(false);
  readonly idToken = output<string>();
  readonly failed = output<void>();

  protected readonly available = this._google.available;
  protected readonly native = this._google.usesNativeButton;
  protected readonly loading = signal(false);

  constructor() {
    effect(() => {
      const element = this._webButton()?.nativeElement;
      const theme = this._theme.mode() === 'dark' ? 'outline_dark' : 'outline';
      if (!element) return;
      void this._google
        .renderWebButton(element, this.text(), theme, (token) =>
          this._zone.run(() => this.idToken.emit(token)),
        )
        .catch(() => this._zone.run(() => this.failed.emit()));
    });
  }

  protected async signInNative(): Promise<void> {
    if (this.disabled() || this.loading()) return;
    this.loading.set(true);
    try {
      this.idToken.emit(await this._google.getAndroidIdToken());
    } catch {
      this.failed.emit();
    } finally {
      this.loading.set(false);
    }
  }
}
