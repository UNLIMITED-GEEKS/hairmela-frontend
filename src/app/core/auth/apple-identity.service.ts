import { Injectable, inject } from '@angular/core';
import { AppPlatformService } from '../native/app-platform.service';

export interface AppleIdentityCredential {
  idToken: string;
  firstName?: string;
  lastName?: string;
}

@Injectable({ providedIn: 'root' })
export class AppleIdentityService {
  private readonly _platform = inject(AppPlatformService);

  readonly available = this._platform.shell === 'ios';

  async getCredential(): Promise<AppleIdentityCredential> {
    if (!this.available) throw new Error('Apple sign-in is unavailable on this platform.');

    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithApple();
    const { token } = await FirebaseAuthentication.getIdToken({ forceRefresh: true });
    const names = result.user?.displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
    const firstName = names.shift();
    const lastName = names.length > 0 ? names.join(' ') : undefined;

    return {
      idToken: token,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    };
  }
}
