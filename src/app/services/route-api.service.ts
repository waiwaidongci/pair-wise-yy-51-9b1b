import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { map } from 'rxjs'
import type { SeedRoutePackage } from './route-domain'

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)

  getRoutePackages() {
    return this.http
      .get<{ items: SeedRoutePackage[] }>('route-data.json')
      .pipe(map((response) => response.items))
  }
}
