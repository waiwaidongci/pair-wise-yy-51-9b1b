import { createSelector } from '@ngrx/store'
import type { RouteState } from './route.reducer'
import { evaluateLock } from './route.domain'

export const selectRouteState = (state: { routes: RouteState }) => state.routes

export const selectVersions = createSelector(selectRouteState, (state) => state.versions)

export const selectSelectedVersion = createSelector(
  selectRouteState,
  (state) => state.versions.find((version) => version.id === state.selectedVersionId),
)

export const selectRouteVersions = createSelector(
  selectRouteState,
  (state) => state.versions
    .filter((version) => version.routeId === state.selectedRouteId)
    .sort((a, b) => b.versionNo - a.versionNo),
)

/** 每条运输单的最新版本（工作台总览使用） */
export const selectLatestByRoute = createSelector(selectVersions, (versions) => {
  const latest = new Map<string, (typeof versions)[number]>()
  for (const version of versions) {
    const current = latest.get(version.routeId)
    if (!current || version.versionNo > current.versionNo) latest.set(version.routeId, version)
  }
  return latest
})

export const selectLockCheck = createSelector(selectSelectedVersion, (version) =>
  version ? evaluateLock(version) : undefined,
)
