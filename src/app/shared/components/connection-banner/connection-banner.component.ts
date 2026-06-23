import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';

@Component({
  selector: 'app-connection-banner',
  templateUrl: './connection-banner.component.html',
})
export class ConnectionBannerComponent {
  private readonly _socket = inject(QueueSocketService);
  protected readonly connectionState = toSignal(this._socket.connectionState$, { initialValue: 'connected' });
}
