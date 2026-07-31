import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../../environments/environment';

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
  transform(url: string | null | undefined): string | null {
    if (!url) return null;
    if (/^(https?|blob):/i.test(url)) return url;
    return `${environment.apiBaseUrl}${url}`;
  }
}
