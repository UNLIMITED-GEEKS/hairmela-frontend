import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RenameDialogService } from './rename-dialog.service';

@Component({
  selector: 'app-rename-dialog',
  templateUrl: './rename-dialog.component.html',
  imports: [FormsModule],
})
export class RenameDialogComponent {
  protected readonly dialog = inject(RenameDialogService);
  // Cleared on both confirm() and cancel() below, so a previous dialog's
  // leftover text never bleeds into the next open() — nothing pre-fills it.
  protected readonly value = signal('');

  protected isValid(minLength: number | undefined): boolean {
    return this.value().trim().length >= (minLength ?? 1);
  }

  protected confirm(minLength: number | undefined): void {
    if (!this.isValid(minLength)) return;
    this.dialog.confirm(this.value().trim());
    this.value.set('');
  }

  protected cancel(): void {
    this.dialog.cancel();
    this.value.set('');
  }
}
