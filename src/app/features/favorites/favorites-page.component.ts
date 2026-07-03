import { Component, OnInit, inject } from '@angular/core';
import { Location } from '@angular/common';
import { FavoritesService } from '../../core/favorites/favorites.service';
import { SalonCardComponent } from '../../shared/components/salon-card/salon-card.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';

// Favourites page — same card + pagination as the homepage listing, fed by
// FavoritesService's own cache (GET /users/me/favorites), which toggle()
// keeps in sync in place from anywhere else in the app.
@Component({
  selector: 'app-favorites-page',
  templateUrl: './favorites-page.component.html',
  imports: [SalonCardComponent, PaginationComponent, SkeletonComponent],
})
export class FavoritesPageComponent implements OnInit {
  protected readonly _location = inject(Location);
  protected readonly favorites = inject(FavoritesService);

  ngOnInit(): void {
    this.favorites.loadPage(1);
  }

  protected goToPage(page: number): void {
    this.favorites.loadPage(page);
  }
}
