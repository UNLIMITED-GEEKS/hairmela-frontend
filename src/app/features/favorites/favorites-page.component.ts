import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FavoritesService } from '../../core/favorites/favorites.service';
import { SalonCardComponent } from '../../shared/components/salon-card/salon-card.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TabsComponent, TabItem } from '../../shared/components/tabs/tabs.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { MediaUrlPipe } from '../../shared/pipes/media-url.pipe';
import { BarberFavoriteItemDto } from '../../api/models/barber-favorite-item-dto';
import { RoutePath } from '../../core/routing/route-paths';
import { PersistentStore } from '../../core/storage/persistent-store';

const FAVORITES_TAB_KEY = 'hm_favorites_tab';
type FavoritesTab = 'salons' | 'staff';

// Favourites page — tabs for Salons and Staff. Fed by FavoritesService's caches,
// which toggle() keeps in sync in place from anywhere else in the app.
@Component({
  selector: 'app-favorites-page',
  templateUrl: './favorites-page.component.html',
  imports: [
    RouterLink,
    SalonCardComponent,
    PaginationComponent,
    SkeletonComponent,
    PageHeaderComponent,
    TabsComponent,
    IconComponent,
    MediaUrlPipe,
  ],
})
export class FavoritesPageComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _store = inject(PersistentStore);
  protected readonly favorites = inject(FavoritesService);

  protected readonly activeTab = signal<FavoritesTab>(this._getInitialTab());
  protected readonly tabs: TabItem[] = [
    { id: 'salons', label: 'Salons & Spas' },
    { id: 'staff', label: 'Staff & Stylists' },
  ];

  protected readonly placeholderImage = '/salon-placeholder.jpg';
  protected readonly searchLink = RoutePath.search();

  ngOnInit(): void {
    this.favorites.loadPage(1);
    this.favorites.loadStaffPage(1);

    const queryTab = this._route.snapshot.queryParamMap.get('tab');
    if (queryTab === 'staff' || queryTab === 'salons') {
      this._store.setRaw(FAVORITES_TAB_KEY, queryTab);
    }
  }

  protected setTab(tabId: string): void {
    const tab: FavoritesTab = tabId === 'staff' ? 'staff' : 'salons';
    this.activeTab.set(tab);
    this._store.setRaw(FAVORITES_TAB_KEY, tab);
  }

  private _getInitialTab(): FavoritesTab {
    const queryTab = this._route.snapshot.queryParamMap.get('tab');
    if (queryTab === 'staff' || queryTab === 'salons') {
      return queryTab;
    }
    const saved = this._store.getRaw(FAVORITES_TAB_KEY);
    return saved === 'staff' ? 'staff' : 'salons';
  }

  protected goToSalonPage(page: number): void {
    this.favorites.loadPage(page);
  }

  protected goToStaffPage(page: number): void {
    this.favorites.loadStaffPage(page);
  }

  protected toggleStaffFavorite(event: Event, staff: BarberFavoriteItemDto): void {
    event.preventDefault();
    event.stopPropagation();
    this.favorites.toggleStaff(staff);
  }

  protected staffLink(staff: BarberFavoriteItemDto): string[] {
    return staff.queueId
      ? RoutePath.visitQueue('', staff.salonSlug, staff.queueId)
      : RoutePath.visitSalon('', staff.salonSlug);
  }
}
