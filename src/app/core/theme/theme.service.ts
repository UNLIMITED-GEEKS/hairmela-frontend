import { Injectable, computed, inject, signal } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';

/** What the user CHOSE. 'system' follows the OS and is the default. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is actually rendered — 'system' is always resolved to one of these. */
export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'hm_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Light/dark mode.
 *
 * Writes [data-theme] on <html>, which is what every surface/text/border token
 * in styles.css keys off — so no component needs to know the theme exists.
 *
 * Defaults to 'system': the OS setting decides, and the app follows it live if
 * the user changes it mid-session (Android and iOS both do this on a schedule
 * or a control-centre toggle). Picking light or dark explicitly pins it and
 * stops following.
 *
 * prefers-color-scheme works in every target: the Android WebView reports the
 * system setting, iOS standalone reports it from Settings > Display, and
 * browsers report their own. There is no Capacitor plugin needed for this.
 *
 * Applied from an app initializer rather than a component, so the attribute is
 * on <html> before the first paint and there is no light-to-dark flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _store = inject(PersistentStore);

  /** The user's choice, including 'system'. */
  private readonly _preference = signal<ThemePreference>('system');
  /** What the OS currently reports, kept live via the media query listener. */
  private readonly _systemMode = signal<ThemeMode>('light');

  readonly preference = this._preference.asReadonly();

  /** The theme actually showing — what components and the toggle read. */
  readonly mode = computed<ThemeMode>(() => {
    const pref = this._preference();
    return pref === 'system' ? this._systemMode() : pref;
  });

  /** Called by an app initializer, after PersistentStore has hydrated. */
  init(): void {
    const saved = this._store.get<ThemePreference>(THEME_KEY);
    this._preference.set(saved === 'dark' || saved === 'light' ? saved : 'system');

    // matchMedia is missing in jsdom (tests) and in server-side rendering, so
    // every use of it is guarded — the fallback is light.
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
    this._systemMode.set(query?.matches ? 'dark' : 'light');

    // Follow the OS live. Android and iOS can both flip on a schedule or from
    // a system toggle while the app is open; without this the app would keep
    // whatever the setting was at launch until it was restarted.
    query?.addEventListener('change', (e) => {
      this._systemMode.set(e.matches ? 'dark' : 'light');
      if (this._preference() === 'system') this._apply(this.mode());
    });

    this._apply(this.mode());
  }

  /** Pins the theme, or hands control back to the OS with 'system'. */
  set(preference: ThemePreference): void {
    this._preference.set(preference);
    this._store.set(THEME_KEY, preference);
    // Mirror to localStorage as well. PersistentStore writes to Capacitor
    // Preferences on native and does NOT touch localStorage there, but the
    // pre-boot script in index.html can only read synchronously — and
    // Preferences is async. Without this mirror an APK user who pinned dark
    // would flash light on every launch until the initializer caught up.
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(preference));
    } catch {
      // Storage unavailable (private mode): the theme still applies this
      // session, it just cannot pre-empt the next launch's first paint.
    }
    this._apply(this.mode());
  }

  /**
   * Flips to the opposite of what is CURRENTLY showing, which also pins it —
   * a user tapping a toggle is making an explicit choice, so following the OS
   * afterwards would undo it the next time the system flipped.
   */
  toggle(): void {
    this.set(this.mode() === 'dark' ? 'light' : 'dark');
  }

  private _apply(mode: ThemeMode): void {
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    // Tells the browser to render native controls, scrollbars and form widgets
    // in the matching scheme — without it a dark page keeps white scrollbars
    // and light-styled date pickers.
    root.style.colorScheme = mode;

    // Browser/OS chrome — Android's status bar, Safari's toolbar. index.html
    // sets this before boot; this keeps it right when the user toggles at
    // runtime, which the meta tag's own media query cannot do (it follows the
    // OS, not the in-app choice). Values mirror --color-surface per theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#1C1C1C' : '#8B0000');
  }
}
