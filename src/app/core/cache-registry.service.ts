import { Injectable } from '@angular/core';

export interface Clearable {
  clear(): void;
}

@Injectable({ providedIn: 'root' })
export class CacheRegistry {
  private readonly _services = new Set<Clearable>();

  register(service: Clearable): void {
    this._services.add(service);
  }

  clearAll(): void {
    this._services.forEach((s) => s.clear());
  }
}
