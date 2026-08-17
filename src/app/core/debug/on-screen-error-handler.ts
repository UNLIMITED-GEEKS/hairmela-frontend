import { ErrorHandler, Injectable } from '@angular/core';

// Global error handler. Before this existed the app had NO ErrorHandler at
// all, so every uncaught exception went straight to a console — invisible on a
// phone, which is a large part of why the iPhone 6s/7 navigation bug took so
// long to pin down.
//
// FIXME: this only logs to the console right now. It briefly showed errors as
// on-screen toasts while diagnosing that bug, and doing so immediately
// surfaced a SECOND, still-unidentified problem: an uncaught error fires
// during LOGIN. It was silent before, and it is silent again now — but it is
// still happening.
//
// Two follow-ups worth doing:
//   1. Identify the login-time error. It reproduces reliably: re-add a
//      `toast.error(...)` here, or attach a desktop debugger, and sign in.
//   2. Report errors somewhere durable (Sentry or equivalent) instead of only
//      console.error. Without that, errors on real user devices stay invisible
//      — exactly the hole that made the iOS bug take several rounds to find.
@Injectable()
export class OnScreenErrorHandler implements ErrorHandler {
  // No window-level listeners here: app.config.ts already calls
  // provideBrowserGlobalErrorListeners(), which routes window 'error' and
  // 'unhandledrejection' into this same handleError.
  handleError(error: unknown): void {
    console.error(error);
  }
}
