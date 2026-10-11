import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TabsComponent, TabItem } from '../../shared/components/tabs/tabs.component';
import { YoutubeEmbedComponent } from '../../shared/components/youtube-embed/youtube-embed.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { ToastService } from '../../core/toast/toast.service';
import { HowItWorksTab, RoutePath, RouteQueryParam } from '../../core/routing/route-paths';
import { environment } from '../../../environments/environment';
import { AppPlatformService } from '../../core/native/app-platform.service';

// shortLabel keeps all three pills on one line on a phone — the full labels
// together are wider than a mobile viewport, and TabsComponent's sliding
// indicator rules out wrapping to a second row.
const TABS: TabItem[] = [
  { id: HowItWorksTab.CUSTOMERS, label: 'For customers', shortLabel: 'Customers' },
  { id: HowItWorksTab.OWNERS, label: 'For salon owners', shortLabel: 'Salon Owners' },
  { id: HowItWorksTab.STAFF, label: 'For salon staff', shortLabel: 'Salon Staffs' },
];

const TAB_IDS: readonly string[] = TABS.map((t) => t.id);

// Public "How it works" page — three audiences, one URL, split by
// ?tab=customers|owners|staff so any one of them is directly linkable/
// shareable (the copy-link button below copies exactly that URL). Customers
// is the default when the param is absent or holds anything else.
@Component({
  selector: 'app-how-it-works',
  templateUrl: './how-it-works.component.html',
  imports: [RouterLink, TabsComponent, YoutubeEmbedComponent, PageHeaderComponent],
})
export class HowItWorksComponent {
  protected readonly platform = inject(AppPlatformService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _toast = inject(ToastService);

  protected readonly tabs = TABS;
  protected readonly registerLink = RoutePath.register();

  // Live query-param reads (not a snapshot) — the tab must update when a tab
  // button's own routerLink-driven navigation changes the URL, same reactive
  // pattern used by salon-shell/live-queue for the equivalent path-param case.
  private readonly _queryParamMap = toSignal(this._route.queryParamMap, { requireSync: true });

  // Any value that isn't one of the three known tabs falls back to customers,
  // so a hand-edited/stale ?tab= can never render an empty page.
  protected readonly activeTab = computed<HowItWorksTab>(() => {
    const raw = this._queryParamMap().get(RouteQueryParam.TAB) ?? '';
    return TAB_IDS.includes(raw) ? (raw as HowItWorksTab) : HowItWorksTab.CUSTOMERS;
  });

  protected readonly isCustomers = computed(() => this.activeTab() === HowItWorksTab.CUSTOMERS);
  protected readonly isOwners = computed(() => this.activeTab() === HowItWorksTab.OWNERS);
  protected readonly isStaff = computed(() => this.activeTab() === HowItWorksTab.STAFF);

  protected setTab(tab: string): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { [RouteQueryParam.TAB]: tab },
      queryParamsHandling: 'merge',
    });
  }

  // Copies the URL of the CURRENT tab — landing on it shows that tab's video,
  // which is what the "copy link to this video" button promises.
  protected copyLink(): void {
    // environment.appBaseUrl, NOT window.location.origin: in the Capacitor
    // WebView the page is served from https://localhost, so origin produced a
    // link that only works on the device that copied it. Same reason every
    // other copy-link in the app (salon share, live queue, salon overview)
    // builds from appBaseUrl.
    const url = `${environment.appBaseUrl}${RoutePath.howItWorks().join('/')}?${RouteQueryParam.TAB}=${this.activeTab()}`;
    navigator.clipboard.writeText(url).then(
      () => this._toast.success('Link to this video copied.'),
      () => this._toast.error('Could not copy link.'),
    );
  }
}
