import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { SalonVisitService } from '../salon-visit.service';
import { BookingFeeService } from '../../../core/booking-fee/booking-fee.service';
import { BookingFeeQuoteResponseDto } from '../../../api/models/booking-fee-quote-response-dto';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { ToastService } from '../../../core/toast/toast.service';

const ALLOWED_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/**
 * The payment step shown between filling in a join/booking and actually
 * submitting it, for salons that require a booking fee.
 *
 * Three things happen here: the party is quoted a fee, they are shown where to
 * send it (the salon is paid DIRECTLY — HairMela never touches the money), and
 * they upload a receipt which the backend verifies.
 *
 * Emits `verified` with the receiptVerificationId once the backend accepts the
 * receipt; the parent dialog then submits the join/book with that id. Also
 * emits `verified` with null when the quote comes back enforced:false, so a
 * salon that turned the fee off mid-flow doesn't strand anyone on a payment
 * screen — the parent just proceeds.
 */
@Component({
  selector: 'app-booking-fee-step',
  templateUrl: './booking-fee-step.component.html',
  imports: [InlineSpinnerComponent],
})
export class BookingFeeStepComponent {
  readonly salonId = input.required<string>();
  readonly queueId = input.required<string>();
  /**
   * One entry PER MEMBER — a person booked for three services contributes
   * three ids. The same list is sent to the quote and to the verification, or
   * the server's recomputation of the fee won't match what was quoted.
   */
  readonly serviceIds = input.required<string[]>();

  /** receiptVerificationId, or null when this salon turned out not to charge. */
  readonly verified = output<string | null>();
  readonly back = output<void>();

  protected readonly visit = inject(SalonVisitService);
  protected readonly fee = inject(BookingFeeService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly quote = signal<BookingFeeQuoteResponseDto | null>(null);
  protected readonly quoteFailed = signal(false);
  protected readonly receipt = signal<File | null>(null);
  protected readonly receiptPreviewUrl = signal<string | null>(null);
  protected readonly receiptError = signal<string | null>(null);
  /**
   * This exact file was already sent and rejected.
   *
   * Separate from receiptError, which also carries picker-level complaints
   * (wrong type, too big) that never reached the server. Resubmitting the same
   * bytes can only fail the same way, and receipt verification is capped at
   * 5/hour — so the button stays disabled until a DIFFERENT image is chosen.
   */
  protected readonly receiptRejected = signal(false);

  protected readonly paymentDetails = this.visit.paymentDetails;

  /** Formatted for display only — never used to recompute anything. */
  protected readonly amountLabel = computed(() => {
    const q = this.quote();
    if (!q) return '';
    return `${q.currency} ${q.amount.toLocaleString()}`;
  });

  /**
   * Why this number is what it is.
   *
   * 'percent'   — the usual case, a share of the booking total.
   * 'fixed'     — every booked service has dynamic pricing, so no percentage
   *               can be worked out.
   * 'threshold' — the total passed the salon's cap, so a flat deposit applies
   *               instead of a percentage that would be unreasonably large.
   */
  protected readonly basisLabel = computed(() => {
    switch (this.quote()?.basis) {
      case 'percent':
        return 'A percentage of your total.';
      case 'threshold':
        return 'A flat deposit for larger bookings.';
      case 'fixed':
        return 'A fixed part payment for this salon.';
      default:
        return '';
    }
  });

  constructor() {
    // Quote as soon as this step appears. serviceIds is tracked so a party
    // edited on the previous step re-quotes rather than showing a stale figure.
    effect(() => {
      const salonId = this.salonId();
      const serviceIds = this.serviceIds();
      if (!salonId || serviceIds.length === 0) return;
      untracked(() => this._fetchQuote(salonId, serviceIds));
    });
  }

  private _fetchQuote(salonId: string, serviceIds: string[]): void {
    this.quoteFailed.set(false);
    this.fee.quote(
      salonId,
      serviceIds,
      this._destroyRef,
      (quote) => {
        // The salon charges nothing after all — don't make anyone sit on a
        // payment screen for a zero fee.
        if (!quote.enforced) {
          this.verified.emit(null);
          return;
        }
        this.quote.set(quote);
      },
      () => this.quoteFailed.set(true),
    );
  }

  protected retryQuote(): void {
    this._fetchQuote(this.salonId(), this.serviceIds());
  }

  /**
   * Copies a payment detail — the account number or the link.
   *
   * These get typed into a banking app, and mistyping an account number sends
   * someone's money to a stranger, so copying is the safe path. Failure is
   * possible (clipboard access is denied on insecure origins and in some
   * embedded webviews), and the toast says so rather than appearing to
   * succeed — the details stay on screen to copy by hand.
   */
  protected copy(value: string, label: string): void {
    if (!navigator.clipboard) {
      this._toast.info(`Copy isn't available here — please type the ${label} manually.`);
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => this._toast.success(`${label} copied.`),
      () => this._toast.info(`Couldn't copy — please type the ${label} manually.`),
    );
  }

  protected onReceiptPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Cleared so re-picking the same file still fires a change event.
    input.value = '';
    if (!file) return;

    // Images only — the backend does not accept PDFs.
    if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
      // A PDF is the common case (bank apps email them), so name the fix
      // rather than only the rule.
      this.receiptError.set(
        file.type === 'application/pdf'
          ? "PDFs can't be checked — please take a screenshot of it and upload that instead."
          : 'Please upload an image (JPEG, PNG, or WebP).',
      );
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      this.receiptError.set('Image must be 5 MB or smaller.');
      return;
    }

    this.receiptError.set(null);
    this.receiptRejected.set(false);
    this._clearReceipt();
    this.receipt.set(file);
    this.receiptPreviewUrl.set(URL.createObjectURL(file));
  }

  protected removeReceipt(): void {
    this._clearReceipt();
  }

  private _clearReceipt(): void {
    const url = this.receiptPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.receiptPreviewUrl.set(null);
    this.receipt.set(null);
  }

  protected submitReceipt(): void {
    const image = this.receipt();
    if (!image || this.fee.verifying() || this.receiptRejected()) return;

    this.fee.verifyReceipt(
      this.salonId(),
      this.queueId(),
      this.serviceIds(),
      image,
      this._destroyRef,
      (result) => {
        if (!result.verified) {
          this.receiptError.set(
            result.reason ?? "That receipt couldn't be verified. Please try another photo.",
          );
          // this.receiptError.set("That receipt couldn't be verified. Please try another photo.");
          this.receiptRejected.set(true);
          return;
        }
        this.verified.emit(result.receiptVerificationId);
      },
      (message, receiptWasRejected) => {
        this.receiptError.set(message);
        if (receiptWasRejected) this.receiptRejected.set(true);
        this._toast.error(message);
      },
    );
  }
}
