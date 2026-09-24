import { Injectable, signal } from '@angular/core';

export interface StaffAppointmentRequest {
  readonly salonId: string;
  readonly queueId: string;
  readonly staffId: string;
}

@Injectable({ providedIn: 'root' })
export class StaffAppointmentModalService {
  readonly request = signal<StaffAppointmentRequest | null>(null);

  open(request: StaffAppointmentRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }
}
