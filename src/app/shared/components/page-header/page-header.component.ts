import { Component, ElementRef, HostListener, inject, input, signal, computed } from '@angular/core';
import { BackButtonComponent } from '../back-button/back-button.component';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { ToastService } from '../../../core/toast/toast.service';
import { environment } from '../../../../environments/environment';
import { AppHeaderService } from '../../../core/routing/app-header.service';
import { RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RoutePath } from '../../../core/routing/route-paths';
import { ChatService } from '../../../core/chat/chat.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';

/**
 * Desktop/public page header. Its title and back destination come from the
 * active route, shared with the auth/guest shell's mobile header. Project
 * trailing content (e.g. an action button) via the `actions` slot.
 *
 * Usage:
 *   <app-page-header>
 *     <a slot="actions" ...>Add Staff</a>
 *   </app-page-header>
 */
@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.component.html',
  imports: [BackButtonComponent, RouterLink],
})
export class PageHeaderComponent {
  private readonly _element = inject(ElementRef<HTMLElement>);
  private readonly _platform = inject(AppPlatformService);
  private readonly _toast = inject(ToastService);
  protected readonly header = inject(AppHeaderService);
  protected readonly currentUser = inject(CurrentUserStore);
  protected readonly chatService = inject(ChatService);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _salonsStore = inject(SalonsStore);

  protected readonly profileLink = RoutePath.account();
  protected readonly chatLink = computed(() => RoutePath.chat());
  protected readonly managedSalon = computed(() => {
    const sId = this._salonContext.activeSalonId();
    if (sId) return null;
    return this._salonsStore.salons().find((s) => s.role === 'OWNER' || s.role === 'ADMIN' || s.role === 'STAFF') ?? null;
  });
  protected readonly favoritesLink = RoutePath.favorites();
  protected readonly notificationsLink = RoutePath.notifications();
  protected readonly settingsLink = RoutePath.accountSettings();
  protected readonly signInLink = RoutePath.login();

  readonly backVariant = input<'plain' | 'glass'>('plain');
  protected readonly menuOpen = signal(false);

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this._element.nativeElement.contains(event.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.menuOpen.set(false);
  }

  protected async shareLink(): Promise<void> {
    this.menuOpen.set(false);
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
}
