import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogState extends ConfirmDialogOptions {
  result$: Subject<boolean>;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly state = signal<DialogState | null>(null);

  open(options: ConfirmDialogOptions): Observable<boolean> {
    const result$ = new Subject<boolean>();
    this.state.set({ ...options, result$ });
    return result$.asObservable();
  }

  confirm(): void {
    this.state()?.result$.next(true);
    this.state()?.result$.complete();
    this.state.set(null);
  }

  cancel(): void {
    this.state()?.result$.next(false);
    this.state()?.result$.complete();
    this.state.set(null);
  }
}
