import { Component, inject, signal, viewChildren } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AddClientModalComponent } from '../add-client-modal/add-client-modal.component';
import { ToastService } from '../../../core/toast/toast.service';
import { QueueSoundPreferenceService } from '../../../core/queue/queue-sound-preference.service';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { CommentsThreadComponent } from '../../comments/comments-thread/comments-thread.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { hasChatCounterparty } from '../../../core/appointments/reschedule-policy';
import { TimelineEntryDto } from '../../../core/socket/socket.types';

@Component({
  selector: 'app-queue-list',
  templateUrl: './queue-list.component.html',
  imports: [
    InlineSpinnerComponent,
    AddClientModalComponent,
    AccordionComponent,
    CommentsThreadComponent,
    DatePipe,
    RouterLink,
    PushPromptComponent,
  ],
})
export class QueueListComponent {
  protected readonly console = inject(QueueConsoleService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  protected readonly soundPreference = inject(QueueSoundPreferenceService);

  protected readonly showAddQueueModal = signal(false);

  // Only one row's Notes accordion open at a time — opening one collapses
  // any other. Tracks the open entry's id rather than a per-row boolean, so
  // there's a single source of truth to compare each row against.
  protected readonly openNotesEntryId = signal<string | null>(null);
  private readonly _commentsThreads = viewChildren(CommentsThreadComponent);

  // Dismissed for this page view only (not persisted) — reappears next time
  // the console is opened, unless the barber turns sound back on in Account
  // settings. Real sound playback isn't wired yet — see
  // QueueSoundPreferenceService's own comment for why (waiting on a backend
  // change to distinguish who caused a queue update).
  protected readonly soundOffBannerDismissed = signal(false);
  protected readonly accountLink = RoutePath.account();

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  protected get _staffId(): string {
    return this.console.queue()?.staffId ?? '';
  }

  // Hardcoded, not Location.back(): this page can be reached from several
  // places, and "Back" should always mean "back to the current client",
  // this shell's home — same reasoning as the shell's own back chevron.
  protected get currentClientLink(): string[] {
    return RoutePath.salonQueueConsole(this._salonId, this._queueId);
  }

  // Expand = refetch, same as My Position. Only one row open at a time:
  // each row's accordion [open] is derived from equality against
  // openNotesEntryId, so setting it to a new row implicitly collapses
  // whichever row was previously open.
  /** Staff-added rows have nobody to chat with — see hasChatCounterparty. */
  protected showChat(entry: TimelineEntryDto): boolean {
    return hasChatCounterparty(entry);
  }

  protected onRowNotesOpenChange(entryId: string, open: boolean): void {
    if (!open) {
      if (this.openNotesEntryId() === entryId) this.openNotesEntryId.set(null);
      return;
    }
    this.openNotesEntryId.set(entryId);
    this._commentsThreads()
      .find((c) => c.entryId() === entryId)
      ?.refresh();
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
    this.showAddQueueModal.set(true);
  }

  protected closeAddQueueModal(): void {
    this.showAddQueueModal.set(false);
  }
}
