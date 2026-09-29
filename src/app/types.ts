export type RiskLevel = '高' | '中' | '低'

export type SegmentStatus = '待复核' | '已确认' | '需绕行'

export type ReviewRole = '安全' | '运营' | '应急'

export type CommentStatus = '待确认' | '已接受' | '已退回' | '待重新确认'

export type VersionType = '基线' | '绕行替代' | '修订'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: SegmentStatus
  coordinates: [number, number][]
}

export interface RoutePackage {
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
  segments: RiskSegment[]
}

/** 同一份运输单的一个路线版本：路径区段、风险结论、会签意见全部锚定在该版本上 */
export interface RouteVersion {
  id: string
  routeId: string
  versionNo: number
  type: VersionType
  parentVersionId: string | null
  locked: boolean
  lockedAt: string | null
  createdAt: string
  note: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: RoutePackage['permission']
  score: number
  segments: RiskSegment[]
  /** 本版本下的全部会签意见，随版本快照保存并继承 */
  comments: ReviewComment[]
}

export interface ReviewComment {
  id: string
  versionId: string
  segmentId: string
  role: ReviewRole
  author: string
  content: string
  status: CommentStatus
  /** 继承自哪个版本的哪条意见，用于审计追溯 */
  originVersionId?: string
  originCommentId?: string
  inherited?: boolean
  createdAt: string
}

export interface AuditEntry {
  id: string
  versionId: string
  time: string
  actor: string
  message: string
}

export interface HighRiskCheck {
  segment: RiskSegment
  handled: boolean
  acceptedRoles: ReviewRole[]
}

export interface LockCheck {
  roles: { role: ReviewRole; accepted: boolean }[]
  pendingCount: number
  highRisk: HighRiskCheck[]
  canLock: boolean
  reasons: string[]
}
