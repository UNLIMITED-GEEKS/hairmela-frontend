import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ToastService } from '../toast/toast.service';

// TEMPORARY DIAGNOSTIC — REMOVE ONCE THE iOS 15 NAVIGATION BUG IS FOUND.
//
// The app has no global ErrorHandler, so every uncaught exception has been
// going straight to a console nobody can read on a phone. That is why "nothing
// happens" on iPhone 6s/7 has been impossible to diagnose remotely: the error
// almost certainly exists, it just has nowhere to surface.
//
// This puts the message on screen so an affected user can screenshot it.
// Deliberately shows the raw error text rather than anything friendly — the
// point is diagnostic detail, not polish.
@Injectable()
export class OnScreenErrorHandler implements ErrorHandler {
  private readonly _toast = inject(ToastService);

  // No window-level listeners here: app.config.ts already calls
  // provideBrowserGlobalErrorListeners(), which routes window 'error' and
  // 'unhandledrejection' into this same handleError — adding our own would
  // just double every toast.

  handleError(error: unknown): void {
    // Keep the console path intact for desktop debugging.
    console.error(error);

    const e = error as { message?: string; name?: string; stack?: string };
    const name = e?.name ?? 'Errorss';
    const message = e?.message ?? String(error);

    // First stack frame usually names the file, which is the most useful part
    // on a device where the full stack cannot be inspected.
    const frame = e?.stack?.split('\n')[1]?.trim() ?? '';

    this._toast.error(`JS ${name}: ${message} ${frame}`.slice(0, 200));
  }
}
