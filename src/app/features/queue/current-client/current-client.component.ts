import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { ToastService } from '../../../core/toast/toast.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { SalonMediaService } from '../../salons/salon-media/salon-media.service';
import { StaffMediaService } from '../../staff/staff-media/staff-media.service';
import { StaffService } from '../../staff/staff.service';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-current-client',
  templateUrl: './current-client.component.html',
  imports: [RouterLink, ReactiveFormsModule, FieldErrorComponent, InlineSpinnerComponent, MediaUrlPipe, IconComponent],
})
export class CurrentClientComponent implements OnInit {
  protected readonly console = inject(QueueConsoleService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);
  private readonly _salonMedia = inject(SalonMediaService);
  private readonly _staffMedia = inject(StaffMediaService);
  private readonly _staffService = inject(StaffService);

  protected readonly staffServices = this.console.staffServices;
  protected readonly barber = computed(() => {
    const staffId = this.console.queue()?.staffId;
    const staff = this.console.queue()?.staff;
    return this._staffService.staffList().find((item) => item.staff.id === staffId)?.staff
      ?? (staff?.id === staffId ? staff : null)
      ?? this.console.staffServices().find((item) => item.staffId === staffId)?.staff
      ?? null;
  });
  protected readonly barberName = computed(() => {
    const staff = this.barber();
    const name = [staff?.user?.firstName, staff?.user?.lastName].filter(Boolean).join(' ');
    return name || staff?.email || 'Staff member';
  });
  protected readonly barberPhoto = computed(() =>
    this._staffMedia.media().find((media) => media.entityId === this.console.queue()?.staffId && media.type === 'PROFILE'),
  );
  protected readonly salonPhoto = computed(() =>
    this._salonMedia.media().find((media) => media.entityId === this._salonId && media.type === 'PROFILE'),
  );
  protected readonly heroPhoto = computed(() => this.salonPhoto() ?? this.barberPhoto());
  protected readonly remainingSeconds = computed(() => {
    const member = this.console.displayServingMember();
    if (!member) return 0;
    const [minutes, seconds] = this.console.timerFromServedAt().split(':').map(Number);
    return Math.max(0, member.serviceDuration * 60 - (minutes ?? 0) * 60 - (seconds ?? 0));
  });
  protected readonly minutesLeft = computed(() => Math.ceil(this.remainingSeconds() / 60));
  protected readonly remainingTime = computed(() => {
    const remaining = this.remainingSeconds();
    return [Math.floor(remaining / 3600), Math.floor((remaining % 3600) / 60), remaining % 60]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
  });
  protected readonly showEndPartyModal = signal(false);
  protected readonly showExtendModal = signal(false);
  protected readonly showAddQueueModal = signal(false);
  protected readonly extendTargetEntryId = signal<string | null>(null);
  protected readonly extendTargetMemberId = signal<string | null>(null);
  protected readonly extendMinutes = signal<number | null>(null);

  protected readonly addQueueForm = this._fb.group({
    members: this._fb.array([this._buildMemberRow()]),
  });

  constructor() {
    effect(() => {
      const staffId = this.console.queue()?.staffId;
      if (staffId) untracked(() => this._staffMedia.load(staffId));
    });
  }

  ngOnInit(): void {
    this._salonMedia.load(this._salonId);
    this._staffService.load(this._salonId);
  }

  protected initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  protected get addQueueMembers(): FormArray {
    return this.addQueueForm.get('members') as FormArray;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  protected get queueUrl() {
    return RoutePath.salonQueueConsoleQueue(this._salonId, this._queueId);
  }

  protected endSession(): void {
    const entry = this.console.servingEntry();
    if (!entry || this.console.acting()) return;
    const unfinished = entry.members.filter(
      (m) => m.status === 'WAITING' || m.status === 'SERVING',
    );
    if (unfinished.length > 1) {
      this.showEndPartyModal.set(true);
      return;
    }
    this.console.endSession(this._salonId, this._queueId);
  }

  protected endAllMembers(): void {
    this.showEndPartyModal.set(false);
    this.console.endAllMembers(this._salonId, this._queueId);
  }

  protected serveMember(entryId: string, memberId: string): void {
    this.console.serveMember(this._salonId, this._queueId, entryId, memberId);
  }

  protected completeMember(entryId: string, memberId: string): void {
    this.console.completeMember(this._salonId, this._queueId, entryId, memberId);
  }

  protected cancelMember(entryId: string, memberId: string): void {
    this.console.cancelMember(this._salonId, this._queueId, entryId, memberId);
  }

  protected openExtendModal(entryId: string, memberId: string): void {
    this.extendTargetEntryId.set(entryId);
    this.extendTargetMemberId.set(memberId);
    this.extendMinutes.set(null);
    this.showExtendModal.set(true);
  }

  protected confirmExtend(): void {
    const entryId = this.extendTargetEntryId();
    const memberId = this.extendTargetMemberId();
    const minutes = this.extendMinutes();
    if (!entryId || !memberId || !minutes || minutes < 1) return;
    this.showExtendModal.set(false);
    this.console.extendMember(this._salonId, this._queueId, entryId, memberId, {
      extraMinutes: minutes,
    });
  }

  protected openAddQueueModal(): void {
    this.addQueueMembers.clear();
    this.addQueueMembers.push(this._buildMemberRow(this.staffServices()[0]?.serviceId ?? ''));
    this.showAddQueueModal.set(true);
  }

  protected staffAddToQueue(): void {
    const rows = this.addQueueMembers.value as { name: string; serviceId: string }[];
    const valid = rows.filter((r) => r.name?.trim());
    if (valid.length === 0) {
      this._toast.error('Enter at least one name.');
      return;
    }
    this.console.staffAddToQueue(
      this._salonId,
      this._queueId,
      valid.map((r) => ({ memberName: r.name.trim(), serviceId: r.serviceId || undefined })),
      () => this.showAddQueueModal.set(false),
    );
  }

  protected addQueueMemberRow(): void {
    this.addQueueMembers.push(this._buildMemberRow(this.staffServices()[0]?.serviceId ?? ''));
  }

  protected removeQueueMemberRow(i: number): void {
    this.addQueueMembers.removeAt(i);
    if (this.addQueueMembers.length === 0) {
      this.addQueueMembers.push(this._buildMemberRow(this.staffServices()[0]?.serviceId ?? ''));
    }
  }

  private _buildMemberRow(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
