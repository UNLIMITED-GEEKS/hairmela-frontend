import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../../environments/environment';

// Local dev's backend returns relative media paths (e.g. "/uploads/x.jpeg")
// instead of the full Cloudinary URL prod always returns — this resolves
// that gap so templates never need to special-case the environment. An
// absolute URL (prod, or any future non-relative source) passes through
// unchanged; a relative path is prefixed with the API's own origin.
@Pipe({ name: 'mediaUrl' })
export class MediaUrlPipe implements PipeTransform {
  transform(url: string | null | undefined): string | null {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    return `${environment.apiBaseUrl}${url}`;
  }
}
