import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ApiConfiguration } from '../../../api/api-configuration';
import { walkInControllerStaffAddToQueue } from '../../../api/fn/queues/walk-in-controller-staff-add-to-queue';

@Component({
  selector: 'app-current-client',
  templateUrl: './current-client.component.html',
  imports: [RouterLink, ReactiveFormsModule],
})
export class CurrentClientComponent {
  protected readonly console = inject(QueueConsoleService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);

  protected readonly staffServices = this.console.staffServices;
  protected readonly showEndPartyModal = signal(false);
  protected readonly showExtendModal = signal(false);
  protected readonly showAddQueueModal = signal(false);
  protected readonly addingToQueue = signal(false);
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
    const unfinished = entry.members.filter((m) => m.status === 'WAITING' || m.status === 'SERVING');
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
    this.console.extendMember(this._salonId, this._queueId, entryId, memberId, { extraMinutes: minutes });
  }

  protected openAddQueueModal(): void {
    this.addQueueMembers.clear();
    this.addQueueMembers.push(this._buildMemberRow(this.staffServices()[0]?.serviceId ?? ''));
    this.showAddQueueModal.set(true);
  }

  protected staffAddToQueue(): void {
    if (this.addingToQueue()) return;
    const rows = this.addQueueMembers.value as { name: string; serviceId: string }[];
    const valid = rows.filter((r) => r.name?.trim());
    if (valid.length === 0) { this._toast.error('Enter at least one name.'); return; }
    this.addingToQueue.set(true);
    walkInControllerStaffAddToQueue(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      body: { members: valid.map((r) => ({ memberName: r.name.trim(), serviceId: r.serviceId || undefined })) },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.addingToQueue.set(false);
        this.showAddQueueModal.set(false);
        this._toast.success('Client added to queue.');
      },
      error: () => this.addingToQueue.set(false),
    });
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
