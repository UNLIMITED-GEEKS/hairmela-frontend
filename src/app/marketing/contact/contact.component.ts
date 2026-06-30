import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../core/toast/toast.service';

// Public contact form. For now it validates and logs the payload; the backend
// endpoint isn't built yet, so submit() is the single seam to swap a real API
// call into later (replace the console.log + toast with the HTTP call).
@Component({
  selector: 'app-contact',
  templateUrl: './contact.component.html',
  imports: [ReactiveFormsModule],
})
export class ContactComponent {
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);

  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const payload = this.form.getRawValue();

    // TODO: replace with the real contact API call once it exists.
    // eslint-disable-next-line no-console
    console.log('[contact] submission', payload);

    this.submitting.set(false);
    this.sent.set(true);
    this.form.reset();
    this._toast.success('Thanks — we got your message and will be in touch.');
  }

  protected sendAnother(): void {
    this.sent.set(false);
  }
}
