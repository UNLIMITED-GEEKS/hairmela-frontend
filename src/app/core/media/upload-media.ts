import { HttpClient } from '@angular/common/http';
import { Observable, defer } from 'rxjs';
import { Media } from '../../api/models/media';
import { StrictHttpResponse } from '../../api/strict-http-response';

export interface UploadMediaParams {
  file: File;
  entityType: 'USER' | 'SALON' | 'STAFF';
  entityId: string;
  type: 'PROFILE' | 'GALLERY';
}

const PATH = '/v1/media/upload';

/**
 * Hand-built replacement for the generated `mediaControllerUpload`.
 *
 * The generated RequestBuilder routes the file through `formDataValue()`,
 * which only keeps it as a file when `value instanceof Blob` holds — anything
 * else falls through to `new Blob([JSON.stringify(value)])`, silently turning
 * the photo into a few bytes of JSON. It also calls `formData.set(key, value)`
 * with no filename argument, so the part can go out without a `filename=` in
 * its Content-Disposition. Either way the server sees no usable file part.
 *
 * Here the file part is appended explicitly, with its filename, and read back
 * out of the FormData before the request is issued — so a body that doesn't
 * carry the file fails loudly here instead of arriving empty at the backend.
 *
 * Content-Type is deliberately not set: the browser must set it itself so the
 * multipart boundary it generates matches the body it serializes.
 */
export function uploadMedia(
  http: HttpClient,
  rootUrl: string,
  params: UploadMediaParams,
): Observable<StrictHttpResponse<Media>> {
  // defer: the guards below throw, and callers invoke this inside
  // OptimisticService.run()'s `request()`, which is called synchronously —
  // a sync throw would escape past the revert path and strand the optimistic
  // tile. Inside defer they surface as a normal observable error instead.
  return defer(() => {
    const { file, entityType, entityId, type } = params;

    if (!(file instanceof Blob) || file.size === 0) {
      throw new Error(
        `uploadMedia: no usable file (blob=${file instanceof Blob}, size=${file?.size})`,
      );
    }

    const body = new FormData();
    body.append('file', file, file.name);
    body.append('entityType', entityType);
    body.append('entityId', entityId);
    body.append('type', type);

    // Read the part back: this is the object that gets serialized, so a file
    // that didn't survive being appended is caught before anything is sent.
    const part = body.get('file');
    if (!(part instanceof Blob) || part.size !== file.size) {
      throw new Error(
        `uploadMedia: file part missing from body (size=${(part as Blob)?.size} want=${file.size})`,
      );
    }

    return http.post<Media>(`${rootUrl}${PATH}`, body, { observe: 'response' });
  }) as Observable<StrictHttpResponse<Media>>;
}
