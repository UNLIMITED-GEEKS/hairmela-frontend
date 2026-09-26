import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { pushControllerFcmSubscribe } from '../../api/fn/push/push-controller-fcm-subscribe';
import { pushControllerFcmUnsubscribe } from '../../api/fn/push/push-controller-fcm-unsubscribe';
import { pushControllerApnsSubscribe } from '../../api/fn/push/push-controller-apns-subscribe';
import { pushControllerApnsUnsubscribe } from '../../api/fn/push/push-controller-apns-unsubscribe';

// Liveness guard on native registration — see _register() for why waiting longer
// would not help. Generous relative to the sub-second normal case.
const REGISTRATION_TIMEOUT_MS = 15_000;

/** Payload the backend sends to a native device. Every custom value is a string. */
export interface NativePushData {
  title?: string;
  body?: string;
  type?: string;
  entityType?: string;
  entityId?: string;
  url?: string;
}

// Native half of push for the Capacitor build. Android uses FCM; iOS uses APNs.
// Web keeps SwPush/VAPID
// untouched in PushService, which delegates here when running natively.
//
// Every Capacitor import is a dynamic import() behind an environment.native
// guard (see AppPlatformService) so none of it can reach a web bundle.
//
// WHY LOCAL NOTIFICATIONS: Android does not automatically display an FCM
// notification while the app is in the foreground, so this service posts the
// visible notification in that state. When the app is backgrounded or
// terminated, the backend must include an FCM `notification` block so Android
// can display it without relying on this WebView JavaScript to be running. The
// accompanying FCM `data` values preserve the deep link for tap handling.
@Injectable({ providedIn: 'root' })
export class NativePushService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _subscribed = signal(false);
  readonly subscribed = this._subscribed.asReadonly();

  /** Current native registration token, kept so unsubscribe can name it. */
  private _token: string | null = null;
  private _listenersBound = false;
  /** In-flight listener binding, so every caller awaits the same pass. */
  private _ready?: Promise<void>;

  /** Resolves once registration completes (or fails) after registerListeners(). */
  private _tokenResolve: ((token: string | null) => void) | null = null;

  /**
   * Wire native push + local-notification listeners. Safe to call repeatedly; only the
   * first call binds. Does NOT request permission — enable() does that, so the
   * OS prompt stays tied to a user action.
   */
  init(onNotificationTap: (data: NativePushData) => void): Promise<void> {
    // Cache the in-flight promise so enable()/refresh() can await the SAME
    // binding pass. Without this, a caller that runs before listeners are bound
    // calls register() and the 'registration' event fires into nothing —
    // measured at ~12ms on device, which was enough to lose every token.
    return (this._ready ??= this._bindListeners(onNotificationTap));
  }

  private async _bindListeners(onNotificationTap: (data: NativePushData) => void): Promise<void> {
    if (this._listenersBound) return;
    this._listenersBound = true;

    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    await PushNotifications.addListener('registration', (token) => {
      this._token = token.value;
      this._tokenResolve?.(token.value);
      this._tokenResolve = null;
    });

    await PushNotifications.addListener('registrationError', () => {
      this._tokenResolve?.(null);
      this._tokenResolve = null;
    });

    // Message received while the app is in the foreground. Android does not
    // display it automatically in this state, so post a local notification to
    // match what the OS displays while the app is backgrounded.
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const data = (notification.data ?? {}) as NativePushData;
      void this._present(LocalNotifications, data);
    });

    // Tap on a notification the OS displayed (app was backgrounded/killed).
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      onNotificationTap((action.notification.data ?? {}) as NativePushData);
    });

    // Tap on a notification WE posted via LocalNotifications (foreground case
    // above) — a separate listener, since these are not FCM notifications.
    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      onNotificationTap((action.notification.extra ?? {}) as NativePushData);
    });
  }

  /**
   * Ask for permission, register with the OS, and persist the token server-side.
   *
   * Distinguishes 'denied' (the user said no — a settled, final answer) from
   * 'unsupported' (permission was granted but registration or the server call
   * failed). Collapsing the second into 'denied' would tell the caller the user
   * refused when they did not, and the UI says "you can turn this on later in
   * your account" — advice that cannot help when the real fault is Play
   * Services or the network.
   */
  async enable(platform: 'android' | 'ios'): Promise<'enabled' | 'denied' | 'unsupported'> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    const push = await PushNotifications.requestPermissions();
    if (push.receive !== 'granted') return 'denied';

    // Separate permission on Android 13+: without it our own posted
    // notifications are silently dropped even though FCM delivery succeeds.
    if (platform === 'android') await LocalNotifications.requestPermissions();

    // Listeners must be bound before register() or the token event is lost.
    await this._ready;
    const token = await this._register(PushNotifications);
    if (!token) return 'unsupported';

    try {
      await this._subscribe(token, platform);
    } catch {
      // Token obtained but not persisted — push genuinely will not arrive, and
      // permission is already granted, so reporting 'denied' would be wrong.
      return 'unsupported';
    }

    this._subscribed.set(true);
    return 'enabled';
  }

  /**
   * Deregister this device. Best-effort: a 404 means the row is already gone,
   * which the backend documents as equivalent to success.
   */
  async disable(platform: 'android' | 'ios'): Promise<void> {
    this._subscribed.set(false);
    const token = this._token;
    if (!token) return;

    try {
      await this._unsubscribe(token, platform);
    } catch {
      // 404 = already unsubscribed; anything else must not block logout.
    }
  }

  /**
   * Re-send the current token. Native tokens rotate, and the backend upserts, so
   * this is called on every launch to keep the row fresh.
   */
  async refresh(platform: 'android' | 'ios'): Promise<void> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') return;

    await this._ready;
    const token = await this._register(PushNotifications);
    if (!token) return;

    try {
      await this._subscribe(token, platform);
      this._subscribed.set(true);
    } catch {
      // Offline or a transient failure — the next launch retries.
    }
  }

  async permission(): Promise<NotificationPermission> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const state = await PushNotifications.checkPermissions();
    if (state.receive === 'granted') return 'granted';
    if (state.receive === 'denied') return 'denied';
    return 'default';
  }

  // PushNotifications.register() resolves immediately; the token arrives later
  // on the 'registration' event, so this bridges that into a promise.
  //
  // The timeout is a liveness guard, not a deadline: registration normally
  // completes in well under a second, and the only realistic causes of silence
  // are missing native push services, provisioning trouble, or no network —
  // none resolves by waiting longer. Callers treat null as 'unsupported',
  // never 'denied', so a slow device is never reported as a user refusal.
  private _register(
    pushNotifications: typeof import('@capacitor/push-notifications').PushNotifications,
  ): Promise<string | null> {
    if (this._token) return Promise.resolve(this._token);

    return new Promise<string | null>((resolve) => {
      this._tokenResolve = resolve;
      void pushNotifications.register();
      setTimeout(() => {
        if (this._tokenResolve === resolve) {
          this._tokenResolve = null;
          resolve(this._token);
        }
      }, REGISTRATION_TIMEOUT_MS);
    });
  }

  private async _subscribe(token: string, platform: 'android' | 'ios'): Promise<void> {
    if (platform === 'ios') {
      await firstValueFrom(
        pushControllerApnsSubscribe(this._http, this._apiConfig.rootUrl, {
          body: { deviceToken: token },
        }),
      );
      return;
    }

    await firstValueFrom(
      pushControllerFcmSubscribe(this._http, this._apiConfig.rootUrl, {
        body: { fcmToken: token, platform },
      }),
    );
  }

  private async _unsubscribe(token: string, platform: 'android' | 'ios'): Promise<void> {
    if (platform === 'ios') {
      await firstValueFrom(
        pushControllerApnsUnsubscribe(this._http, this._apiConfig.rootUrl, {
          body: { deviceToken: token },
        }),
      );
      return;
    }

    await firstValueFrom(
      pushControllerFcmUnsubscribe(this._http, this._apiConfig.rootUrl, {
        body: { fcmToken: token },
      }),
    );
  }

  private async _present(
    localNotifications: typeof import('@capacitor/local-notifications').LocalNotifications,
    data: NativePushData,
  ): Promise<void> {
    if (!data.title && !data.body) return;
    try {
      await localNotifications.schedule({
        notifications: [
          {
            // Bounded so it fits Android's 32-bit notification id.
            id: Math.floor(Math.random() * 2_000_000_000) || 1,
            title: data.title ?? 'HairMela',
            body: data.body ?? '',
            // Carried through so the tap listener can deep-link, exactly as the
            // FCM path does with notification.data.
            extra: data,
          },
        ],
      });
    } catch {
      // Permission revoked mid-session, or the OS refused — never throw into
      // the push listener.
    }
  }
}
