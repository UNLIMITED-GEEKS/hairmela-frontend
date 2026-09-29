import { Injectable, inject } from '@angular/core';
import { AppPlatformService } from '../native/app-platform.service';
import { environment } from '../../../environments/environment';

const GOOGLE_SCRIPT_ID = 'google-identity-services';
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

type GoogleButtonText = 'continue_with' | 'signin_with' | 'signup_with';
type GoogleButtonTheme = 'outline' | 'outline_dark';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: 'standard';
      theme: GoogleButtonTheme;
      size: 'large';
      shape: 'pill';
      text: GoogleButtonText;
      width: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private readonly _platform = inject(AppPlatformService);
  private _scriptPromise: Promise<void> | null = null;
  private _nativeInitialized = false;

  readonly available = this._platform.shell !== 'ios';
  readonly usesNativeButton = this._platform.shell === 'android';

  async renderWebButton(
    element: HTMLElement,
    text: GoogleButtonText,
    theme: GoogleButtonTheme,
    onCredential: (idToken: string) => void,
  ): Promise<void> {
    if (!this.available || !this._platform.isWeb) return;
    await this._loadWebLibrary();
    const google = window.google;
    if (!google) throw new Error('Google Identity Services did not load.');

    google.accounts.id.initialize({
      client_id: environment.googleWebClientId,
      callback: (response) => {
        if (response.credential) onCredential(response.credential);
      },
    });
    element.replaceChildren();
    google.accounts.id.renderButton(element, {
      type: 'standard',
      theme,
      size: 'large',
      shape: 'pill',
      text,
      width: Math.min(320, Math.max(240, element.clientWidth)),
    });

    const googleWrapper = element.firstElementChild as HTMLElement | null;
    googleWrapper?.style.setProperty('overflow', 'hidden');
    googleWrapper?.style.setProperty('background-color', 'var(--color-surface-card)');
  }

  async getAndroidIdToken(): Promise<string> {
    if (!this.usesNativeButton) throw new Error('Google sign-in is unavailable on this platform.');
    const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in');
    if (!this._nativeInitialized) {
      await GoogleSignIn.initialize({ clientId: environment.googleWebClientId });
      this._nativeInitialized = true;
    }
    const result = await GoogleSignIn.signIn();
    return result.idToken;
  }

  private _loadWebLibrary(): Promise<void> {
    if (window.google?.accounts.id) return Promise.resolve();
    if (this._scriptPromise) return this._scriptPromise;

    this._scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
      const script = existing ?? document.createElement('script');
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Google sign-in failed to load.')), {
        once: true,
      });
      if (!existing) {
        script.id = GOOGLE_SCRIPT_ID;
        script.src = GOOGLE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
    return this._scriptPromise;
  }
}
