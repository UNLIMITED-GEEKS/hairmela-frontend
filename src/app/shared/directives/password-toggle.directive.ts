import { Directive, ElementRef, OnInit, Renderer2, inject, signal } from '@angular/core';

// Adds a show/hide eye toggle to a password <input>. Apply `appPasswordToggle`
// to the input — the directive wraps it in a relative container and injects the
// button, so the eye markup lives in exactly one place (no per-field copy-paste).
// Add right padding (e.g. pr-10) on the input so text doesn't run under the icon.
@Directive({
  selector: 'input[appPasswordToggle]',
})
export class PasswordToggleDirective implements OnInit {
  private readonly _el = inject(ElementRef<HTMLInputElement>);
  private readonly _renderer = inject(Renderer2);

  private readonly _visible = signal(false);

  private readonly _eyeIcon =
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
    'd="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>' +
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
    'd="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';

  private readonly _eyeOffIcon =
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
    'd="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>';

  ngOnInit(): void {
    const input = this._el.nativeElement;
    const parent = this._renderer.parentNode(input);

    // Wrap the input in a relatively-positioned container.
    const wrapper = this._renderer.createElement('div');
    this._renderer.addClass(wrapper, 'relative');
    this._renderer.insertBefore(parent, wrapper, input);
    this._renderer.appendChild(wrapper, input);

    // Leave room for the icon so typed text doesn't sit under it.
    this._renderer.addClass(input, 'pr-10');

    const button = this._renderer.createElement('button');
    this._renderer.setAttribute(button, 'type', 'button');
    this._renderer.setAttribute(button, 'tabindex', '-1');
    this._renderer.setAttribute(button, 'aria-label', 'Show password');
    this._renderer.setProperty(
      button,
      'className',
      'absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600',
    );
    this._renderer.appendChild(wrapper, button);
    this._renderer.listen(button, 'click', () => this._toggle(input, button));

    this._render(button);
  }

  private _toggle(input: HTMLInputElement, button: HTMLElement): void {
    this._visible.update((v) => !v);
    const visible = this._visible();
    this._renderer.setAttribute(input, 'type', visible ? 'text' : 'password');
    this._renderer.setAttribute(button, 'aria-label', visible ? 'Hide password' : 'Show password');
    this._render(button);
  }

  private _render(button: HTMLElement): void {
    button.innerHTML =
      `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">` +
      `${this._visible() ? this._eyeOffIcon : this._eyeIcon}</svg>`;
  }
}
