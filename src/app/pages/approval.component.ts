import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatDividerModule } from '@angular/material/divider'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { checkLock, makeId } from '../services/route-domain'
import { REVIEW_ROLES, type ReviewRole, type RiskSegment, type SignoffStatus } from '../types'
import { VersionBarComponent } from './version-bar.component'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatDividerModule, VersionBarComponent],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">安全 · 运营 · 应急会签</p>
          <h1>逐区段审批与版本锁定</h1>
          <p>意见与会签全部锚定当前路线版本；风险变化时已接受意见自动转待重新确认。</p>
        </div>
        <button
          mat-flat-button color="primary"
          [disabled]="!version || version.locked || !lockCheck.canLock"
          [title]="lockHint"
          (click)="lockVersion()">
          {{ version?.locked ? '版本已锁定（只读）' : '确认并锁定当前版本' }}
        </button>
      </div>

      <app-version-bar />

      @if (version) {
        <section class="card gate">
          <div class="gate-title">
            <b>{{version.id}} · {{version.locked ? '已锁定基线' : '锁定前置条件'}}</b>
            @if (version.locked) { <span class="ok">🔒 {{version.lockedAt}} 锁定，路径、风险、会签均不可修改；如需调整请另开版本</span> }
          </div>
          @if (!version.locked) {
            <div class="gate-grid">
              <div [class.ok]="lockCheck.pendingSegments === 0" [class.bad]="lockCheck.pendingSegments > 0">
                <b>{{lockCheck.pendingSegments === 0 ? '✓' : '!'}} 三方会签</b>
                <small>{{lockCheck.pendingSegments === 0 ? '全部区段安全/运营/应急均已接受' : lockCheck.pendingSegments + ' 个区段存在未接受的会签'}}</small>
              </div>
              <div [class.ok]="lockCheck.unresolvedHighRisk.length === 0" [class.bad]="lockCheck.unresolvedHighRisk.length > 0">
                <b>{{lockCheck.unresolvedHighRisk.length === 0 ? '✓' : '!'}} 高风险绕行</b>
                <small>{{lockCheck.unresolvedHighRisk.length === 0 ? '高风险区段均已绕行处理' : unresolvedHighRiskText + ' 仍标记需绕行'}}</small>
              </div>
              <div [class.ok]="lockCheck.pendingComments === 0" [class.bad]="lockCheck.pendingComments > 0">
                <b>{{lockCheck.pendingComments === 0 ? '✓' : '!'}} 意见闭环</b>
                <small>{{lockCheck.pendingComments === 0 ? '没有待确认/待重新确认意见' : lockCheck.pendingComments + ' 条意见待确认'}}</small>
              </div>
            </div>
          }
        </section>
      }

      <mat-tab-group>
        <mat-tab [label]="segmentTabLabel">
          <section class="card sign-list">
            @if (!version) { <p class="muted">请先选择运输单与版本</p> }
            @for (segment of version?.segments ?? []; track segment.id) {
              <div class="seg-sign">
                <div class="seg-head">
                  <b>{{segment.name}}</b>
                  <span class="seg-meta">{{segment.id}} · {{segment.km}} km · {{segment.speed}} · {{segment.risks.join('/')}}</span>
                  <span class="lvl" [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</span>
                </div>
                @if (segment.change === 'reroute') {
                  <p class="badge warn">绕行重算区段（取代 {{segment.replacedFrom}}），会签需重新完成</p>
                }
                <div class="roles">
                  @for (role of roles; track role) {
                    <div class="role-row">
                      <span class="role-name">{{role}}</span>
                      <span class="role-state" [class.ok]="signStatus(segment.id, role)==='已接受'" [class.bad]="signStatus(segment.id, role)==='已退回'">
                        {{ signStatus(segment.id, role) }}
                        <small>{{ signActor(segment.id, role) }}</small>
                      </span>
                      <div class="btns">
                        <button mat-stroked-button color="primary" [disabled]="readonly"
                          [class.picked]="signStatus(segment.id, role)==='已接受'"
                          (click)="sign(segment.id, role, '已接受')">接受</button>
                        <button mat-stroked-button color="warn" [disabled]="readonly"
                          [class.picked]="signStatus(segment.id, role)==='已退回'"
                          (click)="sign(segment.id, role, '已退回')">退回</button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </section>
        </mat-tab>

        <mat-tab [label]="commentTabLabel">
          <section class="card comment-list">
            @if (!version) { <p class="muted">请先选择运输单与版本</p> }
            @for (comment of versionComments(); track comment.id) {
              <div class="comment" [class.reconfirm]="comment.needsReconfirm" [class.inherited]="comment.inherited && !comment.needsReconfirm">
                <div class="comment-head">
                  <div>
                    <b>{{comment.role}} · {{comment.author}}</b>
                    <small>{{comment.segmentId}} · {{comment.id}}</small>
                  </div>
                  <div class="tags">
                    @if (comment.inherited) { <span class="badge">继承自上一版本</span> }
                    @if (comment.needsReconfirm) { <span class="badge warn">风险已变 · 待重新确认</span> }
                    <span class="status" [class.pending]="comment.status==='待确认'" [class.ok]="comment.status==='已接受'" [class.bad]="comment.status==='已退回'">{{comment.status}}</span>
                  </div>
                </div>
                <p>{{comment.content}}</p>
                <div class="actions">
                  <button mat-stroked-button color="warn" [disabled]="readonly" (click)="resolve(comment.id,'已退回')">退回补件</button>
                  <button mat-flat-button color="primary" [disabled]="readonly" (click)="resolve(comment.id,'已接受')">接受条件</button>
                </div>
              </div>
            } @empty {
              <p class="muted">当前版本暂无意见</p>
            }
          </section>
        </mat-tab>

        <mat-tab label="发表区段意见">
          <section class="card form-card">
            @if (readonly) {
              <p class="badge warn">当前版本已锁定，意见只读；如需补充请在上方「另开新版本」后提交。</p>
            }
            <div class="two">
              <mat-form-field><mat-label>专业角色</mat-label>
                <mat-select [(ngModel)]="role"><mat-option *ngFor="let r of roles" [value]="r">{{r}}</mat-option></mat-select>
              </mat-form-field>
              <mat-form-field><mat-label>区段（当前版本）</mat-label>
                <mat-select [(ngModel)]="segmentId">
                  <mat-option *ngFor="let segment of (version?.segments ?? [])" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label>
              <textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据；意见锚定本版本，不会串到其他版本"></textarea>
            </mat-form-field>
            <button mat-flat-button color="primary" [disabled]="readonly || !canSubmit" (click)="addComment()">提交意见</button>
          </section>
        </mat-tab>

        <mat-tab label="审计时间线">
          <section class="card timeline">
            @for (event of route?.events ?? []; track event.id) {
              <div><i></i><b>{{event.at}} · {{event.label}}</b><p>{{event.detail}}</p></div>
            } @empty {
              <p class="muted">暂无审计记录</p>
            }
          </section>
        </mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0}.gate{margin-bottom:14px}.gate-title{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
    .gate-title .ok{color:#15803d;font-size:13px;font-weight:700}
    .gate-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .gate-grid>div{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}.gate-grid b,.gate-grid small{display:block}.gate-grid small{color:#667085;margin-top:4px;font-weight:400}
    .gate-grid .ok{border-color:#86efac;background:#f0fdf4}.gate-grid .ok b{color:#15803d}
    .gate-grid .bad{border-color:#fecaca;background:#fef2f2}.gate-grid .bad b{color:#dc2626}
    .sign-list{padding:6px 16px}.seg-sign{padding:16px 0;border-bottom:1px solid #e7ebf1}
    .seg-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.seg-meta{color:#7a8798;font-size:12px}.lvl{margin-left:auto;font-size:12px;font-weight:700}
    .roles{margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .role-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid #eef2f7;border-radius:8px;padding:8px 10px;background:#fbfdff}
    .role-name{font-weight:700;font-size:13px;min-width:32px}
    .role-state{font-size:12px;color:#667085}.role-state small{display:block;color:#94a3b8}
    .role-state.ok{color:#15803d;font-weight:700}.role-state.bad{color:#dc2626;font-weight:700}
    .btns{margin-left:auto;display:flex;gap:6px}.btns .picked{border-width:2px}
    .badge{display:inline-block;font-size:11px;border:1px solid #cbd5e1;background:#f1f5f9;color:#475569;border-radius:10px;padding:2px 8px;margin-right:6px}
    .badge.warn{border-color:#fcd34d;background:#fffbeb;color:#b45309;font-weight:700}
    .comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1;border-left:3px solid #2563eb}
    .comment.reconfirm{border-left-color:#d97706;background:#fffdf5}.comment.inherited{border-left-color:#86efac}
    .comment-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.comment-head small{display:block;color:#7a8798;margin-top:4px}
    .comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}
    .tags{display:flex;align-items:center;gap:6px}
    .status{font-size:12px;font-weight:700}.status.pending{color:#d97706}.status.ok{color:#15803d}.status.bad{color:#dc2626}
    .form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}
    .timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}
    .timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}
    .muted{color:#7a8798;font-size:13px;padding:14px}
    @media(max-width:900px){.gate-grid,.roles{grid-template-columns:1fr}.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  protected readonly roles = REVIEW_ROLES
  role: ReviewRole = '安全'
  segmentId = ''
  content = ''
  state: RouteState = { routes: [], selectedRouteId: '', selectedVersionId: '', selectedSegmentId: '', loading: false, error: '' }

  constructor() {
    this.state$.subscribe((state) => {
      this.state = state
      // 区段选择跟随当前版本，避免表单锚到别的版本
      if (!this.version?.segments.some((s: RiskSegment) => s.id === this.segmentId)) {
        this.segmentId = this.version?.segments[0]?.id ?? ''
      }
    })
  }

  get route() { return this.state.routes.find((item) => item.id === this.state.selectedRouteId) }
  get version() {
    return this.route?.versions.find((v) => v.id === this.state.selectedVersionId)
      ?? this.route?.versions.find((v) => v.id === this.route?.currentVersionId)
  }
  get readonly() { return !!this.version?.locked }
  get canSubmit() { return this.content.trim() !== '' && this.segmentId !== '' }
  get lockCheck() {
    const empty = { canLock: false, pendingSegments: 0, unresolvedHighRisk: [] as RiskSegment[], pendingComments: 0 }
    return this.version ? checkLock(this.version) : empty
  }
  get unresolvedHighRiskText() {
    return this.lockCheck.unresolvedHighRisk.map((segment) => segment.id).join('、')
  }
  get segmentTabLabel() { return `逐区段会签 (${this.version?.segments.length ?? 0})` }
  get commentTabLabel() { return `意见处理 (${this.pendingCount})` }
  get lockHint(): string {
    if (!this.version) return '请先选择版本'
    if (this.version.locked) return '版本已锁定'
    const c = this.lockCheck
    if (c.canLock) return '三方接受、高风险绕行完成，可锁定基线'
    const parts: string[] = []
    if (c.pendingSegments) parts.push(`${c.pendingSegments} 个区段会签未齐`)
    if (c.unresolvedHighRisk.length) parts.push(`${c.unresolvedHighRisk.length} 个高风险区段未绕行`)
    if (c.pendingComments) parts.push(`${c.pendingComments} 条意见待确认`)
    return parts.join('；')
  }
  get pendingCount() { return this.version?.comments.filter((c) => c.status === '待确认').length ?? 0 }

  versionComments() {
    const comments = this.version?.comments ?? []
    return [...comments].sort((a, b) => {
      const rank = (s: string) => (s === '待确认' ? 0 : s === '已退回' ? 1 : 2)
      return rank(a.status) - rank(b.status)
    })
  }

  signStatus(segmentId: string, role: string): SignoffStatus {
    return this.version?.signoffs[segmentId]?.find((s) => s.role === role)?.status ?? '待会签'
  }
  signActor(segmentId: string, role: string) {
    return this.version?.signoffs[segmentId]?.find((s) => s.role === role)?.actor ?? ''
  }

  sign(segmentId: string, role: ReviewRole, status: SignoffStatus) {
    if (this.route && this.version) {
      this.store.dispatch(RouteActions.signSegment({ routeId: this.route.id, versionId: this.version.id, segmentId, role, status }))
    }
  }

  addComment() {
    if (!this.route || !this.version || !this.canSubmit) return
    this.store.dispatch(RouteActions.addComment({
      routeId: this.route.id,
      versionId: this.version.id,
      comment: { id: makeId('RV'), segmentId: this.segmentId, role: this.role, author: '当前审阅人', content: this.content.trim(), status: '待确认' },
    }))
    this.content = ''
  }

  resolve(commentId: string, status: '已接受' | '已退回') {
    if (this.route && this.version) {
      this.store.dispatch(RouteActions.resolveComment({ routeId: this.route.id, versionId: this.version.id, commentId, status }))
    }
  }

  lockVersion() {
    if (this.route && this.version && this.lockCheck.canLock) {
      this.store.dispatch(RouteActions.lockVersion({ routeId: this.route.id, versionId: this.version.id }))
    }
  }
}
