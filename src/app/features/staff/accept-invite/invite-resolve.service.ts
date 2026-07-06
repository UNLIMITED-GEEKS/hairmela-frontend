import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { ResolveInviteDto } from '../../../api/models/resolve-invite-dto';
import { StrictHttpResponse } from '../../../api/strict-http-response';
import { inviteResolveControllerResolveInvite } from '../../../api/fn/staff/invite-resolve-controller-resolve-invite';
import { staffInviteControllerAccept } from '../../../api/fn/staff/staff-invite-controller-accept';
import { staffInviteControllerDecline } from '../../../api/fn/staff/staff-invite-controller-decline';

@Injectable({ providedIn: 'root' })
export class InviteResolveService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  resolve(token: string): Observable<StrictHttpResponse<ResolveInviteDto>> {
    return inviteResolveControllerResolveInvite(this._http, this._apiConfig.rootUrl, { token });
  }

  accept(salonId: string): Observable<StrictHttpResponse<void>> {
    return staffInviteControllerAccept(this._http, this._apiConfig.rootUrl, { salonId });
  }

  decline(salonId: string): Observable<StrictHttpResponse<void>> {
    return staffInviteControllerDecline(this._http, this._apiConfig.rootUrl, { salonId });
  }
}
