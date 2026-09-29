import { Injectable } from '@angular/core'
import type { PersistedRouteState } from '../store/route.actions'

const STORAGE_KEY = 'hazmat-route-workbench/v1'

/**
 * 路线版本状态持久化：切换页面（SPA 内 NgRx 状态本身保留）以及
 * 重新读取/刷新浏览器后，当前版本、待确认意见、锁定状态均不回到演示数据。
 */
@Injectable({ providedIn: 'root' })
export class PersistenceService {
  load(): PersistedRouteState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as PersistedRouteState
      if (!Array.isArray(parsed.versions) || parsed.versions.length === 0) return null
      return parsed
    } catch {
      return null
    }
  }

  save(state: PersistedRouteState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 存储不可用时静默降级（如隐私模式），内存中的当前会话仍可用
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}
