import { createAction, props } from '@ngrx/store'
import type { AuditEntry, ReviewComment, RiskLevel, RoutePackage, RouteVersion } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const hydrateSuccess = createAction('[Persistence] Hydrate Success', props<{ state: PersistedRouteState }>())

export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectVersion = createAction('[Route Workbench] Select Version', props<{ versionId: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ versionId: string; segmentId: string; level: RiskLevel }>())
export const resolveDetour = createAction('[Risk Map] Resolve Detour', props<{ versionId: string; segmentId: string }>())

export const addComment = createAction('[Approval] Add Comment', props<{ comment: Omit<ReviewComment, 'id' | 'versionId' | 'createdAt'> }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ versionId: string; commentId: string; status: ReviewComment['status'] }>())

/** 在当前版本基础上生成替代方案：复制区段、绕行高风险区段、重算风险、继承意见 */
export const createAlternative = createAction('[Risk Map] Create Alternative')
/** 锁定后的版本如需调整，另开一个修订版本 */
export const reviseVersion = createAction('[Workbench] Revise Version', props<{ versionId: string }>())
export const lockVersion = createAction('[Approval] Lock Version', props<{ versionId: string }>())
export const lockVersionFailure = createAction('[Approval] Lock Version Failure', props<{ message: string }>())

export interface PersistedRouteState {
  versions: RouteVersion[]
  selectedRouteId: string
  selectedVersionId: string
  selectedSegmentId: string
  audit: AuditEntry[]
}

export type { RoutePackage }
