import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { provideHttpClient } from '@angular/common/http'
import { provideEffects } from '@ngrx/effects'
import { provideStore } from '@ngrx/store'
import { routes } from './app.routes'
import { RouteEffects } from './store/route.effects'
import { routeReducer } from './store/route.reducer'
import { RouteStateSync } from './store/route-sync.service'

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(),
    provideStore({ routes: routeReducer }),
    provideEffects(RouteEffects),
    provideAppInitializer(() => inject(RouteStateSync).start()),
  ],
}
