import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { publicSalonsControllerGetBookingFee } from '../../api/fn/salons/public-salons-controller-get-booking-fee';
import { receiptVerificationControllerVerify } from '../../api/fn/queues/receipt-verification-controller-verify';
import { BookingFeeQuoteResponseDto } from '../../api/models/booking-fee-quote-response-dto';
import { VerifyReceiptResponseDto } from '../../api/models/verify-receipt-response-dto';
import { uploadAdHocImage } from '../media/media-upload';
import { ErrorCodes } from '../errors/error-codes';
import { isApiError } from '../errors/api-error.types';
import { GuestStore } from '../guest/guest-store';

/**
 * Booking fees: quoting one, and turning a payment receipt into a token the
 * join/book call can present.
 *
 * HairMela never handles the money. The customer pays the salon directly
 * (bank transfer or the salon's own link — see salon.paymentDetails), uploads
 * a photo of the receipt, and the backend decides whether it is proof enough.
 *
 * 🔴 The quoted `amount` is DISPLAYED AS GIVEN and never recomputed here. The
 * receipt check recomputes server-side from the same service rows, so a second
 * implementation on this side is the only way the two could ever disagree.
 * `basis` exists to EXPLAIN the number ('percent' of the total, or a 'fixed'
 * amount used when every service has dynamic pricing) — not to derive it.
 */
@Injectable({ providedIn: 'root' })
export class BookingFeeService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _guestStore = inject(GuestStore);

  private readonly _quoting = signal(false);
  private readonly _verifying = signal(false);

  readonly quoting = this._quoting.asReadonly();
  /** True across the whole upload -> verify sequence, which is one user action. */
  readonly verifying = this._verifying.asReadonly();

  /**
   * What this party owes before they can join or book.
   *
   * serviceIds is one entry PER MEMBER — a person booked for three services
   * contributes three ids — and must be the exact same list later sent to
   * verifyReceipt(), or the server's recomputation won't match.
   *
   * A quote with enforced:false means this salon charges nothing; the caller
   * should skip the payment step entirely rather than showing a zero.
   */
  quote(
    salonId: string,
    serviceIds: string[],
    destroyRef: DestroyRef,
    onSuccess: (quote: BookingFeeQuoteResponseDto) => void,
    onError: () => void,
  ): void {
    if (this._quoting()) return;
    this._quoting.set(true);
    publicSalonsControllerGetBookingFee(this._http, this._apiConfig.rootUrl, {
      salonId,
      serviceIds,
    })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (res) => {
          this._quoting.set(false);
          onSuccess(res.body);
        },
        error: () => {
          this._quoting.set(false);
          onError();
        },
      });
  }

  /**
   * Uploads the receipt image and asks the backend to verify it.
   *
   * Images only — no PDF. No owning entity (a receipt isn't a salon's,
   * staff's, or user's profile/gallery photo), so this goes through
   * uploadAdHocImage() rather than uploadMedia() — see that function's doc.
   * The returned url + public id go to our API.
   *
   * On success the caller must send receiptVerificationId with the join/book
   * call. Receipts are single-use
   * happen immediately after, not be held onto.
   *
   * guestToken: a first-time guest's identity is MINTED here, and is stored
   * before onSuccess runs — without it the join call cannot claim the receipt
   * it just paid for.
   */
  verifyReceipt(
    salonId: string,
    queueId: string,
    serviceIds: string[],
    image: File,
    destroyRef: DestroyRef,
    onSuccess: (result: VerifyReceiptResponseDto) => void,
    // receiptWasRejected: this specific image/receipt is the problem, so
    // resending the same bytes can only fail again. False for transport-level
    // failures (offline, timeout, 5xx), where a retry is entirely reasonable.
    onError: (message: string, receiptWasRejected: boolean) => void,
  ): void {
    if (this._verifying()) return;
    this._verifying.set(true);

    uploadAdHocImage(this._http, this._apiConfig, image, 'RECEIPT')
      .pipe(
        switchMap((upload) =>
          receiptVerificationControllerVerify(this._http, this._apiConfig.rootUrl, {
            salonId,
            queueId,
            body: {
              imageUrl: upload.url,
              imagePublicId: upload.publicId,
              serviceIds,
            },
          }),
        ),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe({
        next: (res) => {
          this._verifying.set(false);
          const result = res.body;
          // Store BEFORE handing back: the join call that follows needs this
          // token to prove it is the same guest who paid.
          if (result.guestToken) this._guestStore.setToken(result.guestToken);
          onSuccess(result);
        },
        error: (err: unknown) => {
          this._verifying.set(false);
          onError(this.messageFor(err), this._isReceiptRejection(err));
        },
      });
  }

  /**
   * Whether the failure was about THIS receipt, rather than the request.
   *
   * Used to decide if resubmitting the same file is pointless: a rejected or
   * already-used receipt will never pass, while a network error might. Rate
   * limiting counts too — retrying immediately is exactly what won't help.
   */
  private _isReceiptRejection(err: unknown): boolean {
    if ((err as { status?: number })?.status === 429) return true;
    const body = (err as { error?: unknown })?.error;
    if (!isApiError(body)) return false;
    return (
      body.code === ErrorCodes.RECEIPT_NOT_VALID ||
      body.code === ErrorCodes.RECEIPT_INVALID ||
      body.code === ErrorCodes.RECEIPT_IMAGE_INVALID
    );
  }

  /**
   * Wording for a receipt/fee failure — shared so the two dialogs and the
   * join/book calls that follow all say the same thing for the same code.
   */
  messageFor(err: unknown): string {
    // Receipt verification is rate-limited to 5/hour. Someone re-photographing
    // a rejected receipt can genuinely reach that, and "please try again" is
    // actively wrong there — trying again is exactly what won't work.
    if ((err as { status?: number })?.status === 429) {
      return 'Too many receipt checks. Please wait a while, or contact the salon directly.';
    }
    const body = (err as { error?: unknown })?.error;
    if (!isApiError(body)) {
      return "Couldn't check that receipt. Please try again.";
    }
    switch (body.code) {
      case ErrorCodes.RECEIPT_NOT_VALID:
        // Terminal for this attempt: no proof of payment, so the join cannot
        // proceed on this receipt.
        return "That receipt couldn't be verified. Check it shows the full amount, then try another photo.";
      case ErrorCodes.RECEIPT_INVALID:
        // Recoverable by paying again — receipts are single-use and expire.
        return 'That receipt has already been used or has expired. Please pay again and upload a new one.';
      case ErrorCodes.RECEIPT_IMAGE_INVALID:
        return "That image couldn't be read. Please upload a clear photo of your receipt.";
      case ErrorCodes.RECEIPT_REQUIRED:
        return 'This salon needs proof of payment before you can join.';
      case ErrorCodes.PAYMENT_DETAILS_REQUIRED:
        // The salon's own misconfiguration — say so plainly rather than
        // implying the customer did something wrong.
        return "This salon hasn't finished setting up payments. Please contact them directly.";
      default:
        return "Couldn't check that receipt. Please try again.";
    }
  }
}
