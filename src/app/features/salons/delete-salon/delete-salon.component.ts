import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { salonsControllerSoftDelete } from '../../../api/fn/salons/salons-controller-soft-delete';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-delete-salon',
  templateUrl: './delete-salon.component.html',
})
export class DeleteSalonComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);

  protected readonly salonName = signal('');
  protected readonly deleting = signal(false);

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => this.salonName.set(res.body.name),
      error: () => this._router.navigate(['/dashboard']),
    });
  }

  protected confirmDelete(): void {
    this._confirmDialog.open({
      title: `Delete "${this.salonName()}"?`,
      message: 'All queues will be closed, entries cancelled, and customers notified. This cannot be undone.',
      confirmLabel: 'Delete salon',
      danger: true,
    }).pipe(
      filter((confirmed) => confirmed),
      switchMap(() => {
        this.deleting.set(true);
        return salonsControllerSoftDelete(this._http, this._apiConfig.rootUrl, { salonId: this._salonId });
      }),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.deleting.set(false);
        this._toast.success('Salon deleted');
        this._router.navigate(['/dashboard']);
      },
      error: () => this.deleting.set(false),
    });
  }
}
