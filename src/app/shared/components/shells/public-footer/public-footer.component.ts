import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// Public marketing footer — column links, legal, and the HairMela wordmark.
// Rendered once in the public shell so every public page shares it. The year is
// computed in the class (no new Date() in templates, per project standards).
@Component({
  selector: 'app-public-footer',
  templateUrl: './public-footer.component.html',
  imports: [RouterLink],
})
export class PublicFooterComponent {
  protected readonly year = 2026;
}
