import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  effect,
  afterNextRender,
  Injector,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../salon-visit.service';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { TabsComponent, TabItem } from '../../../shared/components/tabs/tabs.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import {
  StaffCardComponent,
  StaffCardAvailability,
} from '../../../shared/components/staff-card/staff-card.component';
import { ServiceListItemComponent } from '../../../shared/components/service-list-item/service-list-item.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { Service } from '../../../api/models/service';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { BookAppointmentDialogComponent } from '../book-appointment-dialog/book-appointment-dialog.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { InstallPromptService } from '../../../core/pwa/install-prompt.service';
import { ToastService } from '../../../core/toast/toast.service';
import { staffAvailability } from '../../../core/utils/staff-availability';
import { capitalizeWords } from '../../../core/utils/capitalize-words';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { environment } from '../../../../environments/environment';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { ChatService } from '../../../core/chat/chat.service';

const LANDING_TABS: TabItem[] = [
  { id: 'about', label: 'About' },
  { id: 'services', label: 'Services' },
  { id: 'staffs', label: 'Staff' },
];

// dayOfWeek 0 = Sunday — same convention as backend/src/salons/salon.types.ts
// and salon-settings.component.ts's own DAYS array.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "09:00" -> "9:00 AM", "18:00" -> "6:00 PM" — operatingHours stores 24h
// HH:mm; nothing else in this read-only display benefits from that format.
function formatHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// "Now", in the SALON's timezone, not the browser's — the next-open label
// this feeds (nextOpenLabel below) compares against operatingHours start
// times, which are salon-local by definition (backend/src/salons/salon.
// types.ts). Using the browser's local time here would misclassify "opens
// later today" vs "opens tomorrow" for a visitor in a different timezone
// than the salon, or near midnight salon-local — the same class of bug
// flagged as a FIXME in queue-console.service.ts's staffBookAppointment.
// Intl.DateTimeFormat with an explicit timeZone is the correct client-side
// way to do this (no library needed); salonStatus() above still gets its
// OPEN/CLOSED_HOURS/CLOSED_TODAY verdict from the backend's own openState,
// this only adds the "when" on top for the CLOSED cases.
function salonLocalNow(timezone: string): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const weekdayShort = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayShort);
  return { dayOfWeek, minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface SalonStatusBadge {
  readonly label: string;
  readonly badgeClasses: string;
}

@Component({
  selector: 'app-salon-landing',
  templateUrl: './salon-landing.component.html',
  imports: [
    SkeletonComponent,
    TabsComponent,
    GalleryModalComponent,
    BackButtonComponent,
    IconComponent,
    StaffCardComponent,
    ServiceListItemComponent,
    AccordionComponent,
    PushPromptComponent,
    BookAppointmentDialogComponent,
    MediaUrlPipe,
    RouterLink,
    InlineSpinnerComponent,
    NgTemplateOutlet,
  ],
})
export class SalonLandingComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly install = inject(InstallPromptService);
  // isAppContext, NOT install.installed(): that flag falls back to a stored
  // hm_pwa_installed value, so someone who once installed the PWA reads as
  // "installed" even in a normal browser tab — and would wrongly lose the
  // prompt. isAppContext uses live display checks instead.
  protected readonly platform = inject(AppPlatformService);
  protected readonly howToInstallLink = RoutePath.download();
  private readonly _route = inject(ActivatedRoute);
  private readonly _document = inject(DOCUMENT);
  private readonly _injector = inject(Injector);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);
  private readonly _toast = inject(ToastService);
  private readonly _chatService = inject(ChatService);

  private readonly _paramMap = toSignal(this._route.paramMap, { requireSync: true });
  protected readonly slug = computed(() => this._paramMap().get(RouteParam.SLUG) ?? '');

  protected readonly salonFavoritesCount = signal<number | null>(null);
  protected readonly salonFavoritesCountLoading = signal(false);

  protected messageSalon(): void {
    if (!this._currentUser.user()) {
      this._toast.info('Please sign in to message this salon');
      this._router.navigate(RoutePath.login(), {
        queryParams: { [RouteQueryParam.RETURN_URL]: this._router.url },
      });
      return;
    }
    const s = this.visit.salon();
    if (!s) return;

    this._chatService
      .createOrOpenConversation(s.id, undefined, {
        salonName: s.name,
      })
      .subscribe({
        next: (conv) => {
          this._router.navigate(RoutePath.chatThread(conv.id));
        },
        error: () => {
          this._toast.error('Unable to open conversation');
        },
      });
  }

  // Fallback photo for salons with no uploaded image — same asset used by
  // SalonCardComponent (public/salon-placeholder.jpg).
  protected readonly placeholderImage = '/salon-placeholder.jpg';

  protected readonly landingTabs = LANDING_TABS;
  // Persisted on SalonVisitService (not local state) so navigating away and
  // back within the same salon visit restores the previously selected tab.
  protected readonly activeTab = this.visit.landingTab;

  protected setTab(tab: string): void {
    // Leaving the Services tab for another one drops the selected service —
    // it should only survive navigating away to a barber's queue page and
    // back, not surface again after the user has moved on to a different tab.
    if (this.visit.landingTab() === 'services' && tab !== 'services') {
      this.visit.selectedServiceId.set(null);
    }
    this.visit.landingTab.set(tab as 'about' | 'services' | 'staffs');
  }

  // Both the Staffs tab (no service context) and the Services tab's
  // barber-drilldown (a service already chosen) land here — the queue page is
  // the single place a join can now be started from, so both flows converge
  // on it instead of each owning their own join-dialog trigger.
  protected openStaffQueue(staff: SalonPublicStaffDto, serviceId?: string): void {
    if (!staff.queueId) return;
    this._router.navigate(RoutePath.visitQueue(this._shellPrefix, this._slug, staff.queueId), {
      queryParams: serviceId ? { [RouteQueryParam.SERVICE_ID]: serviceId } : {},
    });
  }

  // FIXME: Restore the isFrozen checks on this landing page (details, status,
  // and booking) when the temporary frozen-salon bypass is no longer needed.
  // The live-queue page and backend still enforce their own frozen checks.
  // protected readonly frozen = computed(() => this.visit.salonData()?.isFrozen ?? false);

  // operatingHours is an untyped Array<{}> on the generated DTO (Swagger
  // doesn't declare its nested shape, same gap salon-settings.component.ts
  // already casts around); the real runtime shape is
  // backend/src/salons/salon.types.ts's OperatingHour ({ dayOfWeek: 0-6
  // (Sun-Sat), startTime/endTime: "HH:mm" }). Shared by weeklyHours (About
  // tab list) and nextOpenLabel (closed-badge subtext) below.
  private readonly _operatingHoursByDay = computed(() => {
    const salon = this.visit.salon();
    if (!salon) return new Map<number, { dayOfWeek: number; startTime: string; endTime: string }>();
    const hours = salon.operatingHours as Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
    }>;
    return new Map(hours.map((h) => [h.dayOfWeek, h]));
  });

  // Operating hours — About tab, read-only. Always rendered Sunday-first
  // through Saturday regardless of the array's own order/completeness — a
  // day with no entry is closed, not omitted, so the list should never look
  // like it's just missing that row.
  protected readonly weeklyHours = computed(() => {
    if (!this.visit.salon()) return [];
    const byDay = this._operatingHoursByDay();
    const todayDow = this._salonNow()?.dayOfWeek;
    return DAY_NAMES.map((name, dayOfWeek) => {
      const h = byDay.get(dayOfWeek);
      return {
        name,
        isToday: dayOfWeek === todayDow,
        label: h ? `${formatHour(h.startTime)} – ${formatHour(h.endTime)}` : 'Closed',
      };
    });
  });

  // Salon-local "now" — undefined until salon.timezone is known. Read by
  // both weeklyHours (today's row) and nextOpenLabel below.
  private readonly _salonNow = computed(() => {
    const timezone = this.visit.salon()?.timezone;
    return timezone ? salonLocalNow(timezone) : null;
  });

  // Subtext next to the Closed badge — when the salon next opens, salon-
  // local. Only meaningful while closed; salonStatus() already carries the
  // OPEN/CLOSED verdict itself (backend-computed), this only adds the "when"
  // for the closed cases, walking forward through operatingHours to find the
  // next day that has any hours at all (handles a salon closed multiple days
  // in a row, e.g. Sat -> next open Monday, not just "closed today/tomorrow").
  protected readonly nextOpenLabel = computed(() => {
    const status = this.salonStatus();
    const now = this._salonNow();
    if (!status || status.label === 'Open Now' || !now) return null;
    const byDay = this._operatingHoursByDay();

    // Today, if it still has a slot starting later than right now.
    const today = byDay.get(now.dayOfWeek);
    if (today && toMinutes(today.startTime) > now.minutes) {
      return `Opens at ${formatHour(today.startTime)}`;
    }

    // Otherwise walk forward up to 6 days to find the next day with hours.
    for (let offset = 1; offset <= 6; offset++) {
      const dow = (now.dayOfWeek + offset) % 7;
      const day = byDay.get(dow);
      if (!day) continue;
      const when = offset === 1 ? 'tomorrow' : DAY_NAMES[dow];
      return `Opens ${when} at ${formatHour(day.startTime)}`;
    }
    return null; // no hours configured for any day
  });

  // About tab's photo gallery — the full salon.galleryUrls array is always
  // passed to the modal (only the first 4 are shown as a preview grid).
  protected readonly galleryOpen = signal(false);
  protected readonly galleryStartIndex = signal(0);

  protected openGallery(index: number): void {
    this.galleryStartIndex.set(index);
    this.galleryOpen.set(true);
  }

  protected closeGallery(): void {
    this.galleryOpen.set(false);
  }

  // Separate open-state for the header photo lightbox — its own instance so it
  // never collides with the Recent Work gallery modal above.
  protected readonly photoOpen = signal(false);

  protected openPhoto(): void {
    this.photoOpen.set(true);
  }

  constructor() {
    // Re-runs as serviceCategories() fills in; _applyCategoryDeepLink is
    // self-guarding and no-ops after its single application.
    effect(() => this._applyCategoryDeepLink());

    effect(() => {
      const s = this.slug();
      if (s) {
        untracked(() => this._loadFavoritesCount(s));
      }
    });
  }

  private async _loadFavoritesCount(slug: string): Promise<void> {
    this.salonFavoritesCount.set(null);
    this.salonFavoritesCountLoading.set(true);
    try {
      const count = await this._favorites.getSalonFavoritesCount(slug);
      if (count !== null) {
        this.salonFavoritesCount.set(count);
      }
    } finally {
      this.salonFavoritesCountLoading.set(false);
    }
  }

  ngOnInit(): void {
    if (this._currentUser.user()) {
      this._favorites.ensureIdsLoaded();
      this._favorites.ensureStaffIdsLoaded();
    }
  }

  // Heart shown publicly with like count — guest visitors can see the count
  // and clicking prompts sign-in.
  protected readonly showHeart = computed(() => true);

  // "Book ahead" is the walk-in fallback for a closed salon — while open,
  // customers use the per-staff "Book an appointment" section on the
  // live-queue page instead (staff already known there).
  // Closed is precisely WHEN book-ahead is offered — it's the walk-in fallback.
  // FIXME: When restoring the other frozen checks, use frozen() here too.
  // protected readonly showBookAhead = computed(
  //   () => !this.visit.salonData()?.isOpen && !this.frozen(),
  // );
  protected readonly showBookAhead = computed(() => !this.visit.salonData()?.isFrozen);

  protected readonly bookDialogOpen = signal(false);

  // Guests can book directly and provide their contact details in the dialog.
  protected openBookDialog(): void {
    this.bookDialogOpen.set(true);
  }

  protected closeBookDialog(): void {
    this.bookDialogOpen.set(false);
  }

  protected readonly isFavorited = computed(() => {
    const id = this.visit.salon()?.id;
    return id ? this._favorites.isFavorited(id) : false;
  });

  protected toggleFavorite(): void {
    if (!this._currentUser.user()) {
      this._toast.info('Please sign in to save favourites');
      this._router.navigate(RoutePath.login(), {
        queryParams: { [RouteQueryParam.RETURN_URL]: this._router.url },
      });
      return;
    }

    const id = this.visit.salon()?.id;
    if (!id) return;

    const wasFavorited = this.isFavorited();
    const current = this.salonFavoritesCount();
    if (current !== null) {
      this.salonFavoritesCount.set(wasFavorited ? Math.max(0, current - 1) : current + 1);
    }
    this._favorites.toggle({ id });
  }

  // The public salon URL, built with NO shell prefix: this page is reachable
  // as /s/:slug and /g/s/:slug (guest shell), but the link handed to someone
  // else must be the plain one so their own session decides how to route them
  // — same reasoning as live-queue's "Copy queue link".
  protected get shareUrl(): string {
    return `${environment.appBaseUrl}${RoutePath.visitSalon('', this._slug).join('/')}`;
  }

  // Native share sheet where the browser has one (the common case here — this
  // is a customer-facing page, mostly opened on a phone), clipboard otherwise.
  // Desktop Chrome/Firefox have no navigator.share, so the fallback isn't an
  // edge case.
  protected async shareSalon(): Promise<void> {
    const name = this.visit.salon()?.name ?? 'this salon';
    const url = this.shareUrl;

    if (navigator.share) {
      try {
        await navigator.share({ title: name, text: `Check out ${name} on HairMela`, url });
        return;
      } catch (err) {
        // AbortError = the user dismissed the sheet. That's not a failure and
        // must not fall through to copying, which would be a surprise action
        // they didn't ask for. Anything else means the sheet couldn't open,
        // so copying is the right recovery.
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }

    void this.copyLink();
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl);
      this._toast.success('Link copied');
    } catch {
      this._toast.error('Could not copy link');
    }
  }

  protected get _slug(): string {
    return this.slug();
  }

  protected get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  protected get directionsUrl(): string {
    const s = this.visit.salon();
    if (!s) return '#';
    const addr = s.address;
    if (addr?.latitude && addr?.longitude) {
      return `https://www.google.com/maps/search/?api=1&query=${addr.latitude},${addr.longitude}`;
    }
    const query = [s.name, addr?.street, addr?.city, addr?.state]
      .filter(Boolean)
      .join(', ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  // Salon open/closed badge — computed server-side in the salon's own timezone
  // (openState), never derived on the client. null until the payload loads.
  protected readonly salonStatus = computed<SalonStatusBadge | null>(() => {
    const data = this.visit.salonData();
    if (!data) return null;
    // FIXME: Restore this frozen status guard when the temporary bypass ends.
    // if (this.frozen()) return null;
    switch (data.openState) {
      case 'OPEN':
        return {
          label: 'Open Now',
          badgeClasses: 'bg-open-badge text-open-badge-text border-success/20',
        };
      case 'CLOSED_HOURS':
        return { label: 'Closed', badgeClasses: 'bg-error-light text-error border-error/20' };
      default: // 'CLOSED_TODAY'
        return {
          label: 'Closed today',
          badgeClasses: 'bg-error-light text-error border-error/20',
        };
    }
  });

  // Services-first landing: null = showing the services list; set = showing
  // the barbers who offer that service. Persisted on SalonVisitService (not
  // local state) so navigating to a barber's queue page and back restores the
  // same service instead of resetting to the plain services list — no request
  // either way, since visit.services()/staffList() are already loaded (same
  // instant, client-side-filter pattern as staffServices() on the join screen).
  protected readonly selectedServiceId = this.visit.selectedServiceId;

  // Services grouped by category, ordered by each category's sortOrder
  // (services within a category keep visit.services()'s existing order).
  protected readonly serviceCategories = computed(() => {
    const groups = new Map<
      string,
      { id: string; name: string; slug: string; sortOrder: number; services: Service[] }
    >();
    for (const service of this.visit.services()) {
      const cat = service.category ?? service.salonCategory;
      if (!cat) continue;
      let group = groups.get(cat.id);
      if (!group) {
        // slug is carried alongside id so a ?category=<slug> deep link can be
        // resolved without a second lookup — the pills filter by slug, the
        // accordions key on id.
        group = {
          id: cat.id,
          name: service.salonCategory ? capitalizeWords(cat.name) : cat.name,
          slug: service.category?.slug ?? '',
          sortOrder: service.category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          services: [],
        };
        groups.set(cat.id, group);
      }
      group.services.push(service);
    }
    return [...groups.values()].sort(
      (a, b) =>
        Number(a.name.toLocaleLowerCase() === 'other') -
          Number(b.name.toLocaleLowerCase() === 'other') || a.sortOrder - b.sortOrder,
    );
  });

  // ── Deep link: ?category=<slug> ──────────────────────────────────────────
  //
  // Set when a customer taps a salon while filtering by a category, so the
  // salon page opens on that category's services instead of making them find
  // it again (see SalonCardComponent.detailQueryParams).
  //
  // Applied in an effect rather than ngOnInit because SERVICES LOAD ASYNC:
  // at init, serviceCategories() is empty and there is nothing to match
  // against. This waits for them, then runs exactly once — _deepLinkApplied
  // guards re-entry so the user closing the accordion is not fought by the
  // effect immediately reopening it.
  private _deepLinkApplied = false;

  private _applyCategoryDeepLink(): void {
    if (this._deepLinkApplied) return;

    const slug = this._route.snapshot.queryParamMap.get(RouteQueryParam.CATEGORY);
    if (!slug) {
      this._deepLinkApplied = true; // nothing to do; stop watching
      return;
    }

    const categories = this.serviceCategories();
    if (categories.length === 0) return; // services not loaded yet — wait

    // Mark applied BEFORE the match check: if this salon has no service in
    // that category, that is a settled answer, not a reason to keep retrying
    // on every recompute.
    this._deepLinkApplied = true;

    const match = categories.find((c) => c.slug === slug);
    if (!match) return; // salon does not offer it — leave the default tab

    this.visit.landingTab.set('services');
    this.setCategoryOpen(match.id, true);
    this._scrollCategoryIntoView(match.id);
  }

  // Deferred to after the next render: the tab switch above only renders the
  // Services panel on the following change detection pass, so the element does
  // not exist yet at this point.
  //
  // afterNextRender, NOT requestAnimationFrame — rAF fires on the next frame,
  // which is merely *usually* after Angular has rendered. That is a timing
  // guess that can miss on a slow device and silently skip the scroll.
  // afterNextRender is the actual guarantee, and it is a no-op on the server.
  private _scrollCategoryIntoView(categoryId: string): void {
    afterNextRender(
      () => {
        this._document
          .getElementById(`service-category-${categoryId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      { injector: this._injector },
    );
  }

  // Per-category accordion open state. A single category is always expanded
  // (nothing to collapse against); with multiple categories, all start
  // collapsed. Explicit toggles are remembered here rather than recomputed,
  // so a background services refresh doesn't snap a user's open section shut.
  private readonly _openCategoryIds = signal<ReadonlySet<string>>(new Set());

  protected isCategoryOpen(categoryId: string): boolean {
    if (this.serviceCategories().length <= 1) return true;
    return this._openCategoryIds().has(categoryId);
  }

  protected setCategoryOpen(categoryId: string, open: boolean): void {
    this._openCategoryIds.update((ids) => {
      const next = new Set(ids);
      open ? next.add(categoryId) : next.delete(categoryId);
      return next;
    });
  }

  protected readonly staffForSelectedService = computed(() => {
    const serviceId = this.selectedServiceId();
    if (!serviceId) return [];
    return this.visit.staffList().filter((s) => s.serviceIds.includes(serviceId));
  });

  protected readonly selectedService = computed(() => {
    const serviceId = this.selectedServiceId();
    return serviceId ? (this.visit.services().find((s) => s.id === serviceId) ?? null) : null;
  });

  protected selectService(serviceId: string): void {
    this.visit.selectedServiceId.set(serviceId);
  }

  protected backToServices(): void {
    this.visit.selectedServiceId.set(null);
  }

  // Real availability from the barber's own openState (backend-computed,
  // precedence-ordered: paused > queue closed > one-off closure or salon
  // closed today > no schedule today > outside today's hours > open) — see
  // core/utils/staff-availability.ts. Replaces the old queueStatus-only
  // check, which couldn't tell "on break" from "no schedule today" from
  // "outside hours" and showed a barber as available even when their
  // schedule said otherwise, as long as their queue happened to be OPEN.
  protected availability(staff: SalonPublicStaffDto): StaffCardAvailability {
    return { ...staffAvailability(staff), showBadge: true };
  }
}
