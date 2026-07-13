import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { filter, retry, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { CreateSalonDto } from '../../api/models/create-salon-dto';
import { userSalonsControllerCreate } from '../../api/fn/salons/user-salons-controller-create';
import { salonsControllerFindOne } from '../../api/fn/salons/salons-controller-find-one';
import { salonsControllerSoftDelete } from '../../api/fn/salons/salons-controller-soft-delete';
import { Salon } from '../../api/models/salon';
import { ToastService } from '../../core/toast/toast.service';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { isApiError } from '../../core/errors/api-error.types';
import { ErrorCodes } from '../../core/errors/error-codes';

@Injectable({ providedIn: 'root' })
export class SalonService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  create(
    body: CreateSalonDto,
    destroyRef: DestroyRef,
    onSuccess?: (salon: Salon) => void,
    onLimitReached?: () => void,
  ): void {
    userSalonsControllerCreate(this._http, this._apiConfig.rootUrl, { body })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (res) => {
          this._toast.success('Salon created');
          onSuccess?.(res.body);
        },
        error: (err: unknown) => {
          if (isApiError(err) && err.code === ErrorCodes.SALON_LIMIT_REACHED) {
            this._toast.error('Plan limit reached — upgrade to create more salons');
            onLimitReached?.();
          }
        },
      });
  }

  getSalonName(salonId: string, destroyRef: DestroyRef, onName: (name: string) => void, onError: () => void): void {
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(retry(1), takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (res) => onName(res.body.name),
        error: () => onError(),
      });
  }

  delete(
    salonId: string,
    salonName: string,
    destroyRef: DestroyRef,
    onSuccess?: () => void,
    onConfirmed?: () => void,
  ): void {
    this._confirmDialog
      .open({
        title: `Delete "${salonName}"?`,
        message: 'All queues will be closed, entries cancelled, and customers notified. This cannot be undone.',
        confirmLabel: 'Delete salon',
        danger: true,
      })
      .pipe(
        filter((confirmed) => confirmed),
        switchMap(() => {
          // Only flip to "deleting" once the user has actually confirmed —
          // not on the initial click, which merely opens this dialog and
          // would otherwise leave the caller's loading state stuck on if the
          // user cancels instead of confirming.
          onConfirmed?.();
          return salonsControllerSoftDelete(this._http, this._apiConfig.rootUrl, { salonId });
        }),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe({
        next: () => {
          this._toast.success('Salon deleted');
          onSuccess?.();
        },
      });
  }
}
