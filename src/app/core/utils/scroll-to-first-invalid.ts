/**
 * Scrolls the first invalid field of a submitted form into view and focuses it.
 *
 * WHY THIS EXISTS: the long forms (create-salon, salon-settings, service-form)
 * block submit on `form.invalid` and call markAllAsTouched(). If the offending
 * field is below the fold, that reads as the button doing nothing at all.
 *
 * DOM ORDER, NOT MODEL ORDER — this is the whole design.
 * The obvious approach is to walk the FormGroup and find the first invalid
 * control. It is wrong here: create-salon's model declares `address` fourth,
 * while the template renders referralCode, currency and timezone before it. A
 * model-order walk would scroll PAST errors the user can already see. Querying
 * the DOM returns elements in document order, which is the order the user
 * actually perceives.
 *
 * Reading validity from `ng-invalid` (which Angular puts on every invalid
 * control's host element) rather than from the form model also means nested
 * groups and FormArrays need no special handling — the DOM is already flat, so
 * `address.country` and `operatingHours.3.startTime` are found the same way as
 * a top-level control.
 *
 * STATELESS BY CONSTRUCTION. Nothing is remembered between calls. Every submit
 * re-queries the live DOM and answers "what is the first invalid field RIGHT
 * NOW". Fix one error, submit again, and it finds the next one on its own. A
 * stored error list would go stale on the next keystroke and need invalidating.
 */
export function scrollToFirstInvalidControl(formEl: HTMLElement | null | undefined): void {
  if (!formEl) return;

  const candidates = formEl.querySelectorAll<HTMLElement>('[formControlName].ng-invalid');

  for (const el of Array.from(candidates)) {
    // Skip anything with no layout box — a control inside a collapsed section
    // or an @if'd-out branch is invalid but unreachable, and scrolling to it
    // would land on nothing. Fall through to the next one instead.
    if (el.offsetParent === null) continue;

    // ALREADY VISIBLE — focus it, but do not scroll. Short forms (login,
    // forgot-password, invite-staff) fit entirely on screen, so the field the
    // user needs is already in front of them; centring it would be an
    // unrequested jump that reads as a glitch. Only move the page when the
    // field genuinely cannot be seen, which is the case this exists for.
    if (!isFullyVisible(el)) {
      // block:'center' rather than 'start': a field scrolled flush to the top
      // sits under any sticky header, and its error message (rendered BELOW
      // the input) is what the user actually needs to read.
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // preventScroll because the smooth scroll above is already in flight —
    // focus() would otherwise jump instantly to the element and cancel it,
    // producing a snap instead of a scroll.
    el.focus({ preventScroll: true });
    return;
  }
}

/**
 * Whether the element's box sits entirely within the viewport.
 *
 * Deliberately strict — a field half-cut by the fold is "visible" to
 * getBoundingClientRect but its error message underneath may not be, and that
 * message is the whole point of scrolling there.
 */
function isFullyVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= (window.innerHeight || 0);
}
