import { HttpClient } from '@angular/common/http';
import { Observable, from, switchMap, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiConfiguration } from '../../api/api-configuration';
import { Media } from '../../api/models/media';
import { publicMediaControllerPresignUpload } from '../../api/fn/media/public-media-controller-presign-upload';
import { mediaControllerAttach } from '../../api/fn/media/media-controller-attach';
import { mediaControllerUpload } from '../../api/fn/media/media-controller-upload';
import { publicMediaControllerAdHocUpload } from '../../api/fn/media/public-media-controller-ad-hoc-upload';
import { uploadToCloudinary } from './cloudinary-upload';

export const MAX_MEDIA_UPLOAD_BYTES = 5 * 1024 * 1024;

// FIXME: uploads from an iPhone fail against every R2 path in this file —
// both the direct-to-R2 raw PUT and the backend multipart endpoints — with
// "the image uploaded is invalid or too large" (the exact text of /media/
// attach's own 400). Root cause not yet found: it reproduces even for the
// raw-file PUT, which has no multipart body and hits R2's origin, not ours —
// so this is NOT fully explained by the known service-worker-eats-multipart-
// body bug that justified the old Cloudinary code (that bug is scoped to
// multipart requests to OUR OWN origin, and doesn't obviously reach a PUT to
// a different origin with no boundary at all). Needs a real device/Safari
// Web Inspector session to find the actual cause.
//
// UNTIL THAT'S FOUND: every platform (not just iOS) is routed to Cloudinary,
// not only the affected one — a deliberate, temporary, blanket rollback
// rather than a per-platform branch, so there is exactly one upload path to
// reason about while this is unresolved. The R2/presign code below is NOT
// deleted — _uploadDirect/_uploadForConversion and their ad-hoc-upload
// equivalent stay intact and unreachable, ready to come back once iOS is
// fixed, rather than being rewritten twice.
const FORCE_CLOUDINARY_ALL_PLATFORMS = true;

// Direct-to-R2: presign -> PUT -> attach. Anything not in this set (HEIC/HEIF)
// goes through a backend endpoint instead, which converts to JPEG server-side
// before storing.
const DIRECT_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const CONVERTED_UPLOAD_TYPES = ['image/heic', 'image/heif'];

// R2 has no Cloudinary-style on-the-fly transform: whatever is uploaded is
// exactly what MediaUrlPipe serves at every size (avatar thumb through the
// gallery lightbox), since there is no per-request resize at read time for
// these URLs. So the ceiling here has to cover the LARGEST thing ever
// displayed from one of these files, not just an average case — matches
// MediaUrlPipe's own 'full' cap (1200px) with headroom for a device pixel
// ratio above 1, rather than trying to keep a separate size per display
// context with only one uploaded file to serve them all from.
const MAX_DIMENSION_PX = 1600;
const RESIZE_JPEG_QUALITY = 0.82;

/**
 * Downscales an oversized image before it ever leaves the browser, since
 * nothing on the R2 side will do it later. A no-op (returns the original
 * file) whenever there's nothing productive to do:
 *  - already within MAX_DIMENSION_PX on both axes — resizing would either do
 *    nothing or upscale, and upscaling only adds bytes for no visible gain.
 *  - HEIC/HEIF — most browsers cannot decode these into an <img>/canvas at
 *    all (the same reason the backend converts them server-side instead),
 *    so there is no client-side path here; the file goes to
 *    ad-hoc-upload/mediaControllerUpload exactly as picked, at whatever
 *    size the backend's own conversion step produces.
 *  - decoding fails for any other reason (corrupt file, an exotic ICC
 *    profile some engines choke on) — better to upload the original than to
 *    block the whole upload on a resize step that was only ever a size
 *    optimization, not a correctness requirement.
 *
 * PNG in, PNG out; anything else (JPEG/WebP/AVIF) is re-encoded as JPEG.
 * Keeping PNG's format is deliberate: flattening every PNG to JPEG would
 * silently drop transparency for the rare PNG that actually has any (a
 * screenshot pasted into a comment, say), and PNG's own re-encode at the
 * same pixel count already recompresses losslessly, so there is still a
 * size win without that risk.
 */
async function _resizeIfNeeded(file: File): Promise<File> {
  if (CONVERTED_UPLOAD_TYPES.includes(file.type)) return file;

  // imageOrientation MUST be explicit, not left to the default. The spec
  // default ('from-image', decode per EXIF) only became WebKit's real
  // behaviour in ~August 2022 — this app's own iOS 15 floor (kept
  // deliberately low for the iPhone 7, see .browserslistrc) predates that
  // fix, so an older Safari's UNSPECIFIED-default decode can ignore EXIF
  // orientation entirely and hand back the sensor's raw, unrotated pixels.
  // A canvas re-encode then BAKES that wrong orientation permanently into
  // the file, which plain <img> rendering elsewhere would have gotten right
  // by honoring EXIF itself — so getting this wrong here is a regression
  // resize introduces, not a pre-existing bug.
  //
  // If the engine rejects the option outright, there is no way from here to
  // tell whether its OWN default decodes correctly — some old WebKit builds
  // are exactly the ones that don't. Skipping resize (returning the original
  // file, whose EXIF tag <img> still honors normally) is the only choice that
  // can't bake in a wrong rotation; silently falling back to an options-less
  // decode would risk "successfully" resizing a photo sideways.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  try {
    const { width, height } = bitmap;
    const longestEdge = Math.max(width, height);
    if (longestEdge <= MAX_DIMENSION_PX) return file;

    const scale = MAX_DIMENSION_PX / longestEdge;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, RESIZE_JPEG_QUALITY),
    );
    if (!blob) return file;

    // Extension follows the actual output type, not the original filename —
    // a re-encoded .png-named file containing JPEG bytes would round-trip
    // through the backend's own content-sniffing wrong.
    const newName =
      outputType === file.type
        ? file.name
        : file.name.replace(/\.[^.]+$/, '') + (outputType === 'image/jpeg' ? '.jpg' : '.png');
    return new File([blob], newName, { type: outputType, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

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
  const { file, entityType, entityId, type } = target;

  if (!DIRECT_UPLOAD_TYPES.includes(file.type) && !CONVERTED_UPLOAD_TYPES.includes(file.type)) {
    return throwError(() => new Error('Unsupported file type.'));
  }

  // FIXME: see the module-level FIXME above — every platform goes through
  // Cloudinary until the iOS/R2 failure is root-caused.
  if (FORCE_CLOUDINARY_ALL_PLATFORMS) {
    if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
      return throwError(() => new Error('File is larger than 5 MB.'));
    }
    return uploadToCloudinary(http, file).pipe(
      switchMap((uploaded) =>
        mediaControllerAttach(http, apiConfig.rootUrl, {
          body: {
            publicId: uploaded.public_id,
            url: uploaded.secure_url,
            entityType,
            entityId,
            type,
          },
        }),
      ),
      map((r) => r.body),
    );
  }

  return from(_resizeIfNeeded(file)).pipe(
    switchMap((resized) => {
      if (resized.size > MAX_MEDIA_UPLOAD_BYTES) {
        return throwError(() => new Error('File is larger than 5 MB.'));
      }
      const resizedTarget = { file: resized, entityType, entityId, type };
      return DIRECT_UPLOAD_TYPES.includes(resized.type)
        ? _uploadDirect(http, apiConfig, resizedTarget)
        : _uploadForConversion(http, apiConfig, resizedTarget);
    }),
  );
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
  if (!DIRECT_UPLOAD_TYPES.includes(file.type) && !CONVERTED_UPLOAD_TYPES.includes(file.type)) {
    return throwError(() => new Error('Unsupported file type.'));
  }

  // FIXME: see the module-level FIXME above — every platform goes through
  // Cloudinary until the iOS/R2 failure is root-caused.
  if (FORCE_CLOUDINARY_ALL_PLATFORMS) {
    if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
      return throwError(() => new Error('File is larger than 5 MB.'));
    }
    return uploadToCloudinary(http, file).pipe(
      map((uploaded) => ({ url: uploaded.secure_url, publicId: uploaded.public_id })),
    );
  }

  return from(_resizeIfNeeded(file)).pipe(
    switchMap((resized) => {
      if (resized.size > MAX_MEDIA_UPLOAD_BYTES) {
        return throwError(() => new Error('File is larger than 5 MB.'));
      }

      if (DIRECT_UPLOAD_TYPES.includes(resized.type)) {
        return publicMediaControllerPresignUpload(http, apiConfig.rootUrl, {
          body: {
            filename: resized.name,
            contentType: resized.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif',
            fileSize: resized.size,
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
              .put(presign.uploadUrl, resized, {
                headers: presign.headers as Record<string, string>,
                responseType: 'text',
              })
              .pipe(map(() => ({ url: presign.url, publicId: presign.publicId }))),
          ),
        );
      }

      return publicMediaControllerAdHocUpload(http, apiConfig.rootUrl, {
        body: { file: resized, kind },
      }).pipe(map((r) => ({ url: r.body.url, publicId: r.body.providerId })));
    }),
  );
}
