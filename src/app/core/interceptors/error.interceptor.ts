import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { isApiError } from '../errors/api-error.types';
import { ErrorCodes } from '../errors/error-codes';
import { ToastService } from '../toast/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((err) => {
      if (!(err instanceof HttpErrorResponse)) {
        toast.error('You appear to be offline. Please check your connection.');
        return throwError(() => err);
      }

      let body: unknown = err.error;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* not JSON */ }
      }

      if (!isApiError(body)) {
        toast.error('You appear to be offline. Please check your connection.');
        return throwError(() => err);
      }

      // Handled by the refresh interceptor — don't double-toast.
      // TOKEN_MISSING included: it's usually a request that raced session
      // restore and is about to be retried transparently, so surfacing an
      // error toast for it would flash a failure the user never had.
      if (
        body.code === ErrorCodes.TOKEN_EXPIRED ||
        body.code === ErrorCodes.TOKEN_INVALID ||
        body.code === ErrorCodes.TOKEN_MISSING
      ) {
        return throwError(() => err);
      }

      // Global handlers — features can still catchError for local handling
      switch (body.code) {
        case ErrorCodes.TIER_REQUIRED:
          toast.error('This feature requires a higher plan.');
          break;

        case ErrorCodes.SALON_FROZEN:
          toast.error('This salon is over the plan limit. Upgrade to reactivate.');
          break;

        case ErrorCodes.STAFF_LIMIT_REACHED:
          toast.error('Staff limit reached for this plan. Upgrade to add more.');
          break;

        case ErrorCodes.CANNOT_REMOVE_OWNER:
          toast.error('Cannot remove the owner. Use Transfer Ownership instead.');
          break;

        case ErrorCodes.SALON_HAS_BRANCHES:
          toast.error('Detach all branches before deleting this salon.');
          break;

        case ErrorCodes.QUEUE_NOT_OPEN:
        case ErrorCodes.QUEUE_ALREADY_CLOSED:
          toast.error('The queue is not available right now.');
          break;

        case null:
        default:
          if (err.status >= 500) {
            const ref = body.requestId ? ` — ref ${body.requestId}` : '';
            toast.error(`Something went wrong${ref}. Please try again.`);
          } else if (body.message) {
            toast.error(body.message);
          }
          break;
      }

      return throwError(() => err);
    }),
  );
};
