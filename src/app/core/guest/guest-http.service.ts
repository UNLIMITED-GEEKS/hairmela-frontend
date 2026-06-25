import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { ApiConfiguration } from '../../api/api-configuration';
import { GuestStore } from './guest-store';
import { QueueEntry } from '../../api/models/queue-entry';
import { AddMembersDto } from '../../api/models/add-members-dto';

@Injectable({ providedIn: 'root' })
export class GuestHttpService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _guestStore = inject(GuestStore);

  getGuestEntries(): Observable<QueueEntry[]> {
    return this._http.get<QueueEntry[]>(
      `${this._apiConfig.rootUrl}/v1/queues/guest-entries`,
      { headers: this._authHeaders(), observe: 'response' },
    ).pipe(
      filter((r): r is HttpResponse<QueueEntry[]> => r instanceof HttpResponse),
      map((r) => r.body ?? []),
    );
  }

  addMembers(salonId: string, queueId: string, entryId: string, body: AddMembersDto): Observable<QueueEntry> {
    return this._http.post<QueueEntry>(
      `${this._apiConfig.rootUrl}/v1/salons/${salonId}/queues/${queueId}/walk-in/entries/${entryId}/members`,
      body,
      { headers: this._authHeaders(), observe: 'response' },
    ).pipe(
      filter((r): r is HttpResponse<QueueEntry> => r instanceof HttpResponse),
      map((r) => r.body!),
    );
  }

  leaveQueue(salonId: string, queueId: string, entryId: string): Observable<void> {
    return this._http.delete<void>(
      `${this._apiConfig.rootUrl}/v1/salons/${salonId}/queues/${queueId}/walk-in/${entryId}`,
      { headers: this._authHeaders(), observe: 'response' },
    ).pipe(
      filter((r): r is HttpResponse<void> => r instanceof HttpResponse),
      map(() => undefined),
    );
  }

  private _authHeaders(): HttpHeaders {
    const token = this._guestStore.getToken() ?? '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
