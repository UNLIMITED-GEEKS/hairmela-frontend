import { Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

// Category section on the salon slug page's Services tab (and anywhere else
// a titled, collapsible content block is needed). Height animates via the
// grid-template-rows 0fr/1fr technique — a real CSS transition, not a
// keyframe animation like this codebase's other animate.enter/leave cases
// (see styles.css's status-banner comment) — because the content here is a
// variable-length service list with no fixed height to keyframe against.
@Component({
  selector: 'app-accordion',
  templateUrl: './accordion.component.html',
  imports: [IconComponent],
})
export class AccordionComponent {
  readonly title = input.required<string>();
  readonly open = model(false);
  readonly compact = input(false);
  readonly count = input<number | null>(null);

  protected toggle(): void {
    this.open.update((v) => !v);
  }
}
