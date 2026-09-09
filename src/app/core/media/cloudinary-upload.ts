import { HttpClient } from '@angular/common/http';
import { Observable, defer, from, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';

/** The subset of Cloudinary's upload response this app uses. */
export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
}

/**
 * Uploads straight to Cloudinary from the browser, bypassing our own origin.
 *
 * Sent as JSON with a base64 data URI rather than multipart/form-data: uploads
 * posted as multipart reached our backend with a valid Content-Type and
 * boundary but contentLength=0 — no file part and no text fields — whenever
 * the service worker was registered (measured on-device: ~2.8MB body leaving
 * the page, and the same upload succeeding with the worker unregistered).
 * Cloudinary accepts a data URI in `file`, and a JSON body isn't multipart, so
 * that failure doesn't apply. The tradeoff is base64's ~33% size overhead.
 *
 * Uses an unsigned preset, so the cloud name and preset name are public in the
 * bundle. Restrict the preset in Cloudinary (allowed formats, max file size,
 * a fixed folder) — it is the only thing limiting what can be uploaded with it.
 */
export function uploadToCloudinary(
  http: HttpClient,
  file: File,
): Observable<CloudinaryUploadResult> {
  return defer(() =>
    from(toDataUri(file)).pipe(
      switchMap((dataUri) =>
        http.post<CloudinaryUploadResult>(
          `https://api.cloudinary.com/v1_1/${environment.cloudinaryCloudName}/image/upload`,
          { file: dataUri, upload_preset: environment.cloudinaryUploadPreset },
        ),
      ),
    ),
  );
}

/** Shared with media-upload.ts's JSON HEIC/HEIF conversion path. */
export function toDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
