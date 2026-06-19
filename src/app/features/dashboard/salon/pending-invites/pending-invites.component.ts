import { Component, inject } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { InvitesService } from '../../invites.service';

@Component({
  selector: 'app-pending-invites',
  templateUrl: './pending-invites.component.html',
  imports: [LowerCasePipe],
})
export class PendingInvitesComponent {
  protected readonly _invites = inject(InvitesService);
}
