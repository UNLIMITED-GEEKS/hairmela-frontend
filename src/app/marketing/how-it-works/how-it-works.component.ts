import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TabsComponent, TabItem } from '../../shared/components/tabs/tabs.component';
import { YoutubeEmbedComponent } from '../../shared/components/youtube-embed/youtube-embed.component';
import { ToastService } from '../../core/toast/toast.service';
import { HowItWorksTab, RoutePath, RouteQueryParam } from '../../core/routing/route-paths';

const TABS: TabItem[] = [
  { id: HowItWorksTab.CUSTOMERS, label: 'For customers' },
  { id: HowItWorksTab.OWNERS, label: 'For salon owners' },
];

// Public "How it works" page — two audiences, one URL, split by
// ?tab=customers|owners so either half is directly linkable/shareable (the
// copy-link button below copies exactly that URL). Customers is the default
// when the param is absent or holds anything else.
@Component({
  selector: 'app-how-it-works',
  templateUrl: './how-it-works.component.html',
  imports: [RouterLink, TabsComponent, YoutubeEmbedComponent],
})
export class HowItWorksComponent {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _toast = inject(ToastService);

  protected readonly tabs = TABS;
  protected readonly registerLink = RoutePath.register();

  // Live query-param reads (not a snapshot) — the tab must update when a tab
  // button's own routerLink-driven navigation changes the URL, same reactive
  // pattern used by salon-shell/live-queue for the equivalent path-param case.
  private readonly _queryParamMap = toSignal(this._route.queryParamMap, { requireSync: true });

  protected readonly activeTab = computed<HowItWorksTab>(() => {
    const raw = this._queryParamMap().get(RouteQueryParam.TAB);
    return raw === HowItWorksTab.OWNERS ? HowItWorksTab.OWNERS : HowItWorksTab.CUSTOMERS;
  });

  protected readonly isCustomers = computed(() => this.activeTab() === HowItWorksTab.CUSTOMERS);

  protected setTab(tab: string): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { [RouteQueryParam.TAB]: tab },
      queryParamsHandling: 'merge',
    });
  }

  protected copyLink(): void {
    const url = `${window.location.origin}${RoutePath.howItWorks().join('/')}?${RouteQueryParam.TAB}=${this.activeTab()}`;
    navigator.clipboard.writeText(url).then(
      () => this._toast.success('Link copied.'),
      () => this._toast.error('Could not copy link.'),
    );
  }
}
