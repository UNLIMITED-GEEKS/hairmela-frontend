import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SalonService } from '../salon.service';

@Component({
  selector: 'app-delete-salon',
  templateUrl: './delete-salon.component.html',
})
export class DeleteSalonComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _salonService = inject(SalonService);

  protected readonly salonName = signal('');
  protected readonly deleting = signal(false);

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    this._salonService.getSalonName(
      this._salonId,
      this._destroyRef,
      (name) => this.salonName.set(name),
      () => this._router.navigate(['/dashboard']),
    );
  }

  protected confirmDelete(): void {
    this.deleting.set(true);
    this._salonService.delete(
      this._salonId,
      this.salonName(),
      this._destroyRef,
      () => {
        this.deleting.set(false);
        this._router.navigate(['/dashboard']);
      },
    );
  }
}

