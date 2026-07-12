import { Component, computed, inject, input } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs';

// Renders an SVG from public/svgs/<name>.svg inline in the DOM (not <img>),
// so its paths use currentColor and inherit color/hover from the host's
// Tailwind text-color classes — e.g. <app-icon name="heart" class="w-5 h-5
// text-gray-400 hover:text-primary" />. Files must not hardcode fill/stroke.
// Fetched once per icon name and cached for the app session (icons are
// static assets, never change at runtime).
@Component({
  selector: 'app-icon',
  template: '',
  host: { class: 'inline-flex', '[innerHTML]': 'svg()' },
})
export class IconComponent {
  private static readonly _cache = new Map<string, Observable<string>>();

  private readonly _http = inject(HttpClient);
  private readonly _sanitizer = inject(DomSanitizer);

  readonly name = input.required<string>();

  private readonly _markup = toSignal(
    toObservable(this.name).pipe(switchMap((name) => this._load(name))),
    { initialValue: '' },
  );

  protected readonly svg = computed<SafeHtml>(() =>
    this._sanitizer.bypassSecurityTrustHtml(this._markup()),
  );

  private _load(name: string): Observable<string> {
    let cached = IconComponent._cache.get(name);
    if (!cached) {
      cached = this._http.get(`/svgs/${name}.svg`, { responseType: 'text' }).pipe(
        // Strip the file's own width/height, then force width/height="100%"
        // on the <svg> tag so it fills whatever box the host element's
        // Tailwind size classes (w-5 h-5, etc.) establish. Without an
        // explicit 100%, an <svg> with no intrinsic size renders at 0x0.
        map((raw) =>
          raw
            .replace(/\s(width|height)="[^"]*"/g, '')
            .replace('<svg ', '<svg width="100%" height="100%" '),
        ),
        catchError(() => of('')),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      IconComponent._cache.set(name, cached);
    }
    return cached;
  }
}
