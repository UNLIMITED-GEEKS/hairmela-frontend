import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../../environments/environment';

// Named Cloudinary delivery sizes, not raw pixel args in templates — every
// call site says WHAT it's rendering (an avatar, a grid tile) rather than a
// number someone has to cross-check against the CSS. q_auto:eco/f_auto let
// Cloudinary pick the best compression/format (WebP/AVIF where the browser
// supports it) per request — this is most of the MB savings, more than the
// resize alone.
//
// thumb/grid/hero use c_fill + matching w/h: crops to exactly that box, since
// those are all fixed-aspect containers (avatars, square grid tiles).
//
// full uses c_limit, not c_fill and not a passthrough: a phone photo is
// routinely 3000px+ on its long edge, and no screen shows anywhere near that
// many pixels even full-bleed — but the gallery-modal lightbox must show the
// WHOLE photo at its real aspect ratio, so it can't be cropped to a fixed box
// like the others. c_limit caps the longest edge without cropping or
// upscaling a smaller original.
const SIZE_TRANSFORMS = {
  thumb: 'c_fill,w_200,h_200,q_auto:eco,f_auto',
  grid: 'c_fill,w_400,h_400,q_auto:eco,f_auto',
  hero: 'c_fill,w_800,q_auto:eco,f_auto',
  full: 'c_limit,w_1200,h_1200,q_auto:eco,f_auto',
} as const;

export type MediaUrlSize = keyof typeof SIZE_TRANSFORMS;

// Local dev's backend returns relative media paths (e.g. "/uploads/x.jpeg")
// instead of the full Cloudinary URL prod always returns — this resolves
// that gap so templates never need to special-case the environment. An
// absolute URL (prod, or any future non-relative source) passes through
// unchanged; a relative path is prefixed with the API's own origin.
//
// blob: URLs (optimistic upload tiles' URL.createObjectURL preview, see
// SalonMediaService/StaffMediaService's upload()) must also pass through
// unchanged — they don't match ^https?:// (blob: is its own scheme), so
// without this check they were getting prefixed into garbage like
// "{apiBaseUrl}blob:https://app.../uuid", rendering as a broken image for
// the entire duration of the upload instead of the actual selected photo.
@Pipe({ name: 'mediaUrl' })
export class MediaUrlPipe implements PipeTransform {
  transform(url: string | null | undefined, size: MediaUrlSize = 'full'): string | null {
    if (!url) return null;
    if (/^blob:/i.test(url)) return url;
    if (!/^https?:/i.test(url)) return `${environment.apiBaseUrl}${url}`;
    return this._applyTransform(url, size);
  }

  // Only a genuine Cloudinary delivery URL (/image/upload/...) gets a
  // transformation inserted — any other absolute URL (a dev-mode local path,
  // a future non-Cloudinary source) passes through unchanged rather than
  // being rewritten into something broken.
  private _applyTransform(url: string, size: MediaUrlSize): string {
    const marker = '/image/upload/';
    const i = url.indexOf(marker);
    if (i === -1) return url;
    const insertAt = i + marker.length;
    return `${url.slice(0, insertAt)}${SIZE_TRANSFORMS[size]}/${url.slice(insertAt)}`;
  }
}
