import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategoryResponseDto } from '../../../api/models/category-response-dto';
import { SalonCategoryResponseDto } from '../../../api/models/salon-category-response-dto';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-delete-category-dialog',
  templateUrl: './delete-category-dialog.component.html',
  imports: [FormsModule, InlineSpinnerComponent],
})
export class DeleteCategoryDialogComponent {
  readonly open = input.required<boolean>();
  readonly categoryName = input.required<string>();
  readonly defaultReplacements = input.required<CategoryResponseDto[]>();
  readonly customReplacements = input.required<SalonCategoryResponseDto[]>();
  readonly deleting = input(false);
  readonly error = input<string | null>(null);
  readonly confirmed = output<string | undefined>();
  readonly closed = output<void>();

  protected readonly moveServices = signal(true);
  protected readonly replacementCategoryId = signal('');

  constructor() {
    registerOverlayWhileOpen(this.open, () => this.close());
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.moveServices.set(true);
          this.replacementCategoryId.set('');
        });
      }
    });
  }

  protected setMoveServices(enabled: boolean): void {
    this.moveServices.set(enabled);
    if (!enabled) this.replacementCategoryId.set('');
  }

  protected close(): void {
    if (!this.deleting()) this.closed.emit();
  }

  protected submit(): void {
    if (this.deleting() || (this.moveServices() && !this.replacementCategoryId())) return;
    this.confirmed.emit(this.moveServices() ? this.replacementCategoryId() : undefined);
  }
}
