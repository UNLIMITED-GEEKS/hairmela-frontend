/**
 * Scrolls the LAST row of a repeating list into view after one is added.
 *
 * WHY: the party/member lists in the join, booking and add-client dialogs grow
 * downward inside a fixed-height scrolling panel. Past two or three rows the
 * new one appears below the fold, so "+ Add another person" looks like it did
 * nothing — the same failure scrollToFirstInvalidControl exists to fix on
 * submit, but on add.
 *
 * Call it from an afterNextRender: the row does not exist in the DOM until
 * Angular has rendered the FormArray change.
 *
 * Takes the element that DIRECTLY wraps the rows and uses its last child,
 * rather than a selector.
 *
 * An earlier version queried '[formGroupName]' and silently matched nothing:
 * every one of these lists writes `[formGroupName]="i"` as a BINDING, and
 * Angular does not leave a matching attribute in the DOM. (The sibling helper
 * scrollToFirstInvalidControl gets away with '[formControlName]' only because
 * those templates write it statically.) Structure is the reliable signal here;
 * attribute presence is not.
 *
 * @param rowsEl  The element whose children ARE the rows (the formArrayName
 *                container), not the outer scroll panel.
 */
export function scrollToNewRow(rowsEl: HTMLElement | null | undefined): void {
  if (!rowsEl) return;

  const last = rowsEl.lastElementChild as HTMLElement | null;
  if (!last) return;

  // block:'nearest' rather than 'center': the new row is at the bottom of the
  // list, and centring it would push the rows above off-screen — the user
  // loses sight of what they already entered. 'nearest' scrolls the minimum
  // needed to reveal it, keeping the context above intact.
  //
  // Deliberately does NOT focus the new row's first field: on a phone that
  // raises the keyboard, which then covers the row this just scrolled into
  // view — the opposite of the intent. The user taps where they want to type.
  last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
