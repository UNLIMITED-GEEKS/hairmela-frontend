import { Component, input, computed, signal, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MembershipStore } from '../../../../core/salon-context/membership.store';
import { MySalonDto } from '../../../../api/models/my-salon-dto';
import { RoutePath, RouteQueryParam, RouteSegment } from '../../../../core/routing/route-paths';
import { AvatarComponent } from '../../avatar/avatar.component';

@Component({
  selector: 'app-mobile-top-bar',
  templateUrl: './mobile-top-bar.component.html',
  imports: [RouterLink, AvatarComponent],
})
export class MobileTopBarComponent {
  private readonly _router = inject(Router);
  private readonly _membershipStore = inject(MembershipStore);

  /**
   * Full name of the signed-in user, or empty for a guest. Drives the initials
   * avatar that links to the account page.
   *
   * An INPUT rather than injecting CurrentUserStore, because the guest shell
   * renders this same bar and has no user — keeping it passed in leaves this
   * component agnostic about which shell it is in, as salons/activeSalonId
   * already are.
   */
  readonly userName = input('');
  readonly salons = input<MySalonDto[]>([]);
  readonly activeSalonId = input<string | null>(null);

  protected readonly accountLink = RoutePath.account();

  protected readonly dropdownOpen = signal(false);
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
    this.dropdownOpen.update((v) => !v);
  }

  protected closeDropdown(): void {
    this.dropdownOpen.set(false);
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
