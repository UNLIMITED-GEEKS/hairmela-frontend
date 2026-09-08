import { HttpClient } from '@angular/common/http';
import { Observable, switchMap, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiConfiguration } from '../../api/api-configuration';
import { Media } from '../../api/models/media';
import { publicMediaControllerPresignUpload } from '../../api/fn/media/public-media-controller-presign-upload';
import { mediaControllerAttach } from '../../api/fn/media/media-controller-attach';
import { mediaControllerUpload } from '../../api/fn/media/media-controller-upload';
import { publicMediaControllerAdHocUpload } from '../../api/fn/media/public-media-controller-ad-hoc-upload';

export const MAX_MEDIA_UPLOAD_BYTES = 5 * 1024 * 1024;

// Direct-to-R2: presign -> PUT -> attach. Anything not in this set (HEIC/HEIF)
// goes through a backend endpoint instead, which converts to JPEG server-side
// before storing.
const DIRECT_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const CONVERTED_UPLOAD_TYPES = ['image/heic', 'image/heif'];

export interface MediaUploadTarget {
  file: File;
  entityType: 'USER' | 'SALON' | 'STAFF';
  entityId: string;
  type: 'PROFILE' | 'GALLERY';
}

/**
 * Uploads an image and attaches it to the given entity, returning the
 * resulting Media record. Used by every profile/logo/gallery upload
 * (salon, staff, and — once one exists — user) so the R2-vs-conversion
 * routing and validation live in exactly one place.
 *
 * NOT used by comment images or booking-fee receipts — see uploadAdHocImage
 * below. Those have no owning entity, so /media/attach and /media/upload both
 * refuse them (attach's entityId is required and unauthorized for COMMENT/
 * RECEIPT; upload's entityType enum doesn't include them at all), and neither
 * should create a Media row a salon's gallery could pick up.
 */
export function uploadMedia(
  http: HttpClient,
  apiConfig: ApiConfiguration,
  target: MediaUploadTarget,
): Observable<Media> {
  const { file } = target;

  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    return throwError(() => new Error('File is larger than 5 MB.'));
  }

  if (DIRECT_UPLOAD_TYPES.includes(file.type)) {
    return _uploadDirect(http, apiConfig, target);
  }
  if (CONVERTED_UPLOAD_TYPES.includes(file.type)) {
    return _uploadForConversion(http, apiConfig, target);
  }
  return throwError(() => new Error('Unsupported file type.'));
}

/** JPEG/PNG/WebP/AVIF: presign -> PUT the raw file to R2 -> attach. */
function _uploadDirect(
  http: HttpClient,
  apiConfig: ApiConfiguration,
  { file, entityType, entityId, type }: MediaUploadTarget,
): Observable<Media> {
  return publicMediaControllerPresignUpload(http, apiConfig.rootUrl, {
    body: {
      filename: file.name,
      // Narrowed by DIRECT_UPLOAD_TYPES above, so this is always one of the
      // presign DTO's accepted direct-upload content types.
      contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif',
      fileSize: file.size,
      entityType,
      entityId,
      type,
    },
  }).pipe(
    map((r) => r.body),
    switchMap((presign) =>
      // Raw file, exactly the returned headers, no auth — this goes straight
      // to R2, not our own API, and the interceptor must never attach a JWT
      // or guest token to a request signed for anonymous upload.
      http
        .put(presign.uploadUrl, file, {
          headers: presign.headers as Record<string, string>,
          responseType: 'text',
        })
        .pipe(
          switchMap(() =>
            mediaControllerAttach(http, apiConfig.rootUrl, {
              body: {
                publicId: presign.publicId,
                url: presign.url,
                entityType,
                entityId,
                type,
              },
            }),
          ),
        ),
    ),
    map((r) => r.body),
  );
}

/** HEIC/HEIF: backend multipart endpoint, which converts to JPEG before storing. */
function _uploadForConversion(
  http: HttpClient,
  apiConfig: ApiConfiguration,
  { file, entityType, entityId, type }: MediaUploadTarget,
): Observable<Media> {
  return mediaControllerUpload(http, apiConfig.rootUrl, {
    body: { file, entityType, entityId, type },
  }).pipe(map((r) => r.body));
}

export interface AdHocImageUpload {
  url: string;
  publicId: string;
}

/**
 * Uploads a one-off image with no owning entity — a comment photo or a
 * booking-fee receipt — and returns the bare url/publicId pair the caller
 * embeds directly in its own POST (CreateCommentDto/VerifyReceiptDto), rather
 * than a Media record. Never creates a Media row, so this can't leak into a
 * salon's gallery or a user's profile history the way uploadMedia() would.
 *
 * JPEG/PNG/WebP/AVIF still go direct-to-R2 via presign, skipping our own API
 * entirely for the actual bytes — cheaper, and the browser never has to send
 * the image to us at all. HEIC/HEIF can't take that path: the presign flow
 * PUTs straight from the browser to R2, so the backend never sees the bytes
 * and has nothing to transcode, and most non-Safari browsers can't render
 * HEIC — so those go through the ad-hoc-upload endpoint instead, which
 * converts to JPEG server-side and returns the resulting URL (no auth
 * required, matching the presign endpoint).
 */
export function uploadAdHocImage(
  http: HttpClient,
  apiConfig: ApiConfiguration,
  file: File,
  kind: 'COMMENT' | 'RECEIPT',
): Observable<AdHocImageUpload> {
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    return throwError(() => new Error('File is larger than 5 MB.'));
  }

  if (DIRECT_UPLOAD_TYPES.includes(file.type)) {
    return publicMediaControllerPresignUpload(http, apiConfig.rootUrl, {
      body: {
        filename: file.name,
        contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif',
        fileSize: file.size,
        entityType: kind,
        // type is required by the DTO regardless of entityType; GALLERY is
        // the value the backend's own ad-hoc example uses for COMMENT/RECEIPT
        // and carries no other meaning for a kind with no gallery.
        type: 'GALLERY',
      },
    }).pipe(
      map((r) => r.body),
      switchMap((presign) =>
        http
          .put(presign.uploadUrl, file, {
            headers: presign.headers as Record<string, string>,
            responseType: 'text',
          })
          .pipe(map(() => ({ url: presign.url, publicId: presign.publicId }))),
      ),
    );
  }

  if (CONVERTED_UPLOAD_TYPES.includes(file.type)) {
    return publicMediaControllerAdHocUpload(http, apiConfig.rootUrl, {
      body: { file, kind },
    }).pipe(map((r) => ({ url: r.body.url, publicId: r.body.providerId })));
  }

  return throwError(() => new Error('Unsupported file type.'));
}
