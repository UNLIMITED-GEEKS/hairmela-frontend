import { Signal } from '@angular/core';

export interface NavItem {
  readonly label: string;
  readonly icon: NavIcon;
  readonly url?: string;
  readonly action?: () => void;
  readonly badge?: Signal<number>;
  /** Renders as a primary CTA button */
  readonly cta?: boolean;
  /** Auth action — rendered in the right slot alongside the CTA */
  readonly auth?: boolean;
  /** Include in bottom nav bar */
  readonly bottomNav?: boolean;
  /** Include in desktop sidebar */
  readonly sidebar?: boolean;
  /** Include in mobile sheet */
  readonly sheet?: boolean;
}

export type NavIcon =
  | 'home'
  | 'queue'
  | 'bell'
  | 'person'
  | 'person-add'
  | 'login'
  | 'menu'
  | 'close'
  | 'scissors'
  | 'info'
  | 'mail'
  | 'heart'
  | 'search'
  | 'profile';
