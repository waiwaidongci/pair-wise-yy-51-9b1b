import { createAction, props } from '@ngrx/store'
import type { ReviewComment, RiskLevel, RoutePackage, SignoffStatus, ReviewRole } from '../types'
import type { SeedRoutePackage } from '../services/route-domain'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ seeds: SeedRoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const hydrateSuccess = createAction('[Persistence] Hydrate Success', props<{ routes: RoutePackage[]; selectedRouteId: string; selectedVersionId: string; selectedSegmentId: string }>())

export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectVersion = createAction('[Shared] Select Version', props<{ routeId: string; versionId: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

export const updateSegmentLevel = createAction(
  '[Risk Map] Update Level',
  props<{ routeId: string; versionId: string; segmentId: string; level: RiskLevel }>(),
)

export const addComment = createAction(
  '[Approval] Add Comment',
  props<{ routeId: string; versionId: string; comment: ReviewComment }>(),
)
export const resolveComment = createAction(
  '[Approval] Resolve Comment',
  props<{ routeId: string; versionId: string; commentId: string; status: ReviewComment['status'] }>(),
)
export const signSegment = createAction(
  '[Approval] Sign Segment',
  props<{ routeId: string; versionId: string; segmentId: string; role: ReviewRole; status: SignoffStatus }>(),
)

/** 基于当前版本另开版本（替代方案/绕行；锁定后的再调整也走此动作） */
export const createAlternative = createAction('[Risk Map] Create Alternative', props<{ routeId: string }>())
export const lockVersion = createAction('[Approval] Lock Version', props<{ routeId: string; versionId: string }>())

export type { RoutePackage }
