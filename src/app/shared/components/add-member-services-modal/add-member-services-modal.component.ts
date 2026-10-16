import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CurrencyNgnPipe } from '../../pipes/currency-ngn.pipe';
import { InlineSpinnerComponent } from '../inline-spinner/inline-spinner.component';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';

export interface SelectableMemberService {
  id: string;
  name: string;
  duration: number;
  price?: string | number | null;
}

@Component({
  selector: 'app-add-member-services-modal',
  templateUrl: './add-member-services-modal.component.html',
  imports: [CurrencyNgnPipe, InlineSpinnerComponent],
})
export class AddMemberServicesModalComponent {
  readonly open = input.required<boolean>();
  readonly memberName = input<string>('Client');
  readonly actor = input<'customer' | 'staff'>('customer');
  readonly availableServices = input<SelectableMemberService[]>([]);
  readonly existingServiceIds = input<string[]>([]);
  readonly remainingCustomerAdditions = input<number>(2);
  readonly currencyCode = input<string | null>(null);
  readonly showPrice = input<boolean>(true);
  readonly loading = input<boolean>(false);

  readonly closed = output<void>();
  readonly servicesSubmitted = output<string[]>();

  // Customer selection state (set of unique service IDs)
  protected readonly customerSelectedIds = signal<string[]>([]);

  // Staff selection state (map of service ID -> count)
  protected readonly staffSelectedCounts = signal<Map<string, number>>(new Map());

  constructor() {
    registerOverlayWhileOpen(this.open, () => this.close());

    // Reset selection whenever opened
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.customerSelectedIds.set([]);
          this.staffSelectedCounts.set(new Map());
        });
      }
    });
  }

  protected close(): void {
    if (this.loading()) return;
    this.closed.emit();
  }

  // ── Customer selection helpers ───────────────────────────────────────────

  protected isExisting(serviceId: string): boolean {
    return this.existingServiceIds().includes(serviceId);
  }

  protected isCustomerSelected(serviceId: string): boolean {
    return this.customerSelectedIds().includes(serviceId);
  }

  protected isCustomerDisabled(serviceId: string): boolean {
    if (this.isExisting(serviceId)) return true;
    if (this.isCustomerSelected(serviceId)) return false;
    return this.customerSelectedIds().length >= this.remainingCustomerAdditions();
  }

  protected toggleCustomerService(serviceId: string): void {
    if (this.isExisting(serviceId)) return;
    this.customerSelectedIds.update((ids) => {
      if (ids.includes(serviceId)) {
        return ids.filter((id) => id !== serviceId);
      }
      if (ids.length >= this.remainingCustomerAdditions()) {
        return ids;
      }
      return [...ids, serviceId];
    });
  }

  // ── Staff selection helpers ───────────────────────────────────────────────

  protected getStaffCount(serviceId: string): number {
    return this.staffSelectedCounts().get(serviceId) ?? 0;
  }

  protected incrementStaffService(serviceId: string): void {
    this.staffSelectedCounts.update((map) => {
      const next = new Map(map);
      const current = next.get(serviceId) ?? 0;
      next.set(serviceId, current + 1);
      return next;
    });
  }

  protected decrementStaffService(serviceId: string): void {
    this.staffSelectedCounts.update((map) => {
      const next = new Map(map);
      const current = next.get(serviceId) ?? 0;
      if (current <= 1) {
        next.delete(serviceId);
      } else {
        next.set(serviceId, current - 1);
      }
      return next;
    });
  }

  // ── Summary computations ─────────────────────────────────────────────────

  protected readonly selectedServicesList = computed(() => {
    const services = this.availableServices();
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    if (this.actor() === 'customer') {
      return this.customerSelectedIds()
        .map((id) => serviceMap.get(id))
        .filter((s): s is SelectableMemberService => !!s);
    }

    const items: SelectableMemberService[] = [];
    for (const [id, count] of this.staffSelectedCounts()) {
      const s = serviceMap.get(id);
      if (s) {
        for (let i = 0; i < count; i++) {
          items.push(s);
        }
      }
    }
    return items;
  });

  protected readonly totalCount = computed(() => this.selectedServicesList().length);

  protected readonly totalDuration = computed(() =>
    this.selectedServicesList().reduce((sum, s) => sum + (s.duration || 0), 0),
  );

  protected readonly totalPrice = computed(() =>
    this.selectedServicesList().reduce((sum, s) => {
      const price = Number(s.price);
      return sum + (Number.isFinite(price) ? price : 0);
    }, 0),
  );

  protected submit(): void {
    if (this.totalCount() === 0 || this.loading()) return;

    if (this.actor() === 'customer') {
      this.servicesSubmitted.emit([...this.customerSelectedIds()]);
    } else {
      const ids: string[] = [];
      for (const [id, count] of this.staffSelectedCounts()) {
        for (let i = 0; i < count; i++) {
          ids.push(id);
        }
      }
      this.servicesSubmitted.emit(ids);
    }
  }
}

