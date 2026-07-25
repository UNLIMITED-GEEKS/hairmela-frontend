import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface RenameDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  minLength?: number;
}

interface DialogState extends RenameDialogOptions {
  result$: Subject<string | null>;
}

// Same signal-driven, one-dialog-at-a-time shape as ConfirmDialogService, but
// resolves with a typed value (the new name) instead of a plain boolean —
// for flows that need the user to type something to confirm (currently just
// Settings' "unbranch" affordance, which requires a fresh name per the
// backend's DELETE /salons/:salonId/branch contract).
@Injectable({ providedIn: 'root' })
export class RenameDialogService {
  readonly state = signal<DialogState | null>(null);

  open(options: RenameDialogOptions): Observable<string | null> {
    const result$ = new Subject<string | null>();
    this.state.set({ ...options, result$ });
    return result$.asObservable();
  }

  confirm(value: string): void {
    this.state()?.result$.next(value);
    this.state()?.result$.complete();
    this.state.set(null);
  }

  cancel(): void {
    this.state()?.result$.next(null);
    this.state()?.result$.complete();
    this.state.set(null);
  }
}
