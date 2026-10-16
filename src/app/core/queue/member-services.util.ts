import { TimelineMemberServiceDto } from '../../api/models/timeline-member-service-dto';
import { QueueMemberService } from '../../api/models/queue-member-service';
import { isApiError } from '../errors/api-error.types';
import { ErrorCodes } from '../errors/error-codes';

export type AnyMemberService = TimelineMemberServiceDto | QueueMemberService;

export function calculateTotalMemberPrice(services?: Array<AnyMemberService> | null): number {
  if (!services || services.length === 0) return 0;
  return services.reduce((sum, s) => {
    const val = Number(s.priceSnapshot);
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);
}

export function getCustomerRemainingAdditions(services?: Array<AnyMemberService> | null): number {
  if (!services || services.length === 0) return 2;
  const count = services.filter((s) => s.source === 'CUSTOMER_ADDITION').length;
  return Math.max(0, 2 - count);
}

export function getMemberServiceIds(services?: Array<AnyMemberService> | null): string[] {
  if (!services) return [];
  return services.map((s) => s.serviceId).filter((id): id is string => !!id);
}

export function getMemberServiceErrorMessage(err: unknown): string {
  const body = (err as { error?: unknown })?.error;
  if (isApiError(body)) {
    switch (body.code) {
      case ErrorCodes.MEMBER_SERVICE_DUPLICATE:
        return 'This service is already selected. Please ask your stylist if you want to repeat it.';
      case ErrorCodes.MEMBER_SERVICE_LIMIT_REACHED:
        return 'You can add at most 2 extra services per person. Please ask your stylist to add more.';
      case ErrorCodes.MEMBER_SERVICE_APPOINTMENT_CONFLICT:
        return 'Adding these services would conflict with an upcoming appointment.';
      case ErrorCodes.SERVICE_NOT_FOUND:
        return 'One or more services are not available.';
      case ErrorCodes.ENTRY_FORBIDDEN:
        return 'You do not have permission to modify this entry.';
      case ErrorCodes.SALON_FROZEN:
        return 'This salon is temporarily unavailable.';
      default:
        return typeof body.message === 'string' ? body.message : 'Failed to update services.';
    }
  }
  return 'Failed to update services.';
}

