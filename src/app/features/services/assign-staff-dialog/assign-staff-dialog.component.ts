import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { StaffWithQueueDto } from '../../../api/models/staff-with-queue-dto';
import { SalonStaff } from '../../../api/models/salon-staff';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';

/**
 * "Assign this service to staff?" — the last step of saving a service.
 *
 * This dialog IS the submit: the form opens it instead of calling the API, and
 * confirming here is what fires the request. It always ends in a save, whether
 * the selection was changed or not — there is no cancel-out-of-saving path,
 * only a choice about who performs the service.
 *
 * Emits the chosen ids plus whether they actually differ from what was passed
 * in, because the service API treats an omitted staffIds as "leave assignments
 * untouched" — so an edit where nothing was touched must not send the field at
 * all rather than sending an identical list.
 */
@Component({
  selector: 'app-assign-staff-dialog',
  templateUrl: './assign-staff-dialog.component.html',
  imports: [SkeletonComponent],
})
export class AssignStaffDialogComponent {
  readonly open = input.required<boolean>();
  readonly staff = input.required<StaffWithQueueDto[]>();
  readonly loading = input(false);
  /** Currently assigned ids — pre-checked when the dialog opens. */
  readonly selectedIds = input<string[]>([]);
  /** Label for the confirm button, so create and edit can word it differently. */
  readonly confirmLabel = input('Save service');

  readonly confirmed = output<{ staffIds: string[]; changed: boolean }>();
  readonly closed = output<void>();

  private readonly _picked = signal<ReadonlySet<string>>(new Set());
  private _initial: ReadonlySet<string> = new Set();

  protected readonly pickedCount = computed(() => this._picked().size);

  constructor() {
    // Android back closes this rather than navigating underneath it.
    registerOverlayWhileOpen(this.open, () => this.closed.emit());

    // Seed from the current assignments each time it opens, so reopening after
    // a change starts from what is really assigned rather than a stale pick.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const seed = new Set(this.selectedIds());
        this._initial = seed;
        this._picked.set(new Set(seed));
      });
    });
  }

  protected isPicked(staffId: string): boolean {
    return this._picked().has(staffId);
  }

  protected toggle(staffId: string): void {
    this._picked.update((current) => {
      const next = new Set(current);
      next.has(staffId) ? next.delete(staffId) : next.add(staffId);
      return next;
    });
  }

  protected staffName(s: SalonStaff): string {
    return s.user ? `${s.user.firstName} ${s.user.lastName}` : s.email;
  }

  protected confirm(): void {
    const picked = this._picked();
    const changed =
      picked.size !== this._initial.size || [...picked].some((id) => !this._initial.has(id));
    this.confirmed.emit({ staffIds: [...picked], changed });
  }
}
