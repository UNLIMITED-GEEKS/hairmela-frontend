import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BillingService } from './billing.service';
import { ToastService } from '../../../core/toast/toast.service';

// Landing route for the (dummy) payment provider's redirect. Reads ?reference=,
// confirms it via verify(), then returns to billing. With a real provider this
// is where the user lands after paying; the verify step is unchanged.
@Component({
  selector: 'app-dummy-success',
  templateUrl: './dummy-success.component.html',
})
export class DummySuccessComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _billing = inject(BillingService);
  private readonly _toast = inject(ToastService);

  private get _orgId(): string {
    return this._route.snapshot.paramMap.get('orgId') ?? '';
  }

  ngOnInit(): void {
    const reference = this._route.snapshot.queryParamMap.get('reference');
    const orgId = this._orgId;

    if (!reference || !orgId) {
      this._router.navigate(['/org', orgId, 'billing']);
      return;
    }

    this._billing.verify(orgId, reference).subscribe({
      next: () => {
        this._toast.success('Payment confirmed — your plan is active.');
        this._router.navigate(['/org', orgId, 'billing']);
      },
      error: () => this._router.navigate(['/org', orgId, 'billing']),
    });
  }
}
