import { Injectable } from '@angular/core'
import { length, lineString } from '@turf/turf'
import {
  REVIEW_ROLES,
  type ReviewComment,
  type RiskLevel,
  type RiskSegment,
  type RouteEvent,
  type RoutePackage,
  type RouteVersion,
  type SegmentSignoff,
} from '../types'

/** route-data.json 中的旧版平铺结构 */
export interface SeedRoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  segments: Array<Omit<RiskSegment, 'change'>>
}

export interface LockCheck {
  canLock: boolean
  pendingSegments: number
  unresolvedHighRisk: RiskSegment[]
  pendingComments: number
}

const RISK_WEIGHTS: Record<string, number> = {
  水源地: 5,
  人口密集: 4,
  人员密集: 4,
  长隧道: 3,
  高架桥: 2,
  桥梁群: 2,
  跨河桥: 2,
  隧道群: 2,
  隧道: 1,
  枢纽密集: 1,
}

/** 绕行方案会避开的敏感因素 */
const BYPASS_AVOIDED = ['水源地', '人口密集', '人员密集']

let seq = 0
function nextId(prefix: string) {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}`.slice(0, 40)
}

export function nowLabel(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 依据区段风险因素重算等级：≥5 高、≥3 中、其余低 */
export function recalcLevel(segment: Pick<RiskSegment, 'risks'>): RiskLevel {
  const weight = segment.risks.reduce((sum, risk) => sum + (RISK_WEIGHTS[risk] ?? 1), 0)
  if (weight >= 5) return '高'
  if (weight >= 3) return '中'
  return '低'
}

/** 按区段里程加权汇总整版风险分（5–98 截尾） */
export function recalcScore(segments: RiskSegment[]): number {
  const weight = { 高: 3, 中: 2, 低: 1 } as const
  const totalKm = segments.reduce((sum, s) => sum + (Number(s.km) || 0), 0)
  if (totalKm === 0) return 0
  const score = segments.reduce((sum, s) => {
    const km = Number(s.km) || 0
    return sum + km * (weight[s.level] * 30 - 6)
  }, 0) / totalKm
  return Math.min(98, Math.max(5, Math.round(score)))
}

function turfKm(coordinates: [number, number][]): string {
  return length(lineString(coordinates), { units: 'kilometers' }).toFixed(1)
}

function initialSignoffs(segment: RiskSegment): SegmentSignoff[] {
  return REVIEW_ROLES.map((role) => ({
    role,
    status: segment.status === '已确认' ? '已接受' : '待会签',
    actor: segment.status === '已确认' ? '导入基线' : '—',
    at: segment.status === '已确认' ? '初始版本' : '—',
  }))
}

function seedComments(): Record<string, ReviewComment[]> {
  return {
    'S-203': [
      { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    ],
    'S-207': [
      { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '桥梁群与人口密集区段，要求绕行前完成属地应急联动确认。', status: '已接受' },
    ],
  }
}

/** 将旧版演示数据转换为版本化结构 */
export function seedToRoute(seed: SeedRoutePackage): RoutePackage {
  const seedCommentMap = seedComments()
  const segments: RiskSegment[] = seed.segments.map((s) => ({ ...s, change: 'copy' }))
  const comments = segments.flatMap((s) =>
    (seedCommentMap[s.id] ?? []).map((c) => ({ ...c, segmentId: s.id })),
  )
  const signoffs: Record<string, SegmentSignoff[]> = {}
  for (const segment of segments) {
    signoffs[segment.id] = initialSignoffs(segment)
  }
  const v1: RouteVersion = {
    id: `${seed.id}/v1`,
    versionNo: 1,
    segments,
    comments,
    signoffs,
    locked: false,
    createdAt: seed.updatedAt,
    note: '初始基线版本',
  }
  const events: RouteEvent[] = [
    { id: nextId('EV'), at: seed.updatedAt, label: '路径编组完成', detail: `${seed.trainCode} 生成 v1，含 ${segments.length} 个区段` },
  ]
  for (const comment of comments) {
    events.push({
      id: nextId('EV'),
      at: seed.updatedAt,
      label: `${comment.role}专业意见`,
      detail: `${comment.author} 对 ${comment.segmentId} 提出意见：${comment.content}`,
    })
  }
  return {
    ...seed,
    versions: [v1],
    currentVersionId: v1.id,
    events,
  }
}

/** 生成绕行区段：复制几何并整体北移示意绕避，剔除敏感因素后重算风险 */
function buildBypassSegment(old: RiskSegment, index: number): RiskSegment {
  const coordinates = old.coordinates.map(([lng, lat]) => [+(lng + 0.35).toFixed(2), +(lat + 0.16).toFixed(2)] as [number, number])
  const risks = old.risks.filter((risk) => !BYPASS_AVOIDED.includes(risk))
  const segment: RiskSegment = {
    id: `${old.id}-B${index}`,
    name: `${old.name}（绕行方案）`,
    from: old.from,
    to: old.to,
    km: turfKm(coordinates),
    speed: '限速 60',
    risks: risks.length ? risks : ['一般线路'],
    level: '低',
    status: '待复核',
    coordinates,
    replacedFrom: old.id,
    change: 'reroute',
  }
  return { ...segment, level: recalcLevel(segment) }
}

function freshSignoffs(): SegmentSignoff[] {
  return REVIEW_ROLES.map((role) => ({ role, status: '待会签' as const, actor: '—', at: '—' }))
}

export interface AlternativeResult {
  version: RouteVersion
  events: RouteEvent[]
  score: number
  bypassCount: number
}

/**
 * 基于当前版本生成替代方案：
 * - 复制全部当前区段，高风险且未处理（需绕行）的区段改为绕行并重新计算风险；
 * - 未变化区段继承原有三方意见与会签；
 * - 风险等级变化的区段，继承的意见转待重新确认、会签重置。
 */
export function buildAlternative(route: RoutePackage, current: RouteVersion): AlternativeResult {
  const versionNo = Math.max(...route.versions.map((v) => v.versionNo)) + 1
  const id = `${route.id}/v${versionNo}`
  const oldSignoffs = (segmentId: string) => current.signoffs[segmentId] ?? freshSignoffs()

  const replacement = new Map<string, RiskSegment>()
  const reroutedSegments: RiskSegment[] = []
  current.segments
    .filter((s) => s.level === '高' && s.status === '需绕行')
    .forEach((old, index) => {
      const bypass = buildBypassSegment(old, index + 1)
      replacement.set(old.id, bypass)
      reroutedSegments.push(bypass)
    })

  const segments: RiskSegment[] = current.segments.map((old) => replacement.get(old.id) ?? { ...old, change: 'copy' as const })

  const comments: ReviewComment[] = []
  for (const oldComment of current.comments) {
    const newSegment = replacement.get(oldComment.segmentId)
    if (!newSegment) {
      // 区段未变化：意见原样继承
      comments.push({ ...oldComment, inherited: true, needsReconfirm: false })
      continue
    }
    // 区段被绕行取代、风险等级变化：继承内容但转待重新确认
    comments.push({
      ...oldComment,
      id: nextId('RV'),
      segmentId: newSegment.id,
      status: '待确认',
      inherited: true,
      needsReconfirm: true,
    })
  }

  const signoffs: Record<string, SegmentSignoff[]> = {}
  for (const segment of segments) {
    signoffs[segment.id] = segment.change === 'reroute' ? freshSignoffs() : oldSignoffs(segment.id).map((s) => ({ ...s }))
  }

  const version: RouteVersion = {
    id,
    versionNo,
    parentVersionId: current.id,
    segments,
    comments,
    signoffs,
    locked: false,
    createdAt: nowLabel(),
    note: reroutedSegments.length
      ? `绕行处理 ${reroutedSegments.length} 个高风险区段（${reroutedSegments.map((s) => s.replacedFrom).join('、')}），其余区段继承`
      : '复制当前版本，无高风险绕行区段',
  }

  const events: RouteEvent[] = [
    {
      id: nextId('EV'),
      at: version.createdAt,
      label: '生成替代方案',
      detail: `由 ${current.id} 生成 ${id}：${version.note}`,
    },
  ]
  for (const comment of comments.filter((c) => c.needsReconfirm)) {
    events.push({
      id: nextId('EV'),
      at: version.createdAt,
      label: '意见待重新确认',
      detail: `${comment.role}意见（${comment.author}）随 ${comment.segmentId} 风险等级变化转入待重新确认`,
    })
  }

  return { version, events, score: recalcScore(segments), bypassCount: reroutedSegments.length }
}

/** 区段风险等级被人工调整：继承意见随风险变化转待重新确认，会签重置 */
export function applyLevelChange(version: RouteVersion, segmentId: string, level: RiskLevel) {
  const segment = version.segments.find((s) => s.id === segmentId)
  if (!segment) return
  const oldLevel = segment.level
  segment.level = level
  segment.status = level === '高' ? '需绕行' : '待复核'
  if (oldLevel === level) return
  version.comments = version.comments.map((comment) =>
    comment.segmentId === segmentId && comment.status === '已接受'
      ? { ...comment, status: '待确认', needsReconfirm: true }
      : comment,
  )
  version.signoffs[segmentId] = freshSignoffs()
}

/** 三方都接受且没有待确认意见、没有未处理高风险区段时，才允许锁定 */
export function checkLock(version: RouteVersion): LockCheck {
  const pendingSegments = version.segments.filter((segment) =>
    (version.signoffs[segment.id] ?? []).some((s) => s.status !== '已接受'),
  ).length
  const unresolvedHighRisk = version.segments.filter((s) => s.level === '高' && s.status === '需绕行')
  const pendingComments = version.comments.filter((c) => c.status === '待确认').length
  return {
    canLock: pendingSegments === 0 && unresolvedHighRisk.length === 0 && pendingComments === 0,
    pendingSegments,
    unresolvedHighRisk,
    pendingComments,
  }
}

export function signoffSummary(version: RouteVersion, segmentId: string): SegmentSignoff[] {
  return version.signoffs[segmentId] ?? []
}

export function segmentById(version: RouteVersion, segmentId: string): RiskSegment | undefined {
  return version.segments.find((s) => s.id === segmentId)
}

export function findRoute(routes: RoutePackage[], routeId: string): RoutePackage | undefined {
  return routes.find((route) => route.id === routeId)
}

export function findVersion(route: RoutePackage, versionId: string): RouteVersion | undefined {
  return route.versions.find((version) => version.id === versionId)
}

export const makeId = nextId
export const timestamp = nowLabel
