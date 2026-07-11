import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardService } from './dashboard.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { ActiveQueuesService } from '../queues/auth-queues/active-queues.service';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { PendingInvitesComponent } from './salon/pending-invites/pending-invites.component';
import { MyVisitsComponent } from './my-visits/my-visits.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { ToastService } from '../../core/toast/toast.service';
import { RoutePath } from '../../core/routing/route-paths';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  imports: [SkeletonComponent, PendingInvitesComponent, MyVisitsComponent, QrScannerComponent],
})
export class DashboardComponent implements OnInit {
  protected readonly _dashboardService = inject(DashboardService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _activeQueues = inject(ActiveQueuesService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);

  protected readonly loading = this._dashboardService.loading;
  protected readonly error = this._dashboardService.error;
  protected readonly user = this._currentUser.user;

  protected readonly activeEntries = this._activeQueues.entries;

  protected readonly showScanner = signal(false);

  ngOnInit(): void {
    this._dashboardService.load();
    this._activeQueues.load();
  }

  protected onQrScanned(text: string): void {
    this.showScanner.set(false);
    // Extract /s/:slug from the scanned URL
    try {
      const url = new URL(text);
      const match = url.pathname.match(/^\/s\/([^/]+)/);
      if (match) {
        this._router.navigate(RoutePath.visitSalon('', match[1]));
        return;
      }
    } catch {
      /* not a URL */
    }
    this._toast.error('Not a valid HairMela QR code');
  }
}
