import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

type VerifyState = 'verifying' | 'success' | 'failed' | 'no-token';

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
  private readonly _auth = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);

  protected readonly state = signal<VerifyState>('verifying');

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.state.set('no-token');
      return;
    }

    this._auth.verifyEmail(token).subscribe({
      next: () => this.state.set('success'),
      error: () => this.state.set('failed'),
    });
  }
}
