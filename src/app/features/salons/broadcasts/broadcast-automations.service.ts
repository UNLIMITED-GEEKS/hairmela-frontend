import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { BroadcastAudienceResponseDto } from '../../../api/models/broadcast-audience-response-dto';
import { BroadcastAutomationResponseDto } from '../../../api/models/broadcast-automation-response-dto';
import { CreateBroadcastAutomationDto } from '../../../api/models/create-broadcast-automation-dto';
import { UpdateBroadcastAutomationDto } from '../../../api/models/update-broadcast-automation-dto';
import { salonBroadcastAutomationsControllerCreate } from '../../../api/fn/chat/salon-broadcast-automations-controller-create';
import { salonBroadcastAutomationsControllerGetAudience } from '../../../api/fn/chat/salon-broadcast-automations-controller-get-audience';
import { salonBroadcastAutomationsControllerList } from '../../../api/fn/chat/salon-broadcast-automations-controller-list';
import { salonBroadcastAutomationsControllerRemove } from '../../../api/fn/chat/salon-broadcast-automations-controller-remove';
import { salonBroadcastAutomationsControllerUpdate } from '../../../api/fn/chat/salon-broadcast-automations-controller-update';

// Max page size the API allows — an owner is capped at 5 *active* automations,
// but paused and finished ones stay in the list, so don't assume one page of 20.
const LIST_LIMIT = 100;

@Injectable({ providedIn: 'root' })
export class BroadcastAutomationsService {
  private readonly _http = inject(HttpClient);
  private readonly _root = inject(ApiConfiguration).rootUrl;

  getAudience(salonId: string): Observable<BroadcastAudienceResponseDto> {
    return salonBroadcastAutomationsControllerGetAudience(this._http, this._root, { salonId }).pipe(
      map((r) => r.body),
    );
  }

  list(salonId: string): Observable<BroadcastAutomationResponseDto[]> {
    return salonBroadcastAutomationsControllerList(this._http, this._root, {
      salonId,
      page: 1,
      limit: LIST_LIMIT,
    }).pipe(map((r) => r.body.data ?? []));
  }

  create(salonId: string, body: CreateBroadcastAutomationDto): Observable<BroadcastAutomationResponseDto> {
    return salonBroadcastAutomationsControllerCreate(this._http, this._root, { salonId, body }).pipe(
      map((r) => r.body),
    );
  }

  update(
    salonId: string,
    automationId: string,
    body: UpdateBroadcastAutomationDto,
  ): Observable<BroadcastAutomationResponseDto> {
    return salonBroadcastAutomationsControllerUpdate(this._http, this._root, {
      salonId,
      automationId,
      body,
    }).pipe(map((r) => r.body));
  }

  delete(salonId: string, automationId: string): Observable<void> {
    return salonBroadcastAutomationsControllerRemove(this._http, this._root, { salonId, automationId }).pipe(
      map(() => undefined),
    );
  }
}
