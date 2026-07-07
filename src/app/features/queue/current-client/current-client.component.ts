import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { ToastService } from '../../../core/toast/toast.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';

@Component({
  selector: 'app-current-client',
  templateUrl: './current-client.component.html',
  imports: [RouterLink, ReactiveFormsModule, FieldErrorComponent],
})
export class CurrentClientComponent {
  protected readonly console = inject(QueueConsoleService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);

  protected readonly staffServices = this.console.staffServices;
  protected readonly showEndPartyModal = signal(false);
  protected readonly showExtendModal = signal(false);
  protected readonly showAddQueueModal = signal(false);
  protected readonly extendTargetEntryId = signal<string | null>(null);
  protected readonly extendTargetMemberId = signal<string | null>(null);
  protected readonly extendMinutes = signal<number | null>(null);

  protected readonly addQueueForm = this._fb.group({
    members: this._fb.array([this._buildMemberRow()]),
  });

  protected get addQueueMembers(): FormArray {
    return this.addQueueForm.get('members') as FormArray;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  private get _queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected get queueUrl(): string {
    return `/salons/${this._salonId}/queues/${this._queueId}/console/queue`;
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
