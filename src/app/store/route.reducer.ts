import { createReducer, on } from '@ngrx/store'
import type { AuditEntry, ReviewComment, RoutePackage, RouteVersion, SegmentStatus } from '../types'
import * as RouteActions from './route.actions'
import {
  buildDetourSegments,
  createVersionFromPackage,
  dateTimeText,
  evaluateLock,
  inheritComments,
  nextVersionType,
  nowText,
  recalcRouteScore,
  uniqueId,
} from './route.domain'

export interface RouteState {
  /** 全部路线版本（含历史版本），路径、风险、意见都挂在版本上 */
  versions: RouteVersion[]
  packages: RoutePackage[]
  audit: AuditEntry[]
  selectedRouteId: string
  selectedVersionId: string
  selectedSegmentId: string
  loading: boolean
  loaded: boolean
  hydrated: boolean
  error: string
  lockError: string
}

export const initialState: RouteState = {
  versions: [],
  packages: [],
  audit: [],
  selectedRouteId: '',
  selectedVersionId: '',
  selectedSegmentId: '',
  loading: false,
  loaded: false,
  hydrated: false,
  error: '',
  lockError: '',
}

function audit(state: RouteState, versionId: string, actor: string, message: string): AuditEntry[] {
  return [{ id: uniqueId('AUD'), versionId, time: nowText(), actor, message }, ...state.audit]
}

function updateVersion(state: RouteState, versionId: string, mutate: (version: RouteVersion) => RouteVersion): RouteVersion[] {
  return state.versions.map((version) => (version.id === versionId ? mutate(version) : version))
}

function firstSegmentId(version: RouteVersion | undefined): string {
  return version?.segments[0]?.id ?? ''
}

/** 首次加载演示数据时建立 v1 基线，并把演示意见锚定到基线版本 */
function seedFromPackages(packages: RoutePackage[]): { versions: RouteVersion[]; audit: AuditEntry[] } {
  const versions = packages.map((pkg, index) => createVersionFromPackage(pkg, index))
  const audit: AuditEntry[] = []
  const attach = (routeId: string, segmentId: string, make: (versionId: string, segmentId: string) => ReviewComment) => {
    const version = versions.find((item) => item.routeId === routeId && item.segments.some((segment) => segment.id === segmentId))
    if (!version) return
    version.comments = [make(version.id, segmentId), ...version.comments]
  }
  attach('HG-260929-018', 'S-203', (versionId, segmentId) => ({
    id: uniqueId('RV'), versionId, segmentId, role: '安全', author: '韩洁',
    content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认', createdAt: '16:42',
  }))
  attach('HG-260929-018', 'S-207', (versionId, segmentId) => ({
    id: uniqueId('RV'), versionId, segmentId, role: '应急', author: '罗晋',
    content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', createdAt: '16:18',
  }))
  const v018 = versions.find((item) => item.routeId === 'HG-260929-018')
  if (v018) {
    audit.push({ id: uniqueId('AUD'), versionId: v018.id, time: '16:42', actor: '安全专业 · 韩洁', message: '对 S-203 提出限速与吸附物资要求，意见待确认' })
    audit.push({ id: uniqueId('AUD'), versionId: v018.id, time: '16:18', actor: '应急专业 · 罗晋', message: 'S-207 隧道出口监护条件已接受' })
    audit.push({ id: uniqueId('AUD'), versionId: v018.id, time: '15:50', actor: '规则引擎', message: `生成基线版本 v${v018.versionNo}，共 ${v018.segments.length} 个区段` })
  }
  return { versions, audit }
}

/** 以某版本为父版本派生新版本（替代方案/修订），复制区段并继承意见 */
function deriveVersion(state: RouteState, parent: RouteVersion, kind: '绕行替代' | '修订'): RouteState {
  const versionId = uniqueId('VER')
  const copiedSegments = parent.segments.map((segment) => ({
    ...segment,
    risks: [...segment.risks],
    coordinates: segment.coordinates.map((point) => [...point] as [number, number]),
  }))
  const idMap = new Map<string, string>()
  const nextSegments = kind === '绕行替代'
    ? buildDetourSegments(copiedSegments).map((segment, index) => {
        const origin = copiedSegments[index]
        if (origin.level === '高') idMap.set(origin.id, segment.id)
        return segment
      })
    : copiedSegments
  const comments = inheritComments(parent, nextSegments, versionId, idMap)
  const version: RouteVersion = {
    ...parent,
    id: versionId,
    versionNo: Math.max(...state.versions.filter((item) => item.routeId === parent.routeId).map((item) => item.versionNo), 0) + 1,
    type: kind === '绕行替代' ? '绕行替代' : nextVersionType(parent.type),
    parentVersionId: parent.id,
    locked: false,
    lockedAt: null,
    createdAt: dateTimeText(),
    note: kind === '绕行替代' ? '高风险区段生成绕行替代方案，风险已重算' : `基于已锁定 v${parent.versionNo} 另开修订`,
    segments: nextSegments,
    score: recalcRouteScore(nextSegments),
    comments,
  }
  const inheritedPending = comments.filter((comment) => comment.status === '待重新确认' || comment.status === '待确认').length
  return {
    ...state,
    versions: [...state.versions, version],
    selectedVersionId: version.id,
    selectedSegmentId: firstSegmentId(version),
    lockError: '',
    audit: audit(
      state, version.id, '规则引擎',
      kind === '绕行替代'
        ? `由 v${parent.versionNo} 生成绕行替代 v${version.versionNo}：总风险分 ${parent.score} → ${version.score}，${inheritedPending} 条意见需重新确认`
        : `已锁定的 v${parent.versionNo} 只读保留，另开修订 v${version.versionNo}`,
    ),
  }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.hydrateSuccess, (state, { state: persisted }): RouteState => ({
    ...state,
    versions: persisted.versions,
    audit: persisted.audit,
    selectedRouteId: persisted.selectedRouteId,
    selectedVersionId: persisted.selectedVersionId,
    selectedSegmentId: persisted.selectedSegmentId,
    hydrated: true,
  })),
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }): RouteState => {
    if (state.versions.length > 0) {
      // 已有（含从本地存储恢复的）版本，演示数据不得覆盖真实工作状态
      return { ...state, packages: routes, loading: false, loaded: true }
    }
    const seeded = seedFromPackages(routes)
    const firstRouteId = routes[0]?.id ?? ''
    const firstVersion = seeded.versions.find((version) => version.routeId === firstRouteId)
    return {
      ...state,
      packages: routes,
      versions: seeded.versions,
      audit: seeded.audit,
      loading: false,
      loaded: true,
      selectedRouteId: firstRouteId,
      selectedVersionId: firstVersion?.id ?? '',
      selectedSegmentId: firstSegmentId(firstVersion),
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => {
    const version = [...state.versions]
      .filter((item) => item.routeId === id)
      .sort((a, b) => b.versionNo - a.versionNo)[0]
    return { ...state, selectedRouteId: id, selectedVersionId: version?.id ?? '', selectedSegmentId: firstSegmentId(version) }
  }),
  on(RouteActions.selectVersion, (state, { versionId }) => {
    const version = state.versions.find((item) => item.id === versionId)
    if (!version) return state
    return { ...state, selectedRouteId: version.routeId, selectedVersionId: versionId, selectedSegmentId: firstSegmentId(version) }
  }),
  on(RouteActions.selectSegment, (state, { id }) =>
    state.versions.some((version) => version.id === state.selectedVersionId && version.segments.some((segment) => segment.id === id))
      ? { ...state, selectedSegmentId: id }
      : state),
  on(RouteActions.updateSegmentLevel, (state, { versionId, segmentId, level }): RouteState => {
    const target = state.versions.find((version) => version.id === versionId)
    const segment = target?.segments.find((item) => item.id === segmentId)
    if (!target || target.locked || !segment || segment.level === level) return state
    const versions = updateVersion(state, versionId, (version) => {
      const segments = version.segments.map((item) =>
        item.id === segmentId
          ? { ...item, level, status: (level === '高' ? '需绕行' : item.status === '需绕行' ? '待复核' : item.status) as SegmentStatus }
          : item,
      )
      // 风险等级改变：该区段仍有效的会签意见全部转待重新确认（已退回的补件意见保持退回）
      const comments = version.comments.map((comment) =>
        comment.segmentId === segmentId && comment.status !== '已退回'
          ? { ...comment, status: '待重新确认' as const }
          : comment,
      )
      return { ...version, segments, comments, score: recalcRouteScore(segments) }
    })
    return {
      ...state,
      versions,
      lockError: '',
      audit: audit(state, versionId, '风险地图复核', `${segmentId} 风险等级由 ${segment.level} 调整为 ${level}，关联会签意见转待重新确认`),
    }
  }),
  on(RouteActions.resolveDetour, (state, { versionId, segmentId }): RouteState => {
    const target = state.versions.find((version) => version.id === versionId)
    if (!target || target.locked) return state
    const versions = updateVersion(state, versionId, (version) => ({
      ...version,
      segments: version.segments.map((segment) => (segment.id === segmentId ? { ...segment, status: '已确认' as const } : segment)),
    }))
    return { ...state, versions, audit: audit(state, versionId, '风险地图复核', `${segmentId} 绕行处理完成，区段已确认`) }
  }),
  on(RouteActions.addComment, (state, { comment }): RouteState => {
    const version = state.versions.find((item) => item.id === state.selectedVersionId)
    if (!version || version.locked) return state
    const full: ReviewComment = {
      ...comment,
      id: uniqueId('RV'),
      versionId: version.id,
      createdAt: nowText(),
    }
    const versions = updateVersion(state, version.id, (item) => ({ ...item, comments: [full, ...item.comments] }))
    return { ...state, versions, lockError: '', audit: audit(state, version.id, `${comment.role}专业 · ${comment.author}`, `对 ${comment.segmentId} 新增会签意见，状态待确认`) }
  }),
  on(RouteActions.resolveComment, (state, { versionId, commentId, status }): RouteState => {
    const target = state.versions.find((version) => version.id === versionId)
    const comment = target?.comments.find((item) => item.id === commentId)
    if (!target || target.locked || !comment) return state
    const versions = updateVersion(state, versionId, (version) => ({
      ...version,
      comments: version.comments.map((item) => (item.id === commentId ? { ...item, status } : item)),
    }))
    return {
      ...state,
      versions,
      lockError: '',
      audit: audit(state, versionId, `${comment.role}专业 · ${comment.author}`, `${comment.segmentId} 意见 ${comment.id} ${status === '已接受' ? '已接受' : '已退回'}`),
    }
  }),
  on(RouteActions.createAlternative, (state): RouteState => {
    const parent = state.versions.find((version) => version.id === state.selectedVersionId)
    if (!parent) return state
    return deriveVersion(state, parent, '绕行替代')
  }),
  on(RouteActions.reviseVersion, (state, { versionId }): RouteState => {
    const parent = state.versions.find((version) => version.id === versionId)
    if (!parent || !parent.locked) return state
    return deriveVersion(state, parent, '修订')
  }),
  on(RouteActions.lockVersion, (state, { versionId }): RouteState => {
    const target = state.versions.find((version) => version.id === versionId)
    if (!target || target.locked) return state
    const check = evaluateLock(target)
    if (!check.canLock) {
      return { ...state, lockError: check.reasons.join('；') }
    }
    const versions = updateVersion(state, versionId, (version) => ({ ...version, locked: true, lockedAt: dateTimeText() }))
    return {
      ...state,
      versions,
      lockError: '',
      audit: audit(state, versionId, '审批台', `三方会签齐备且高风险绕行区段处理完毕，版本 v${target.versionNo} 锁定，路径/风险/会签结果只读`),
    }
  }),
  on(RouteActions.lockVersionFailure, (state, { message }) => ({ ...state, lockError: message })),
)
