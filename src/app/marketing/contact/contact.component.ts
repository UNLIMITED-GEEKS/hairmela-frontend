import { Component, inject, signal, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../core/toast/toast.service';
import { FieldErrorComponent } from '../../shared/components/field-error/field-error.component';
import { ApiConfiguration } from '../../api/api-configuration';
import { contactControllerSubmit } from '../../api/fn/contact/contact-controller-submit';
import { scrollToFirstInvalidControl } from '../../core/utils/scroll-to-first-invalid';
import { AppPlatformService } from '../../core/native/app-platform.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { RoutePath } from '../../core/routing/route-paths';
import { PhoneInputComponent } from '../../shared/components/phone-input/phone-input.component';

// Public contact form — submits to POST /v1/contact.
@Component({
  selector: 'app-contact',
  templateUrl: './contact.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent, PageHeaderComponent, PhoneInputComponent],
})
export class ContactComponent {
  protected readonly platform = inject(AppPlatformService);
  protected readonly homeLink = RoutePath.root();

  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);

  protected readonly form = this._fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.maxLength(30)]],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._formEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }

    this.submitting.set(true);
    const payload = this.form.getRawValue();

    contactControllerSubmit(this._http, this._apiConfig.rootUrl, { body: payload }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.sent.set(true);
        this.form.reset();
        this._toast.success('Thanks — we got your message and will be in touch.');
      },
      error: () => {
        this.submitting.set(false);
        this._toast.error('Something went wrong sending your message. Please try again.');
      },
    });
  }

  protected sendAnother(): void {
    this.sent.set(false);
  }
}
