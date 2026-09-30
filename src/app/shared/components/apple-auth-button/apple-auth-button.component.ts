import { Component, inject, input, output, signal } from '@angular/core';
import {
  AppleIdentityCredential,
  AppleIdentityService,
} from '../../../core/auth/apple-identity.service';
import { InlineSpinnerComponent } from '../inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-apple-auth-button',
  imports: [InlineSpinnerComponent],
  templateUrl: './apple-auth-button.component.html',
})
export class AppleAuthButtonComponent {
  private readonly _apple = inject(AppleIdentityService);

  readonly disabled = input(false);
  readonly credential = output<AppleIdentityCredential>();
  readonly failed = output<void>();

  protected readonly available = this._apple.available;
  protected readonly loading = signal(false);

  protected async signIn(): Promise<void> {
    if (this.disabled() || this.loading()) return;
    this.loading.set(true);
    try {
      this.credential.emit(await this._apple.getCredential());
    } catch {
      this.failed.emit();
    } finally {
      this.loading.set(false);
    }
  }
}
