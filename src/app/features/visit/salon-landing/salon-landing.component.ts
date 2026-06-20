import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';

@Component({
  selector: 'app-salon-landing',
  templateUrl: './salon-landing.component.html',
})
export class SalonLandingComponent {
  protected readonly visit = inject(SalonVisitService);
  private readonly _route = inject(ActivatedRoute);

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  protected selectBarber(staff: SalonPublicStaffDto): void {
    this.visit.selectBarber(staff, this._slug);
  }
}
