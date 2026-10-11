import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RoutePath } from '../../../core/routing/route-paths';
import { ThemeService } from '../../../core/theme/theme.service';
import { AppleAccountComponent } from '../apple-account/apple-account.component';
import { GoogleAccountComponent } from '../google-account/google-account.component';
import { NotificationsToggleComponent } from '../notifications-toggle/notifications-toggle.component';
import { QueueSoundToggleComponent } from '../queue-sound-toggle/queue-sound-toggle.component';
import { ResetPasswordComponent } from '../reset-password/reset-password.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { VerifyEmailBannerComponent } from '../../../shared/components/verify-email-banner/verify-email-banner.component';

@Component({
  selector: 'app-account-settings',
  templateUrl: './account-settings.component.html',
  imports: [
    DatePipe,
    RouterLink,
    PageHeaderComponent,
    VerifyEmailBannerComponent,
    ResetPasswordComponent,
    GoogleAccountComponent,
    AppleAccountComponent,
    NotificationsToggleComponent,
    QueueSoundToggleComponent,
  ],
})
export class AccountSettingsComponent {
  protected readonly _currentUser = inject(CurrentUserStore);
  protected readonly hasPassword = signal<boolean | null>(null);
  protected readonly platform = inject(AppPlatformService);
  protected readonly theme = inject(ThemeService);
  protected readonly accountLink = RoutePath.account();
  protected readonly contactLink = RoutePath.contact();
  protected readonly deleteAccountLink = RoutePath.deleteAccount();
}
