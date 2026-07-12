import { Component, input, output } from '@angular/core';
import { CategoryResponseDto } from '../../../api/models/category-response-dto';

// Reusable "All" + category chip row — shared by the dashboard and the
// marketing landing page listing so both stay visually identical. Dumb/
// presentational: the caller owns the selected category and the fetch.
@Component({
  selector: 'app-category-pills',
  templateUrl: './category-pills.component.html',
})
export class CategoryPillsComponent {
  readonly categories = input.required<CategoryResponseDto[]>();
  readonly selected = input<string>('');

  readonly select = output<string>();
}
