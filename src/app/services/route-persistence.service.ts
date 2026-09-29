import { Injectable } from '@angular/core'
import type { RoutePackage } from '../types'

const STORAGE_KEY = 'hazmat-route-workbench:v1'

interface PersistedState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedVersionId: string
  selectedSegmentId: string
}

@Injectable({ providedIn: 'root' })
export class RoutePersistenceService {
  load(): PersistedState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as PersistedState
      if (!Array.isArray(parsed.routes) || parsed.routes.length === 0) return null
      return parsed
    } catch {
      return null
    }
  }

  save(state: PersistedState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 存储不可用时静默降级，不影响当前会话
    }
  }
}
