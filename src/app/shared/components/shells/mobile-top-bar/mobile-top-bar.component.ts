import { Component, input, computed, signal, linkedSignal, inject, ElementRef, HostListener } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MembershipStore } from '../../../../core/salon-context/membership.store';
import { MySalonDto } from '../../../../api/models/my-salon-dto';
import { RoutePath, RouteQueryParam, RouteSegment } from '../../../../core/routing/route-paths';
import { BackButtonComponent } from '../../back-button/back-button.component';
import { AppPlatformService } from '../../../../core/native/app-platform.service';
import { ToastService } from '../../../../core/toast/toast.service';
import { environment } from '../../../../../environments/environment';
import { AppHeaderService } from '../../../../core/routing/app-header.service';

@Component({
  selector: 'app-mobile-top-bar',
  templateUrl: './mobile-top-bar.component.html',
  imports: [RouterLink, BackButtonComponent],
})
export class MobileTopBarComponent {
  private readonly _router = inject(Router);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _element = inject(ElementRef<HTMLElement>);
  private readonly _platform = inject(AppPlatformService);
  private readonly _toast = inject(ToastService);
  protected readonly header = inject(AppHeaderService);

  readonly salons = input<MySalonDto[]>([]);
  readonly activeSalonId = input<string | null>(null);

  protected readonly accountLink = RoutePath.account();
  protected readonly favoritesLink = RoutePath.favorites();
  protected readonly notificationsLink = RoutePath.notifications();
  protected readonly settingsLink = RoutePath.accountSettings();
  protected readonly signInLink = RoutePath.login();

  protected readonly dropdownOpen = linkedSignal({
    source: () => this.header.state().isHome,
    computation: (): boolean => false,
  });
  protected readonly menuOpen = signal(false);
  /**
   * Set by the guest shell — a guest has no session, so the dashboard would
   * only bounce them to login. Defaults false, keeping the auth shell on the
   * dashboard: there the user is already inside the app, and sending the logo
   * to the marketing home would read as being logged out.
   */
  readonly isGuest = input(false);

  // Home for a guest, dashboard for a signed-in user (see isGuest).
  protected readonly rootLink = computed(() =>
    this.isGuest() ? RoutePath.root() : RoutePath.dashboard(),
  );

  protected readonly activeSalon = computed(
    () => this.salons().find((s) => s.salon.id === this.activeSalonId()) ?? this.salons()[0] ?? null,
  );

  // Branches share their root's name exactly, so a chain's salons are
  // indistinguishable in this list by name alone. Show the slug alongside the
  // name only for the names that actually repeat — a user with uniquely-named
  // salons sees no change.
  private readonly _duplicateNames = computed(() => {
    const counts = new Map<string, number>();
    for (const s of this.salons()) {
      counts.set(s.salon.name, (counts.get(s.salon.name) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
  });

  protected isAmbiguous(name: string): boolean {
    return this._duplicateNames().has(name);
  }

  protected toggleDropdown(): void {
    this.menuOpen.set(false);
    this.dropdownOpen.update((v) => !v);
  }

  protected closeDropdown(): void {
    this.dropdownOpen.set(false);
  }

  protected toggleMenu(): void {
    this.dropdownOpen.set(false);
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this._element.nativeElement.contains(event.target as Node)) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closeMenu();
    this.closeDropdown();
  }

  protected async shareLink(): Promise<void> {
    this.closeMenu();
    const url = this._platform.isNative
      ? this._platform.nativePlatform === 'ios'
        ? 'https://apps.apple.com/app/id6816222315'
        : 'https://play.google.com/store/apps/details?id=com.hairmela.app'
      : environment.appBaseUrl;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'HairMela', text: 'Check out HairMela', url });
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      this._toast.success('Link copied');
    } catch {
      this._toast.error('Could not share link');
    }
  }

  protected switchSalon(salonId: string): void {
    this.dropdownOpen.set(false);
    const currentSalonId = this.activeSalonId();
    if (currentSalonId) this._membershipStore.invalidate(currentSalonId);
    const currentUrl = this._router.url;
    if (currentUrl.startsWith(RoutePath.dashboard()[0])) {
      this._router.navigate(RoutePath.dashboard(), { queryParams: { [RouteQueryParam.SALON]: salonId } });
      return;
    }
    const salonMatch = currentUrl.match(new RegExp(`/${RouteSegment.SALONS}/[^/?]+(.*)`));
    const subPath = salonMatch ? salonMatch[1] : '';
    const target = `/${RouteSegment.SALONS}/${salonId}${subPath}`;
    // FIXME: bouncing through /dashboard to force component teardown is a hack —
    // replace with a proper solution (e.g. runGuardsAndResolvers or a dedicated
    // salon-switch event that feature components subscribe to for refetching).
    this._router.navigateByUrl(RoutePath.dashboard()[0], { skipLocationChange: true }).then(() =>
      this._router.navigateByUrl(target),
    );
  }
}
