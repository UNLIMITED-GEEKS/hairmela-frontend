import { Component, OnInit, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SalonVisitService } from '../salon-visit.service';

@Component({
  selector: 'app-my-position',
  templateUrl: './my-position.component.html',
  imports: [ReactiveFormsModule, RouterLink],
})
export class MyPositionComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);

  protected readonly showAddKidsModal = signal(false);

  protected readonly addKidsForm = this._fb.group({
    members: this._fb.array<ReturnType<typeof this._buildMemberGroup>>([]),
  });

  protected get membersArray(): FormArray {
    return this.addKidsForm.get('members') as FormArray;
  }

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  ngOnInit(): void {
    this.visit.watchQueue(this._queueId);
  }

  protected get liveQueueUrl(): string {
    return `/s/${this._slug}/q/${this._queueId}`;
  }

  protected openAddKids(): void {
    this.showAddKidsModal.set(true);
    if (this.membersArray.length === 0) {
      this.membersArray.push(this._buildMemberGroup(this._firstServiceId()));
    }
  }

  protected closeAddKids(): void {
    this.showAddKidsModal.set(false);
  }

  protected addMember(): void {
    if (this.membersArray.length >= this.visit.maxPartySize() - 1) return;
    this.membersArray.push(this._buildMemberGroup(this._firstServiceId()));
  }

  protected removeMember(i: number): void {
    this.membersArray.removeAt(i);
    if (this.membersArray.length === 0) this.showAddKidsModal.set(false);
  }

  protected submitKids(): void {
    const rows = this.membersArray.value as { name: string; serviceId: string }[];
    this.visit.addMembers(rows, () => {
      this.membersArray.clear();
      this.closeAddKids();
    });
  }

  protected leaveQueue(): void {
    this.visit.leaveQueue(() => this._router.navigate(['/s', this._slug]));
  }

  private _firstServiceId(): string {
    const staff = this.visit.staffForQueue(this._queueId);
    return staff ? (this.visit.staffServices(staff)[0]?.id ?? '') : '';
  }

  private _buildMemberGroup(serviceId = '') {
    return this._fb.group({ name: ['', Validators.required], serviceId: [serviceId] });
  }
}
