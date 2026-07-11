import { Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { ToastService } from '../../../core/toast/toast.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-queue-list',
  templateUrl: './queue-list.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent, InlineSpinnerComponent],
})
export class QueueListComponent {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);

  protected readonly showAddQueueModal = signal(false);

  protected readonly staffServices = this.console.staffServices;

  protected readonly addQueueForm = this._fb.group({
    members: this._fb.array([this._buildMemberRow()]),
  });

  protected get addQueueMembers(): FormArray {
    return this.addQueueForm.get('members') as FormArray;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  protected noShow(entryId: string): void {
    this.console.noShow(this._salonId, this._queueId, entryId);
  }

  protected cancelEntry(entryId: string): void {
    this.console.cancelEntry(this._salonId, this._queueId, entryId);
  }

  protected copyPhone(phone: string): void {
    navigator.clipboard.writeText(phone).then(() => this._toast.success('Phone copied.'));
  }

  protected openAddQueueModal(): void {
    this.addQueueMembers.clear();
    this.addQueueMembers.push(this._buildMemberRow(this.staffServices()[0]?.serviceId ?? ''));
    this.showAddQueueModal.set(true);
  }

  protected staffAddToQueue(): void {
    const rows = this.addQueueMembers.value as { name: string; serviceId: string; phone: string }[];
    const valid = rows.filter((r) => r.name?.trim());
    if (valid.length === 0) {
      this._toast.error('Enter at least one name.');
      return;
    }
    this.console.staffAddToQueue(
      this._salonId,
      this._queueId,
      valid.map((r) => ({
        memberName: r.name.trim(),
        serviceId: r.serviceId || undefined,
        ...(r.phone?.trim() ? { phone: r.phone.trim() } : {}),
      })),
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
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId], phone: [''] });
  }
}
