import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _counter = 0;
  readonly toasts = signal<Toast[]>([]);

  success(message: string): void {
    this._add(message, 'success');
  }

  error(message: string): void {
    this._add(message, 'error');
  }

  info(message: string): void {
    this._add(message, 'info');
  }

  dismiss(id: number): void {
    this.toasts.update((all) => all.filter((t) => t.id !== id));
  }

  private _add(message: string, type: ToastType): void {
    const id = ++this._counter;
    this.toasts.update((all) => [...all, { id, message, type }]);
    setTimeout(() => this.dismiss(id), 4000);
  }
}
