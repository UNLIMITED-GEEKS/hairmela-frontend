import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SalonServicesCache } from '../../../core/appointments/salon-services-cache.service';
import { RescheduleService, RescheduleActor } from '../../../core/appointments/reschedule.service';
import { QueueEntry } from '../../../api/models/queue-entry';
import { RescheduleMemberDto } from '../../../api/models/reschedule-member-dto';
import { SlotPickerComponent } from '../../../shared/components/slot-picker/slot-picker.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';

/**
 * Moves an existing appointment to a new slot.
 *
 * Distinct from BookAppointmentDialogComponent in what it does to members:
 * booking CREATES them (type a name, pick a service, add or remove people),
 * while this EDITS a fixed set — RescheduleMemberDto requires a memberId, so
 * the party is whoever is already on the entry. Names are shown read-only and
 * only the service per person can change. That difference is why this is its
 * own component rather than a mode of the booking dialog; what the two genuinely
 * share — the whole date/availability/slot flow — is app-slot-picker.
 *
 * Availability is fetched for the entry's own staff member: rescheduling moves
 * WHEN, not WHO. Changing barber means cancelling and booking again.
 */
@Component({
  selector: 'app-reschedule-dialog',
  templateUrl: './reschedule-dialog.component.html',
  imports: [SlotPickerComponent, InlineSpinnerComponent],
})
export class RescheduleDialogComponent {
  readonly open = input.required<boolean>();
  readonly entry = input.required<QueueEntry | null>();
  /**
   * Which endpoint to use. 'staff' may move any appointment in the salon;
   * 'customer' only the signed-in user's own. Surfaces pass this explicitly
   * rather than the dialog guessing from the current user's role — the queue
   * console and My Position can show the same appointment.
   */
  readonly actor = input.required<RescheduleActor>();
  /**
   * Which salon this appointment belongs to.
   *
   * An explicit input, NOT dug out of entry.queue.salon.id: the staff/admin
   * appointments list is fed by the staff-appointments endpoints, whose rows
   * don't hydrate that relation — reading it there yielded an empty id and a
   * request to /salons//staff/... Every surface already knows its own salon,
   * so each passes it.
   */
  readonly salonId = input.required<string>();

  readonly closed = output<void>();
  /** The updated entry, so the surface can refresh its own list. */
  readonly rescheduled = output<QueueEntry>();

  protected readonly reschedule = inject(RescheduleService);
  private readonly _salonServices = inject(SalonServicesCache);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly selectedDate = signal<string | null>(null);
  protected readonly selectedStartTime = signal<string | null>(null);
  protected readonly slotResetToken = signal(0);

  /** Service chosen per member, keyed by memberId. Prefilled from the entry. */
  private readonly _memberServices = signal<Record<string, string>>({});

  protected readonly members = computed(() => this.entry()?.members ?? []);

  // Availability is per staff member, and rescheduling keeps the same one.
  protected readonly staffId = computed(() => this.entry()?.staffId ?? null);

  /**
   * What this staff member can actually do, fetched here rather than read from
   * SalonVisitService.
   *
   * That service's staffList()/services() are populated by the CUSTOMER-facing
   * salon page, so they're empty on both surfaces that open this dialog — My
   * History and the staff appointments list — which rendered blank dropdowns.
   * SalonServicesCache makes this dialog self-sufficient instead of dependent
   * on which page happened to be visited first, and fetches each salon's menu
   * only once per session. See that service for why it uses the public route.
   */
  private readonly _fetchedServices = signal<{ id: string; name: string }[]>([]);

  /**
   * The fetched list, plus whatever the party already booked.
   *
   * A member's current service must always be an option — otherwise its
   * <option> is missing, the select renders blank, and saving would quietly
   * change what they booked. This matters when the fetch fails, and when a
   * service has since been deactivated or unassigned from this staff member
   * but an existing appointment still references it.
   */
  protected readonly staffServices = computed(() => {
    const merged = new Map<string, { id: string; name: string }>();
    for (const s of this._fetchedServices()) merged.set(s.id, s);
    for (const m of this.members()) {
      if (m.service?.id && !merged.has(m.service.id)) {
        merged.set(m.service.id, { id: m.service.id, name: m.service.name });
      }
    }
    return [...merged.values()];
  });

  protected readonly canSubmit = computed(
    () => !!this.selectedDate() && !!this.selectedStartTime() && !this.reschedule.saving(),
  );

  constructor() {
    // Android back dismisses this instead of navigating underneath it.
    registerOverlayWhileOpen(this.open, () => this.cancel());

    // Prefill each member's current service every time this opens, so a
    // reopen never carries a previous edit. untracked() for the same reason
    // the booking dialog needs it: writes in here must not re-trigger the
    // effect that made them.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const prefilled: Record<string, string> = {};
        for (const m of this.members()) {
          if (m.serviceId) prefilled[m.id] = m.serviceId;
        }
        this._memberServices.set(prefilled);
        this.slotResetToken.update((n) => n + 1);
        this._loadStaffServices();
      });
    });
  }

  private _loadStaffServices(): void {
    const salonId = this.salonId();
    const staffId = this.staffId();
    if (!salonId || !staffId) {
      this._fetchedServices.set([]);
      return;
    }
    this._salonServices
      .forSalon(salonId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((services) =>
        this._fetchedServices.set(
          // This barber's own offerings — booking a service they don't perform
          // would fail at the backend anyway.
          services
            .filter((svc) => svc.staffIds.includes(staffId))
            .map((svc) => ({ id: svc.id, name: svc.name })),
        ),
      );
  }

  protected serviceIdFor(memberId: string): string {
    return this._memberServices()[memberId] ?? '';
  }

  protected setServiceFor(memberId: string, serviceId: string): void {
    this._memberServices.update((map) => ({ ...map, [memberId]: serviceId }));
  }

  protected cancel(): void {
    this.closed.emit();
  }

  protected confirm(): void {
    const entry = this.entry();
    const date = this.selectedDate();
    const startTime = this.selectedStartTime();
    if (!entry || !date || !startTime) return;


    // Only send members whose service is actually known — memberId is
    // required by the DTO, and a member with no service selected would be a
    // partial update the backend has no way to interpret.
    const members: RescheduleMemberDto[] = this.members()
      .map((m) => ({ memberId: m.id, serviceId: this.serviceIdFor(m.id) }))
      .filter((m) => !!m.serviceId);

    this.reschedule.reschedule(
      this.actor(),
      { salonId: this.salonId(), queueId: entry.queueId, entryId: entry.id },
      { date, startTime, members },
      this._destroyRef,
      (updated) => {
        this.rescheduled.emit(updated);
        this.closed.emit();
      },
    );
  }
}
