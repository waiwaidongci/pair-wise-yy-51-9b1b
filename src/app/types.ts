export type RiskLevel = '高' | '中' | '低'

export type SegmentStatus = '待复核' | '已确认' | '需绕行'

export type CommentStatus = '待确认' | '已接受' | '已退回'

export type ReviewRole = '安全' | '运营' | '应急'

export const REVIEW_ROLES: ReviewRole[] = ['安全', '运营', '应急']

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
  /** 替代版本中由绕行取代的原区段 id；其余场景为空 */
  replacedFrom?: string
  /** 区段相对于父版本：复制（风险未变化）或绕行重算（风险已变化） */
  change: 'copy' | 'reroute'
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: ReviewRole
  author: string
  content: string
  status: CommentStatus
  /** 意见来源：本版本新发表，或由旧版本继承 */
  inherited?: boolean
  /** 继承后因风险等级变化而转入待重新确认 */
  needsReconfirm?: boolean
}

export type SignoffStatus = '待会签' | '已接受' | '已退回'

export interface SegmentSignoff {
  role: ReviewRole
  status: SignoffStatus
  actor: string
  at: string
}

export interface RouteEvent {
  id: string
  at: string
  label: string
  detail: string
}

export interface RouteVersion {
  /** 运输单号 + 版本号，如 HG-260929-018 / v1 */
  id: string
  versionNo: number
  parentVersionId?: string
  segments: RiskSegment[]
  comments: ReviewComment[]
  /** 每个区段三方会签结果，键为 segmentId */
  signoffs: Record<string, SegmentSignoff[]>
  locked: boolean
  lockedAt?: string
  createdAt: string
  note: string
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
  /** 当前（工作）版本风险分；锁定后冻结 */
  score: number
  updatedAt: string
  versions: RouteVersion[]
  currentVersionId: string
  events: RouteEvent[]
}
