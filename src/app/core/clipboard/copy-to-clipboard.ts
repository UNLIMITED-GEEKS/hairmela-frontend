import { ToastService } from '../toast/toast.service';

/**
 * Copies a value and reports the outcome.
 *
 * navigator.clipboard is undefined on insecure origins and can reject inside
 * some embedded webviews, so both cases are handled: the message says the copy
 * did not happen rather than appearing to succeed, and the value stays on
 * screen for the user to read manually.
 *
 * `label` is used in the message ("Referral code copied."), so pass what the
 * user would call the thing, capitalised as it should appear.
 */
export function copyToClipboard(toast: ToastService, value: string, label: string): void {
  if (!navigator.clipboard) {
    toast.info(`Copy isn't available here — please copy the ${label.toLowerCase()} manually.`);
    return;
  }
  navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied.`),
    () => toast.info(`Couldn't copy — please copy the ${label.toLowerCase()} manually.`),
  );
}
