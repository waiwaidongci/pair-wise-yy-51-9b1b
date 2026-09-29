import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { catchError, map, of, switchMap } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { RoutePersistenceService } from '../services/route-persistence.service'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly persistence = inject(RoutePersistenceService)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => {
      // 切换页面或重新读取后，优先恢复已保存的工作版本，不回到演示数据
      const persisted = this.persistence.load()
      if (persisted) {
        return of(RouteActions.hydrateSuccess(persisted))
      }
      return this.api.getRoutePackages().pipe(
        map((seeds) => RouteActions.loadRoutesSuccess({ seeds })),
        catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
      )
    }),
  ))
}
