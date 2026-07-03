import { Injectable } from '@angular/core';

interface ReverseGeocodeResult {
  readonly state: string;
  readonly city: string;
}

// The browser's Geolocation API only returns raw lat/lng — no state or city
// name. There is no backend geocoding (deliberately — see the listing/
// favourites handoff §3), so resolving coordinates to a place name is a
// second, separate client-side call to a third-party reverse-geocode service.
// Used BigDataCloud's free client-side endpoint: no API key, no signup,
// explicitly designed to be called straight from the browser.
//
// Deliberately uses the native fetch(), NOT HttpClient — this app's global
// errorInterceptor toasts on any response that isn't its own API envelope
// shape, which would surface a wrong "you appear to be offline" toast on a
// third-party call that's supposed to fail silently and fall back quietly.
@Injectable({ providedIn: 'root' })
export class GeoLocationService {
  // Resolves the visitor's state/city, or null if permission is denied, the
  // browser has no geolocation support, or the lookup fails. Never throws —
  // "no location yet" is the correct, expected default (handoff §3).
  async resolveLocation(): Promise<ReverseGeocodeResult | null> {
    const position = await this._getCurrentPosition();
    if (!position) return null;

    try {
      const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
      url.searchParams.set('latitude', String(position.latitude));
      url.searchParams.set('longitude', String(position.longitude));
      url.searchParams.set('localityLanguage', 'en');

      const res = await fetch(url.toString());
      if (!res.ok) return null;

      const result = (await res.json()) as {
        principalSubdivision?: string;
        city?: string;
        locality?: string;
      };
      const state = result.principalSubdivision ?? '';
      const city = result.city || result.locality || '';
      if (!state && !city) return null;
      return { state, city };
    } catch {
      return null;
    }
  }

  private _getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null), // permission denied / unavailable — fall back silently
        // enableHighAccuracy triggers real GPS/Wi-Fi positioning on devices that
        // have it, instead of coarse IP-based geolocation (which in Nigeria can
        // be off by a whole state — it resolves to the nearest ISP POP, not the
        // visitor's actual city).
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
      );
    });
  }
}
