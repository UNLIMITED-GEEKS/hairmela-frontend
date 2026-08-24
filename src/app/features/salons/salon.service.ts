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
import { salonsControllerBranch } from '../../api/fn/salons/salons-controller-branch';
import { salonsControllerUnbranch } from '../../api/fn/salons/salons-controller-unbranch';
import { CreateSalonResponseDto } from '../../api/models/create-salon-response-dto';
import { Salon } from '../../api/models/salon';
import { ToastService } from '../../core/toast/toast.service';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { isApiError } from '../../core/errors/api-error.types';
import { ErrorCodes, ErrorCode } from '../../core/errors/error-codes';

@Injectable({ providedIn: 'root' })
export class SalonService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _salonContext = inject(SalonContextService);

  create(
    body: CreateSalonDto,
    destroyRef: DestroyRef,
    onSuccess?: (result: CreateSalonResponseDto) => void,
    onLimitReached?: () => void,
  ): void {
    userSalonsControllerCreate(this._http, this._apiConfig.rootUrl, { body })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (res) => {
          onSuccess?.(res.body);
          this._toast.success('Salon created');
        },
        error: (err: unknown) => {
          if (isApiError(err) && err.code === ErrorCodes.SALON_LIMIT_REACHED) {
            this._toast.error('Plan limit reached — upgrade to create more salons');
            onLimitReached?.();
          }
        },
      });
  }

  // Attaches salonId as a branch of parentSalonId. Shared by the create-branch
  // flow (create-salon.component.ts, called right after the salon itself is
  // created) and Settings' "mark as branch" section (an existing salon
  // choosing a parent). onError gets the raw error code so each caller can
  // show its own targeted message for ALREADY_A_BRANCH/BRANCH_DIFFERENT_ORG/
  // INVALID_BRANCH — see error-codes.ts.
  // copyServices duplicates the parent's active services into this branch —
  // additive (existing kept, duplicate names skipped) and one-shot, never
  // re-synced. Only the create-branch flow offers it; Settings' "mark as
  // branch" omits it, so that call is unchanged.
  attachBranch(
    salonId: string,
    parentSalonId: string,
    destroyRef: DestroyRef,
    onSuccess?: (salon: Salon) => void,
    onError?: (code: ErrorCode | null) => void,
    copyServices?: boolean,
  ): void {
    salonsControllerBranch(this._http, this._apiConfig.rootUrl, {
      salonId,
      body: { parentSalonId, copyServices },
    })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (res) => {
          this._toast.success('Branch linked');
          onSuccess?.(res.body);
        },
        error: (err: unknown) => {
          const body = (err as { error?: unknown })?.error;
          onError?.(isApiError(body) ? body.code : null);
        },
      });
  }

  // Detaches a branch back to standalone — requires a fresh name since rename
  // is blocked while branched (see salon-settings.component.ts's isBranch lock).
  detachBranch(
    salonId: string,
    newName: string,
    destroyRef: DestroyRef,
    onSuccess?: (salon: Salon) => void,
    onError?: () => void,
  ): void {
    salonsControllerUnbranch(this._http, this._apiConfig.rootUrl, {
      salonId,
      body: { name: newName },
    })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (res) => {
          this._toast.success('Branch removed — salon is now standalone');
          onSuccess?.(res.body);
        },
        // No local message here — the interceptor's generic body.message
        // toast already covers this (e.g. SALON_SLUG_TAKEN on the new name).
        // onError is purely so callers can clear their own pending/loading
        // state, which previously had nowhere to hook a failure.
        error: () => onError?.(),
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
          // No-ops unless this was the persisted "last visited" salon — a
          // deleted salon must never be what the next login redirects into.
          this._salonContext.clearIfMatches(salonId);
          onSuccess?.();
        },
      });
  }
}
