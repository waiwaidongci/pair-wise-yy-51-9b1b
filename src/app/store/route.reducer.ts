import { createReducer, on } from '@ngrx/store'
import type { ReviewComment, RoutePackage, RouteVersion } from '../types'
import * as RouteActions from './route.actions'
import {
  applyLevelChange,
  buildAlternative,
  checkLock,
  makeId,
  nowLabel,
  seedToRoute,
  type SeedRoutePackage,
} from '../services/route-domain'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedVersionId: string
  selectedSegmentId: string
  loading: boolean
  error: string
}

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedVersionId: '',
  selectedSegmentId: '',
  loading: false,
  error: '',
}

function fromHydration(
  state: RouteState,
  payload: { routes: RoutePackage[]; selectedRouteId: string; selectedVersionId: string; selectedSegmentId: string },
): RouteState {
  const route = payload.routes.find((item) => item.id === payload.selectedRouteId) ?? payload.routes[0]
  const version =
    route?.versions.find((v) => v.id === payload.selectedVersionId) ??
    route?.versions.find((v) => v.id === route.currentVersionId)
  return {
    ...state,
    loading: false,
    routes: payload.routes,
    selectedRouteId: route?.id ?? '',
    selectedVersionId: version?.id ?? '',
    selectedSegmentId: version?.segments.some((s) => s.id === payload.selectedSegmentId)
      ? payload.selectedSegmentId
      : version?.segments[0]?.id ?? '',
  }
}

function fromSeeds(state: RouteState, seeds: SeedRoutePackage[]): RouteState {
  // 已有工作单（含历史版本）一律保留，重新读取只补充新单，避免回到演示数据
  const existing = new Set(state.routes.map((route) => route.id))
  const added = seeds.filter((seed) => !existing.has(seed.id)).map(seedToRoute)
  const routes = [...state.routes, ...added]
  if (state.selectedRouteId) return { ...state, loading: false, routes }
  const route = routes[0]
  const version = route?.versions.find((v) => v.id === route.currentVersionId)
  return {
    ...state,
    loading: false,
    routes,
    selectedRouteId: route?.id ?? '',
    selectedVersionId: version?.id ?? '',
    selectedSegmentId: version?.segments[0]?.id ?? '',
  }
}

function mapRoute(state: RouteState, routeId: string, fn: (route: RoutePackage) => RoutePackage): RouteState {
  return { ...state, routes: state.routes.map((route) => (route.id === routeId ? fn(route) : route)) }
}

/** 在指定版本的深拷贝上执行变更，锁定版本直接返回不修改 */
function withVersion(route: RoutePackage, versionId: string, fn: (version: RouteVersion) => void): RoutePackage {
  const version = route.versions.find((item) => item.id === versionId)
  if (!version || version.locked) return route
  return {
    ...route,
    updatedAt: nowLabel(),
    versions: route.versions.map((item) => {
      if (item.id !== versionId) return item
      const draft = structuredClone(item)
      fn(draft)
      return draft
    }),
  }
}

function appendEvent(route: RoutePackage, label: string, detail: string): RoutePackage {
  return {
    ...route,
    events: [...route.events, { id: makeId('EV'), at: nowLabel(), label, detail }],
  }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { seeds }) => fromSeeds(state, seeds)),
  on(RouteActions.hydrateSuccess, (state, payload) => fromHydration(state, payload)),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(RouteActions.selectRoute, (state, { id }) => {
    const route = state.routes.find((item) => item.id === id)
    const version = route?.versions.find((v) => v.id === route.currentVersionId)
    return {
      ...state,
      selectedRouteId: id,
      selectedVersionId: version?.id ?? '',
      selectedSegmentId: version?.segments[0]?.id ?? '',
    }
  }),
  on(RouteActions.selectVersion, (state, { routeId, versionId }) => {
    const route = state.routes.find((item) => item.id === routeId)
    const version = route?.versions.find((v) => v.id === versionId)
    return {
      ...state,
      selectedRouteId: routeId,
      selectedVersionId: versionId,
      selectedSegmentId: version?.segments[0]?.id ?? '',
    }
  }),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  on(RouteActions.updateSegmentLevel, (state, { routeId, versionId, segmentId, level }) =>
    mapRoute(state, routeId, (route) => {
      const before = route.versions.find((v) => v.id === versionId)
      const oldLevel = before?.segments.find((s) => s.id === segmentId)?.level
      const next = withVersion(route, versionId, (draft) => applyLevelChange(draft, segmentId, level))
      if (next === route || oldLevel === level) return next
      return appendEvent(next, '风险等级调整', `${segmentId} 风险等级调整为「${level}」，相关已接受意见转入待重新确认、会签重置`)
    }),
  ),

  on(RouteActions.addComment, (state, { routeId, versionId, comment }) =>
    mapRoute(state, routeId, (route) => {
      const next = withVersion(route, versionId, (draft) => {
        draft.comments = [{ ...comment, inherited: false, needsReconfirm: false }, ...draft.comments]
      })
      return next === route ? route : appendEvent(next, `${comment.role}专业发表意见`, `${comment.author} 对 ${comment.segmentId} 发表意见`)
    }),
  ),

  on(RouteActions.resolveComment, (state, { routeId, versionId, commentId, status }) =>
    mapRoute(state, routeId, (route) => {
      const target = route.versions.find((v) => v.id === versionId)?.comments.find((c: ReviewComment) => c.id === commentId)
      const next = withVersion(route, versionId, (draft) => {
        draft.comments = draft.comments.map((comment) =>
          comment.id === commentId ? { ...comment, status, needsReconfirm: status === '待确认' } : comment,
        )
      })
      return target && next !== route
        ? appendEvent(next, '意见确认', `${target.role}意见 ${commentId}（${target.segmentId}）处理为「${status}」`)
        : next
    }),
  ),

  on(RouteActions.signSegment, (state, { routeId, versionId, segmentId, role, status }) =>
    mapRoute(state, routeId, (route) => {
      const next = withVersion(route, versionId, (draft) => {
        const signoffs = (draft.signoffs[segmentId] ?? []).map((item) =>
          item.role === role ? { ...item, status, actor: '当前审阅人', at: nowLabel() } : item,
        )
        draft.signoffs = { ...draft.signoffs, [segmentId]: signoffs }
      })
      return next === route ? route : appendEvent(next, `${role}专业会签`, `${segmentId} 会签结果：${status}`)
    }),
  ),

  on(RouteActions.createAlternative, (state, { routeId }) => {
    const route = state.routes.find((item) => item.id === routeId)
    const current =
      route?.versions.find((version) => version.id === state.selectedVersionId) ??
      route?.versions.find((version) => version.id === route?.currentVersionId)
    if (!route || !current) return state
    const result = buildAlternative(structuredClone(route), structuredClone(current))
    return {
      ...state,
      routes: state.routes.map((item) =>
        item.id === routeId
          ? {
              ...item,
              score: result.score,
              updatedAt: result.version.createdAt,
              versions: [...item.versions, result.version],
              currentVersionId: result.version.id,
              events: [...item.events, ...result.events],
            }
          : item,
      ),
      selectedVersionId: result.version.id,
      selectedSegmentId: result.version.segments[0]?.id ?? '',
    }
  }),

  on(RouteActions.lockVersion, (state, { routeId, versionId }) => {
    const route = state.routes.find((item) => item.id === routeId)
    const version = route?.versions.find((item) => item.id === versionId)
    if (!route || !version || version.locked || !checkLock(version).canLock) return state
    return mapRoute(state, routeId, (target) =>
      appendEvent(
        {
          ...target,
          versions: target.versions.map((item) =>
            item.id === versionId ? { ...item, locked: true, lockedAt: nowLabel() } : item,
          ),
        },
        '版本锁定',
        `${versionId} 已锁定：路径、风险与会签结果冻结，后续调整须另开版本`,
      ),
    )
  }),
)
