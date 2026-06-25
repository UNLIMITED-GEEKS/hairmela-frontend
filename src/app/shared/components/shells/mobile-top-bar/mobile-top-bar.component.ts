import { Component, input, output, computed, signal, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MySalonDto } from '../../../../api/models/my-salon-dto';

@Component({
  selector: 'app-mobile-top-bar',
  templateUrl: './mobile-top-bar.component.html',
  imports: [RouterLink],
})
export class MobileTopBarComponent {
  private readonly _router = inject(Router);

  readonly sheetOpen = input(false);
  readonly sheetToggle = output<void>();
  readonly salons = input<MySalonDto[]>([]);
  readonly activeSalonId = input<string | null>(null);

  protected readonly dropdownOpen = signal(false);

  protected readonly activeSalon = computed(
    () => this.salons().find((s) => s.salon.id === this.activeSalonId()) ?? this.salons()[0] ?? null,
  );

  protected toggleDropdown(): void {
    this.dropdownOpen.update((v) => !v);
  }

  protected closeDropdown(): void {
    this.dropdownOpen.set(false);
  }

  protected switchSalon(salonId: string): void {
    this.dropdownOpen.set(false);
    const currentUrl = this._router.url;
    if (currentUrl.startsWith('/dashboard')) {
      this._router.navigate(['/dashboard'], { queryParams: { salon: salonId } });
    } else {
      const salonMatch = currentUrl.match(/\/salons\/[^/?]+(.*)/);
      const subPath = salonMatch ? salonMatch[1] : '';
      this._router.navigateByUrl(`/salons/${salonId}${subPath}`);
    }
  }
}
