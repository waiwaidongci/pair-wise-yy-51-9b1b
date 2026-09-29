import { inject, Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { RouteState } from './route.reducer'
import { RoutePersistenceService } from '../services/route-persistence.service'
import { loadRoutes } from './route.actions'

/**
 * 应用启动即载入数据，并把工作状态写入 localStorage：
 * 切换页面、整页重新读取后仍停留在同一版本，待确认意见与锁定状态不丢失。
 */
@Injectable({ providedIn: 'root' })
export class RouteStateSync {
  private readonly store = inject(Store<{ routes: RouteState }>)
  private readonly persistence = inject(RoutePersistenceService)

  start() {
    this.store.dispatch(loadRoutes())
    this.store.select('routes').subscribe((state) => {
      if (state.routes.length > 0) {
        this.persistence.save({
          routes: state.routes,
          selectedRouteId: state.selectedRouteId,
          selectedVersionId: state.selectedVersionId,
          selectedSegmentId: state.selectedSegmentId,
        })
      }
    })
  }
}
