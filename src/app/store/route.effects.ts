import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, from, map, of, switchMap, tap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { PersistenceService } from '../services/persistence.service'
import { hydrateSuccess, loadRoutes, loadRoutesFailure, loadRoutesSuccess } from './route.actions'
import type { RouteState } from './route.reducer'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly persistence = inject(PersistenceService)
  private readonly store = inject(Store<{ routes: RouteState }>)

  /**
   * 启动水合：有本地快照则先恢复当前版本/意见/锁定状态，再补拉运输单元数据；
   * 没有快照则直接加载演示数据作为 v1 基线。整个流程只触发一次。
   */
  bootstrap$ = createEffect(() => of(null).pipe(
    switchMap(() => {
      const persisted = this.persistence.load()
      return persisted
        ? from([hydrateSuccess({ state: persisted }), loadRoutes()])
        : of(loadRoutes())
    }),
  ))

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(loadRoutes),
    withLatestFrom(this.store.select('routes')),
    switchMap(([, state]) => this.api.getRoutePackages().pipe(
      map((routes) => loadRoutesSuccess({ routes })),
      catchError((error: unknown) => {
        // 已有版本快照（含本地恢复）时，拉取失败不影响工作，也不回退演示状态
        if (state.versions.length > 0) return of()
        return of(loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))
      }),
    )),
  ))

  /** 每次状态变化后持久化版本、选中项与审计时间线 */
  persist$ = createEffect(() => this.store.select('routes').pipe(
    tap((state) => {
      if (!state.hydrated && state.versions.length === 0) return
      this.persistence.save({
        versions: state.versions,
        selectedRouteId: state.selectedRouteId,
        selectedVersionId: state.selectedVersionId,
        selectedSegmentId: state.selectedSegmentId,
        audit: state.audit,
      })
    }),
  ), { dispatch: false })
}
