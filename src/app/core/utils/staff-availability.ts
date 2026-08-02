import { SalonPublicStaffDto } from '../../api/models/salon-public-staff-dto';

export interface StaffAvailability {
  readonly label: string;
  readonly badgeClasses: string;
  readonly joinable: boolean;
}

// Maps the backend's precedence-ordered openState (most-specific cause wins)
// to display text + joinability, shared by every surface that shows a
// barber's live availability (staff card, live-queue header) so the wording
// and the joinable/not-joinable verdict can never drift between them.
export function staffAvailability(staff: SalonPublicStaffDto): StaffAvailability {
  switch (staff.openState) {
    case 'OPEN':
      return {
        label: 'Available Now',
        badgeClasses: 'bg-success-light text-success border-success/20',
        joinable: true,
      };
    case 'QUEUE_PAUSED':
      return {
        label: 'On break',
        badgeClasses: 'bg-warning-light text-warning border-warning/30',
        joinable: false,
      };
    case 'QUEUE_CLOSED':
      return {
        label: 'Not accepting walk-ins',
        badgeClasses: 'bg-primary-light text-primary border-primary/20',
        joinable: false,
      };
    case 'CLOSED_TODAY':
      return {
        label: 'Closed today',
        badgeClasses: 'bg-primary-light text-primary border-primary/20',
        joinable: false,
      };
    case 'NOT_WORKING_TODAY':
      return {
        label: 'Off today',
        badgeClasses: 'bg-primary-light text-primary border-primary/20',
        joinable: false,
      };
    case 'CLOSED_HOURS':
      return {
        label: 'Outside working hours',
        badgeClasses: 'bg-primary-light text-primary border-primary/20',
        joinable: false,
      };
  }
}
