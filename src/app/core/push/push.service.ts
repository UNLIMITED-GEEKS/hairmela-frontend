import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicPushControllerGetVapidPublicKey } from '../../api/fn/push/public-push-controller-get-vapid-public-key';
import { pushControllerSubscribe } from '../../api/fn/push/push-controller-subscribe';
import { pushControllerUnsubscribe } from '../../api/fn/push/push-controller-unsubscribe';
import { myEntriesControllerGetMyEntries } from '../../api/fn/queues/my-entries-controller-get-my-entries';
import { PersistentStore } from '../storage/persistent-store';
import { RoutePath } from '../routing/route-paths';

// Result of attempting to enable push — lets callers react without knowing the
// underlying reasons (unsupported env, denied permission, missing keys).
export type PushEnableResult = 'enabled' | 'denied' | 'unsupported';

const ASKED_KEY = 'hm_push_asked';

// Frontend half of the web-push chain (links 1 & 5). Wraps Angular's SwPush —
// which owns the generated ngsw-worker.js and re-emits the SW 'push' (auto-
// shown) and 'notificationclick' events — over the backend's push endpoints.
//
// Push only runs in a production build: provideServiceWorker is enabled only
// when !isDevMode(), so SwPush.isEnabled is false under `ng serve`. Every entry
// point guards on isEnabled so dev is a silent no-op, never a throw.
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly _swPush = inject(SwPush);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _router = inject(Router);
  private readonly _store = inject(PersistentStore);

  // Mirrors whether a browser subscription is currently active. Hydrated from
  // SwPush.subscription so the account toggle reflects reality across reloads.
  private readonly _subscribed = signal(false);
  readonly subscribed = this._subscribed.asReadonly();

  constructor() {
    if (!this._swPush.isEnabled) return;

    this._swPush.subscription
      .pipe(takeUntilDestroyed())
      .subscribe((sub) => this._subscribed.set(!!sub));

    // Link 5 (click half): Angular's SW shows the notification automatically
    // from the backend payload; we handle the click → deep-link navigation.
    this._swPush.notificationClicks
      .pipe(takeUntilDestroyed())
      .subscribe(({ notification }) => void this._navigateFromNotification(notification));
  }

  /** True only where push can actually run (prod build + SW support present). */
  get isSupported(): boolean {
    return this._swPush.isEnabled;
  }

  /** Browser-level permission state, or 'unsupported' when the SW isn't active. */
  get permission(): NotificationPermission | 'unsupported' {
    if (!this._swPush.isEnabled || typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }

  /** Whether we've already shown the contextual prompt this device. */
  hasAsked(): boolean {
    return this._store.get<boolean>(ASKED_KEY) === true;
  }

  markAsked(): void {
    this._store.set<boolean>(ASKED_KEY, true);
  }

  // Link 1: ask permission (browser prompt), subscribe via the VAPID public
  // key, then persist the subscription server-side. Idempotent — re-subscribing
  // an already-subscribed browser just re-saves the same subscription.
  async enable(): Promise<PushEnableResult> {
    if (!this._swPush.isEnabled) return 'unsupported';

    try {
      const vapidRes = await firstValueFrom(
        publicPushControllerGetVapidPublicKey(this._http, this._apiConfig.rootUrl),
      );
      const publicKey = vapidRes.body.publicKey;

      if (!publicKey) return 'unsupported';

      // SwPush handles the base64url → Uint8Array conversion internally and
      // triggers the browser permission prompt as part of subscribing.
      const sub = await this._swPush.requestSubscription({ serverPublicKey: publicKey });
      const json = sub.toJSON();
      const endpoint = json.endpoint;
      const p256dh = json.keys?.['p256dh'];
      const auth = json.keys?.['auth'];

      if (!endpoint || !p256dh || !auth) return 'unsupported';

      await firstValueFrom(
        pushControllerSubscribe(this._http, this._apiConfig.rootUrl, {
          body: { endpoint, p256dhKey: p256dh, authKey: auth },
        }),
      );

      this._subscribed.set(true);
      return 'enabled';
    } catch {
      // requestSubscription rejects when the user denies the permission prompt.
      return 'denied';
    }
  }

  // Unsubscribe. Flip the UI state immediately so the toggle feels instant.
  // ORDER MATTERS for the server call: the DELETE needs the still-valid Bearer
  // token, so this runs before logout clears tokens. The HTTP request captures
  // the token when initiated, so the early signal flip is safe.
  async disable(): Promise<void> {
    if (!this._swPush.isEnabled) return;

    // Predict: flip immediately so the toggle reflects the new state
    this._subscribed.set(false);

    try {
      const sub = await firstValueFrom(this._swPush.subscription);
      if (sub) {
        await firstValueFrom(
          pushControllerUnsubscribe(this._http, this._apiConfig.rootUrl, {
            body: { endpoint: sub.endpoint },
          }),
        );
        await this._swPush.unsubscribe();
      }
    } catch {
      // Best-effort: a failed server delete or local unsubscribe must not block
      // logout. The backend prunes dead subscriptions when a send fails anyway.
      // Revert only if the call was from a user toggle (not logout).
      // Since disable is best-effort, leave _subscribed false — the user can
      // re-enable if needed.
    }
  }

  // Map the backend notification payload to an in-app route. The "it's your
  // turn" payload carries only `entityId` (= the entryId), so we resolve the
  // route via GET /queues/my-entries — which loads queue.salon specifically so
  // the position link builds without a second request. An explicit `data.url`
  // (if the backend ever sends one) wins; anything unresolved falls back to the
  // dashboard so a click is never a dead end.
  private async _navigateFromNotification(
    notification: NotificationOptions & { title: string },
  ): Promise<void> {
    const data = (notification.data ?? {}) as { url?: string; entityId?: string };

    if (typeof data.url === 'string' && data.url.length > 0) {
      void this._router.navigateByUrl(data.url);
      return;
    }

    const route = data.entityId ? await this._positionRouteFor(data.entityId) : null;
    void this._router.navigate(route ?? RoutePath.dashboard());
  }

  // Resolve the customer's position route for a given entryId by matching it
  // against their active entries (each carries queueId + queue.salon.slug).
  private async _positionRouteFor(entryId: string): Promise<string[] | null> {
    try {
      const res = await firstValueFrom(
        myEntriesControllerGetMyEntries(this._http, this._apiConfig.rootUrl),
      );
      const entry = res.body.find((e) => e.id === entryId);
      const slug = entry?.queue?.salon?.slug;
      if (!entry || !slug) return null;
      return RoutePath.visitPosition('', slug, entry.queueId, entry.id);
    } catch {
      return null;
    }
  }
}
