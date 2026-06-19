import { inject } from '@angular/core';
import { ResolveFn, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { MembershipStore } from '../salon-context/membership.store';
import { Membership } from '../salon-context/membership.types';

export const membershipResolver: ResolveFn<Membership | null> = (route) => {
  const membershipStore = inject(MembershipStore);
  const router = inject(Router);

  const salonId = route.paramMap.get('salonId') ?? '';
  if (!salonId) {
    router.navigate(['/dashboard']);
    return of(null);
  }

  return membershipStore.getMembership(salonId).pipe(
    catchError(() => {
      router.navigate(['/dashboard']);
      return of(null);
    }),
  );
};
