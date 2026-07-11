import { Component, TemplateRef, contentChild, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Generic animated row-list: new items fade/slide in, removed items fade out
// and collapse their height, instead of popping in/out instantly. Uses
// Angular's native animate.enter/animate.leave (no @angular/animations needed) —
// see the row-enter/row-leave keyframes in styles.css.
//
// Usage:
// ```html
// <app-animated-list [items]="closures()" trackBy="id">
//   <ng-template let-closure>
//     <div class="row-content">{{ closure.date }}</div>
//   </ng-template>
// </app-animated-list>
// ```
@Component({
  selector: 'app-animated-list',
  templateUrl: './animated-list.component.html',
  imports: [NgTemplateOutlet],
})
export class AnimatedListComponent<T extends { id: string }> {
  readonly items = input.required<T[]>();
  readonly rowTemplate = contentChild.required(TemplateRef<{ $implicit: T }>);
}
