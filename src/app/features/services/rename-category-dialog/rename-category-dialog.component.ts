import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-rename-category-dialog',
  templateUrl: './rename-category-dialog.component.html',
  imports: [FormsModule, InlineSpinnerComponent],
})
export class RenameCategoryDialogComponent {
  readonly open = input.required<boolean>();
  readonly currentName = input.required<string>();
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly renamed = output<string>();
  readonly closed = output<void>();

  protected readonly name = signal('');

  constructor() {
    registerOverlayWhileOpen(this.open, () => this.close());
    effect(() => {
      if (this.open()) {
        const currentName = this.currentName();
        untracked(() => this.name.set(currentName));
      }
    });
  }

  protected close(): void {
    if (!this.saving()) this.closed.emit();
  }

  protected submit(): void {
    const name = this.name().trim();
    if (
      this.saving() ||
      name.length < 2 ||
      name.length > 100 ||
      name === this.currentName().trim()
    ) {
      return;
    }
    this.renamed.emit(name);
  }
}
