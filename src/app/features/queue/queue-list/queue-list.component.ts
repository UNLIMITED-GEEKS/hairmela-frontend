import { Component, OnInit, computed, inject, signal, viewChildren } from '@angular/core';
import { DatePipe, Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { ToastService } from '../../../core/toast/toast.service';
import { QueueSoundPreferenceService } from '../../../core/queue/queue-sound-preference.service';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { CommentsThreadComponent } from '../../comments/comments-thread/comments-thread.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { hasChatCounterparty } from '../../../core/appointments/reschedule-policy';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { StaffService } from '../../staff/staff.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-queue-list',
  templateUrl: './queue-list.component.html',
  imports: [
    InlineSpinnerComponent,
    AccordionComponent,
    CommentsThreadComponent,
    DatePipe,
    NgTemplateOutlet,
    RouterLink,
    PushPromptComponent,
    IconComponent,
  ],
})
export class QueueListComponent implements OnInit {
  protected readonly console = inject(QueueConsoleService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _location = inject(Location);
  private readonly _toast = inject(ToastService);
  private readonly _staffService = inject(StaffService);
  protected readonly soundPreference = inject(QueueSoundPreferenceService);

  protected readonly barber = computed(() =>
    this._staffService.staffList().find((item) => item.staff.id === this._staffId)?.staff,
  );
  protected readonly activeClients = computed(() =>
    this.console.queueListEntries().filter((entry) => !entry.isUpcoming).length,
  );
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

  ngOnInit(): void {
    this._staffService.load(this._salonId);
  }

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
  protected readonly openEntryIds = signal<ReadonlySet<string>>(new Set<string>());
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

  protected get currentClientLink(): string[] {
    return RoutePath.salonQueueConsole(this._salonId, this._queueId);
  }

  protected goBack(): void {
    if (window.history.length > 1) {
      this._location.back();
    } else {
      void this._router.navigate(this.currentClientLink);
    }
  }

  protected clientInitials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  protected toggleEntry(entryId: string): void {
    this.openEntryIds.update((openIds) => {
      const next = new Set(openIds);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  protected completeCurrent(): void {
    const entry = this.console.servingEntry();
    if (!entry || this.console.isLocked(entry.entryId)) return;
    const unfinished = entry.members.filter((member) => member.status === 'WAITING' || member.status === 'SERVING');
    if (unfinished.length > 1) {
      void this._router.navigate(this.currentClientLink);
      return;
    }
    this.console.endSession(this._salonId, this._queueId);
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
}
