import type {
  AuditEntry,
  CommentStatus,
  LockCheck,
  ReviewComment,
  ReviewRole,
  RiskLevel,
  RiskSegment,
  RoutePackage,
  RouteVersion,
  VersionType,
} from '../types'

export const REVIEW_ROLES: ReviewRole[] = ['安全', '运营', '应急']

let seq = 0
export function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dateTimeText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 风险因子权重表：区段风险要素 + 限速共同决定风险等级 */
const RISK_WEIGHTS: Record<string, number> = {
  水源地: 30,
  长隧道: 22,
  隧道群: 16,
  隧道: 12,
  人口密集: 22,
  人员密集: 16,
  桥梁群: 18,
  跨河桥: 14,
  高架桥: 12,
  枢纽密集: 8,
}

export function scoreSegment(segment: Pick<RiskSegment, 'risks' | 'speed' | 'km'>): { score: number; level: RiskLevel } {
  const base = segment.risks.reduce((sum, risk) => sum + (RISK_WEIGHTS[risk] ?? 8), 0)
  const speed = Number((segment.speed.match(/\d+/) ?? ['0'])[0])
  const speedPenalty = speed > 0 && speed <= 45 ? 14 : speed > 0 && speed <= 60 ? 7 : 0
  const longHaulPenalty = Number(segment.km) >= 150 ? 6 : 0
  const score = Math.min(100, base + speedPenalty + longHaulPenalty)
  const level: RiskLevel = score >= 55 ? '高' : score >= 30 ? '中' : '低'
  return { score, level }
}

/** 按风险分重算整条路径的总风险分（高风险区段权重更大） */
export function recalcRouteScore(segments: RiskSegment[]): number {
  if (segments.length === 0) return 0
  const total = segments.reduce((sum, segment) => {
    const { score } = scoreSegment(segment)
    const weight = segment.level === '高' ? 1.4 : segment.level === '中' ? 1 : 0.6
    return sum + score * weight
  }, 0)
  return Math.round(total / segments.length)
}

/** 绕行区段几何：以原区段端点为锚，向北侧（或南侧交替）偏移出一条平行迂回线 */
function detourCoordinates(coords: [number, number][], index: number): [number, number][] {
  if (coords.length === 0) return coords
  const direction = index % 2 === 0 ? 1 : -1
  const offset = 0.18 * direction
  const mid = coords[Math.floor((coords.length - 1) / 2)]
  return [
    coords[0],
    [mid[0] + offset * 0.35, mid[1] + offset] as [number, number],
    [mid[0] + offset, mid[1] + offset * 0.4] as [number, number],
    coords[coords.length - 1],
  ]
}

/** 高风险区段替换为绕行区段，风险与里程全部重算 */
export function buildDetourSegments(segments: RiskSegment[]): RiskSegment[] {
  return segments.map((segment, index) => {
    if (segment.level !== '高') return { ...segment, risks: [...segment.risks] }
    const coordinates = detourCoordinates(segment.coordinates, index)
    const rerouted: RiskSegment = {
      ...segment,
      id: `${segment.id}-B${index + 1}`,
      name: `${segment.name}（绕行线）`,
      // 绕行走侧线，限速降低、里程略增
      speed: '限速 40',
      km: (Number(segment.km) * 1.12).toFixed(1),
      risks: segment.risks
        .filter((risk) => risk !== '水源地' && risk !== '人口密集' && risk !== '人员密集')
        .concat('绕行侧线'),
      coordinates,
    }
    const { level } = scoreSegment(rerouted)
    return { ...rerouted, level, status: level === '高' ? '需绕行' : '待复核' }
  })
}

/** 区段内容签名：路径几何/限速/风险要素/等级任一变化即视为变化 */
export function segmentSignature(segment: RiskSegment): string {
  return JSON.stringify({
    name: segment.name,
    from: segment.from,
    to: segment.to,
    km: segment.km,
    speed: segment.speed,
    risks: segment.risks,
    level: segment.level,
    coordinates: segment.coordinates,
  })
}

/**
 * 意见继承：
 * - 未变化区段：安全/运营/应急意见原样继承（保留已接受结论）
 * - 已变化或已不存在区段：意见不继承
 * - 区段仍在但风险等级改变：继承后转为“待重新确认”
 * - 高风险区段绕行时，原区段意见沿 idMap 承接给绕行区段，并转“待重新确认”
 */
export function inheritComments(
  previous: RouteVersion,
  nextSegments: RiskSegment[],
  nextVersionId: string,
  idMap: Map<string, string> = new Map(),
): ReviewComment[] {
  const nextById = new Map(nextSegments.map((segment) => [segment.id, segment]))

  return previous.comments
    .map((comment) => {
      // 先处理被绕行区段替换掉的意见
      const detourTargetId = idMap.get(comment.segmentId)
      if (detourTargetId) {
        const target = nextById.get(detourTargetId)
        if (target) {
          return {
            ...comment,
            id: uniqueId('RV'),
            versionId: nextVersionId,
            segmentId: target.id,
            status: '待重新确认' as CommentStatus,
            inherited: true,
            originVersionId: comment.originVersionId ?? previous.id,
            originCommentId: comment.originCommentId ?? comment.id,
          }
        }
        return null
      }
      if (!nextById.has(comment.segmentId)) return null

      const nextSegment = nextById.get(comment.segmentId)!
      const prevSegment = previous.segments.find((segment) => segment.id === comment.segmentId)
      const contentChanged =
        !prevSegment ||
        segmentSignature(prevSegment) !== segmentSignature(nextSegment)
      const levelChanged = prevSegment?.level !== nextSegment.level
      const inherited: ReviewComment = {
        ...comment,
        id: uniqueId('RV'),
        versionId: nextVersionId,
        originVersionId: comment.originVersionId ?? previous.id,
        originCommentId: comment.originCommentId ?? comment.id,
        inherited: true,
      }
      if (levelChanged) {
        return { ...inherited, status: '待重新确认' as CommentStatus }
      }
      if (contentChanged && comment.status === '已接受') {
        return { ...inherited, status: '待确认' as CommentStatus }
      }
      // 未变化区段：意见与结论原样继承
      return inherited
    })
    .filter((comment): comment is ReviewComment => comment !== null)
}

/** 锁定前置条件：三方都接受，且高风险/绕行区段全部处理完 */
export function evaluateLock(version: RouteVersion): LockCheck {
  const acceptedByRole = new Map<ReviewRole, boolean>(REVIEW_ROLES.map((role) => [role, false]))
  for (const role of REVIEW_ROLES) {
    const roleComments = version.comments.filter((comment) => comment.role === role)
    acceptedByRole.set(
      role,
      roleComments.length > 0 && roleComments.every((comment) => comment.status === '已接受'),
    )
  }

  const pendingComments = version.comments.filter(
    (comment) => comment.status === '待确认' || comment.status === '待重新确认',
  )

  const highRisk: LockCheck['highRisk'] = version.segments
    .filter((segment) => segment.level === '高')
    .map((segment) => {
      const segmentComments = version.comments.filter((comment) => comment.segmentId === segment.id)
      const acceptedRoles = REVIEW_ROLES.filter((role) =>
        segmentComments.some((comment) => comment.role === role && comment.status === '已接受'),
      )
      return { segment, handled: segment.status !== '需绕行', acceptedRoles }
    })

  const reasons: string[] = []
  for (const role of REVIEW_ROLES) {
    if (!acceptedByRole.get(role)) reasons.push(`${role}专业意见尚未全部接受`)
  }
  if (pendingComments.length > 0) reasons.push(`还有 ${pendingComments.length} 条意见待确认/待重新确认`)
  const unhandled = highRisk.filter((item) => !item.handled)
  if (unhandled.length > 0) {
    reasons.push(`高风险区段仍需绕行处理：${unhandled.map((item) => item.segment.id).join('、')}`)
  }

  return {
    roles: REVIEW_ROLES.map((role) => ({ role, accepted: acceptedByRole.get(role)! })),
    pendingCount: pendingComments.length,
    highRisk,
    canLock: reasons.length === 0,
    reasons,
  }
}

export function createVersionFromPackage(route: RoutePackage, index: number): RouteVersion {
  const segments = route.segments.map((segment) => ({ ...segment, risks: [...segment.risks], coordinates: segment.coordinates.map((point) => [...point] as [number, number]) }))
  return {
    id: uniqueId('VER'),
    routeId: route.id,
    versionNo: index + 1,
    type: '基线',
    parentVersionId: null,
    locked: false,
    lockedAt: null,
    createdAt: dateTimeText(),
    note: '规则引擎首次编组生成',
    cargo: route.cargo,
    hazardClass: route.hazardClass,
    trainCode: route.trainCode,
    origin: route.origin,
    destination: route.destination,
    tonnage: route.tonnage,
    wagonCount: route.wagonCount,
    permit: route.permit,
    permission: route.permission,
    score: route.score,
    segments,
    comments: [],
  }
}

export function nextVersionType(type: VersionType): VersionType {
  return type === '基线' ? '绕行替代' : '修订'
}
