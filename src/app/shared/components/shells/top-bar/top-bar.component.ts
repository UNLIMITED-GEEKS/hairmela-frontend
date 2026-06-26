import { Component, input, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { CurrentUserStore } from '../../../../core/auth/current-user.store';
import { MembershipStore } from '../../../../core/salon-context/membership.store';
import { AvatarComponent } from '../../avatar/avatar.component';
import { MySalonDto } from '../../../../api/models/my-salon-dto';

@Component({
  selector: 'app-top-bar',
  templateUrl: './top-bar.component.html',
  imports: [AvatarComponent],
})
export class TopBarComponent {
  readonly showUserAvatar = input(true);
  readonly salons = input<MySalonDto[]>([]);
  readonly activeSalonId = input<string | null>(null);

  protected readonly _currentUser = inject(CurrentUserStore);
  private readonly _router = inject(Router);
  private readonly _membershipStore = inject(MembershipStore);

  protected readonly dropdownOpen = signal(false);

  protected readonly activeSalon = computed(
    () => this.salons().find((s) => s.salon.id === this.activeSalonId()) ?? null,
  );

  protected switchSalon(salonId: string): void {
    this.dropdownOpen.set(false);
    const currentSalonId = this.activeSalonId();
    if (currentSalonId) this._membershipStore.invalidate(currentSalonId);
    const currentUrl = this._router.url;
    if (currentUrl.startsWith('/dashboard')) {
      this._router.navigate(['/dashboard'], { queryParams: { salon: salonId } });
      return;
    }
    const salonMatch = currentUrl.match(/\/salons\/[^/?]+(.*)/);
    const subPath = salonMatch ? salonMatch[1] : '';
    const target = `/salons/${salonId}${subPath}`;
    // FIXME: bouncing through /dashboard to force component teardown is a hack —
    // replace with a proper solution (e.g. runGuardsAndResolvers or a dedicated
    // salon-switch event that feature components subscribe to for refetching).
    this._router.navigateByUrl('/dashboard', { skipLocationChange: true }).then(() =>
      this._router.navigateByUrl(target),
    );
  }

  protected toggleDropdown(): void {
    this.dropdownOpen.update((v) => !v);
  }

  protected closeDropdown(): void {
    this.dropdownOpen.set(false);
  }
}
