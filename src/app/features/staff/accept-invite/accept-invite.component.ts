import { Component, OnInit, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ResolveInviteDto } from '../../../api/models/resolve-invite-dto';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { PasswordToggleDirective } from '../../../shared/directives/password-toggle.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { InviteResolveService } from './invite-resolve.service';
import { RouteQueryParam, RoutePath } from '../../../core/routing/route-paths';

// The view is a state machine over the resolve result + session + auth mode.
type View =
  | 'loading'      // resolving the token
  | 'invalid'      // no token, or 401 expired/invalid
  | 'notFound'     // invite no longer exists
  | 'alreadyJoined'// status ACCEPTED
  | 'login'        // PENDING + not logged in + isRegistered
  | 'register'     // PENDING + not logged in + !isRegistered
  | 'accepting'    // calling accept
  | 'accepted'     // success
  | 'error';       // accept failed (e.g. 404 wrong account)

@Component({
  selector: 'app-accept-invite',
  imports: [ReactiveFormsModule, RouterLink, PasswordToggleDirective, FieldErrorComponent],
  templateUrl: './accept-invite.component.html',
})
export class AcceptInviteComponent implements OnInit {
  private readonly _inviteResolve = inject(InviteResolveService);
  private readonly _auth = inject(AuthService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly loginLink = RoutePath.login();

  protected readonly view = signal<View>('loading');
  protected readonly invite = signal<ResolveInviteDto | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // Email is prefilled and locked on both forms — accept matches by the logged-in
  // email, so authenticating as a different account would 404. We keep the input
  // editable (not readonly — that confuses password managers into saving the
  // wrong field as the username) and instead revert any edits in _lockEmail().
  protected readonly loginForm = this._fb.nonNullable.group({
    email: [{ value: '', disabled: false }, [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly registerForm = this._fb.nonNullable.group({
    email: [{ value: '', disabled: false }, [Validators.required, Validators.email]],
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    password: ['', [Validators.required, Validators.minLength(8)]],
    phone: ['', Validators.required],
  });

  private get _token(): string {
    return this._route.snapshot.queryParamMap.get(RouteQueryParam.TOKEN) ?? '';
  }

  ngOnInit(): void {
    if (!this._token) {
      this.view.set('invalid');
      return;
    }
    this._inviteResolve.resolve(this._token)
      .subscribe({
        next: (res) => this._onResolved(res.body),
        error: (err) => this.view.set(err?.status === 401 ? 'invalid' : 'notFound'),
      });
  }

  private _onResolved(dto: ResolveInviteDto): void {
    this.invite.set(dto);
    // Branch on STATUS first — never drop a cancelled/expired invite into a login screen.
    if (dto.status === 'NOT_FOUND') { this.view.set('notFound'); return; }
    if (dto.status === 'ACCEPTED') { this.view.set('alreadyJoined'); return; }

    // PENDING — branch on session.
    if (this._currentUser.user()) {
      this._accept();
      return;
    }
    // Prefill + lock the email on whichever form we show.
    const form = dto.isRegistered ? this.loginForm : this.registerForm;
    form.controls.email.setValue(dto.email);
    this._lockEmail(form, dto.email);
    this.view.set(dto.isRegistered ? 'login' : 'register');
  }

  // Keeps the email field editable-looking (so password managers treat it as the
  // username) but immovable — any edit is reverted to the invite email.
  private _lockEmail(form: FormGroup, email: string): void {
    form.controls['email'].valueChanges
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((value) => {
        if (value !== email) {
          form.controls['email'].setValue(email, { emitEvent: false });
        }
      });
  }

  protected submitLogin(): void {
    const dto = this.invite();
    if (!dto || this.loginForm.invalid || this.submitting()) return;
    this.errorMessage.set(null);
    this.submitting.set(true);
    this._auth.login({ email: dto.email, password: this.loginForm.controls.password.value }).subscribe({
      next: () => { this.submitting.set(false); this._accept(); },
      error: (err) => {
        this.submitting.set(false);
        const body = err?.error;
        this.errorMessage.set(
          isApiError(body) && body.code === ErrorCodes.INVALID_CREDENTIALS
            ? 'Invalid password for this account.'
            : 'Something went wrong. Please try again.',
        );
      },
    });
  }

  protected submitRegister(): void {
    const dto = this.invite();
    if (!dto || this.registerForm.invalid || this.submitting()) return;
    this.errorMessage.set(null);
    this.submitting.set(true);
    const v = this.registerForm.getRawValue();
    this._auth.register({
      email: dto.email,
      password: v.password,
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone.trim(),
    }).pipe(
      switchMap(() => this._auth.login({ email: dto.email, password: v.password })),
    ).subscribe({
      next: () => { this.submitting.set(false); this._accept(); },
      error: (err) => {
        this.submitting.set(false);
        const body = err?.error;
        this.errorMessage.set(
          isApiError(body) && body.code === ErrorCodes.EMAIL_ALREADY_REGISTERED
            ? 'An account with this email already exists — sign in instead.'
            : 'Something went wrong. Please try again.',
        );
      },
    });
  }

  protected decline(): void {
    const dto = this.invite();
    if (!dto || this.submitting()) return;
    this.submitting.set(true);
    this._inviteResolve.decline(dto.salonId).subscribe({
      next: () => this._router.navigate(RoutePath.dashboard()),
      error: () => this._router.navigate(RoutePath.dashboard()),
    });
  }

  // Idempotent — safe to call whether the invite was just activated or already
  // accepted. 404 means no pending invite for this account (wrong account).
  private _accept(): void {
    const dto = this.invite();
    if (!dto) return;
    this.view.set('accepting');
    this._inviteResolve.accept(dto.salonId).subscribe({
      next: () => this.view.set('accepted'),
      error: (err) => {
        if (err?.status === 404) {
          this.errorMessage.set('No pending invite for this account. You may have signed in with the wrong email.');
        } else {
          this.errorMessage.set('Could not accept the invite. Please try again.');
        }
        this.view.set('error');
      },
    });
  }

  // Lands inside the salon just joined (SalonContextService's route-derived
  // effect persists it as the last-visited salon automatically) rather than
  // the dashboard — matches "You've been added to {{ salonName }}" above.
  protected goToDashboard(): void {
    const dto = this.invite();
    this._router.navigate(dto ? RoutePath.salon(dto.salonId) : RoutePath.dashboard());
  }
}
