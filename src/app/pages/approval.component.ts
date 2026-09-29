import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { map } from 'rxjs'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { selectLockCheck, selectRouteVersions, selectSelectedVersion } from '../store/route.selectors'
import { REVIEW_ROLES } from '../store/route.domain'
import type { LockCheck, ReviewRole } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatChipsModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>逐区段审批与退回</h1><p>每条意见锚定版本与区段；风险等级变化后原意见转待重新确认。</p></div>
      </div>
      <div class="toolbar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>路线版本</mat-label><mat-select [ngModel]="(state$ | async)?.selectedVersionId" (ngModelChange)="selectVersion($event)">@for (version of routeVersions$ | async; track version.id) { <mat-option [value]="version.id">v{{version.versionNo}} · {{version.type}}{{version.locked ? ' · 已锁定' : ''}}</mat-option> }</mat-select></mat-form-field>
        <span class="spacer"></span>
        @if (current$ | async; as current) {
          @if (current.locked) {
            <mat-chip highlighted color="primary">🔒 v{{current.versionNo}} 已锁定 {{current.lockedAt}}</mat-chip>
            <button mat-stroked-button (click)="revise(current.id)">基于 v{{current.versionNo}} 另开修订</button>
          } @else {
            <button mat-flat-button color="primary" (click)="lockBaseline(current.id)">确认并锁定基线</button>
          }
        }
      </div>

      @if (current$ | async; as current) {
        <section class="card gate">
          <div class="gate-title"><b>锁定前置条件</b><span>三方都接受，且高风险绕行区段全部处理完，v{{current.versionNo}} 才能锁定</span></div>
          <div class="gate-grid">
            @for (item of (lockCheck$ | async)?.roles || []; track item.role) {
              <div class="gate-item" [class.ok]="item.accepted"><i>{{item.accepted ? '✓' : '!'}}</i><b>{{item.role}}专业</b><span>{{item.accepted ? '意见均已接受' : '存在未接受意见'}}</span></div>
            }
            <div class="gate-item" [class.ok]="(lockCheck$ | async)?.pendingCount === 0"><i>{{(lockCheck$ | async)?.pendingCount === 0 ? '✓' : '!'}}</i><b>待确认意见</b><span>{{(lockCheck$ | async)?.pendingCount || 0}} 条待处理</span></div>
            <div class="gate-item" [class.ok]="(unhandledHighRisk$ | async) === 0"><i>{{(unhandledHighRisk$ | async) === 0 ? '✓' : '!'}}</i><b>高风险绕行</b><span>{{unhandledHighRisk$ | async}} 个区段未处理</span></div>
          </div>
          @if ((state$ | async)?.lockError) {
            <p class="gate-error">无法锁定：{{ (state$ | async)?.lockError }}</p>
          }
        </section>
      }

      <mat-tab-group>
        <mat-tab label="待处理意见"><section class="card comment-list">
          @if (pendingComments$ | async; as pendingComments) {
            @for (comment of pendingComments; track comment.id) {
              <div class="comment" [class.reconfirm]="comment.status === '待重新确认'">
                <div class="comment-head">
                  <div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.id}} · {{comment.createdAt}}@if (comment.inherited) { · 继承自上一版本}</small></div>
                  <span [class.risk-mid]="comment.status === '待重新确认'">{{comment.status}}</span>
                </div>
                <p>{{comment.content}}</p>
                @if (!(current$ | async)?.locked) {
                  <div class="actions"><button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button><button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button></div>
                }
              </div>
            } @empty { <p class="empty">当前版本没有待确认/待重新确认的意见。</p> }
          }
        </section></mat-tab>
        <mat-tab label="全部意见"><section class="card comment-list">
          @if (allComments$ | async; as allComments) {
            @for (comment of allComments; track comment.id) {
              <div class="comment" [class.reconfirm]="comment.status === '待重新确认'">
                <div class="comment-head"><div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.createdAt}}@if (comment.inherited) { · 继承}</small></div><span [class.risk-low]="comment.status==='已接受'" [class.risk-mid]="comment.status==='待重新确认'" [class.risk-high]="comment.status==='已退回'">{{comment.status}}</span></div>
                <p>{{comment.content}}</p>
              </div>
            } @empty { <p class="empty">当前版本暂无会签意见。</p> }
          }
        </section></mat-tab>
        <mat-tab label="发表区段意见"><section class="card form-card">
          @if (current$ | async; as current) {
            @if (current.locked) {
              <p class="gate-error">版本已锁定，不能新增意见；请另开修订版本后再会签。</p>
            } @else {
              <div class="two">
                <mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role">@for (r of roles; track r) { <mat-option [value]="r">{{r}}</mat-option> }</mat-select></mat-form-field>
                <mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId">@for (segment of current.segments; track segment.id) { <mat-option [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option> }</mat-select></mat-form-field>
              </div>
              <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
              <button mat-flat-button color="primary" [disabled]="!content.trim() || !segmentId" (click)="addComment()">提交意见至 v{{current.versionNo}}</button>
            }
          }
        </section></mat-tab>
        <mat-tab label="审计时间线"><section class="card timeline">
          @for (entry of (timeline$ | async); track entry.id) {
            <div><i></i><b>{{entry.time}} · {{entry.message}}</b><p>{{entry.actor}} · 版本 {{entry.versionId.slice(-4)}}</p></div>
          } @empty { <p class="empty">暂无审计记录。</p> }
        </section></mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment.reconfirm{background:#fffbeb;border-left:3px solid #d97706}.comment-head{display:flex;justify-content:space-between}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}.empty{color:#7a8798;padding:14px}
    .gate{margin-bottom:14px}.gate-title{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:12px}.gate-title span{color:#7a8798;font-size:12px}.gate-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.gate-item{border:1px solid #e1e7ef;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:3px}.gate-item i{width:22px;height:22px;border-radius:50%;background:#fee2e2;color:#b91c1c;display:grid;place-items:center;font-style:normal;font-weight:700}.gate-item b{font-size:13px}.gate-item span{font-size:12px;color:#7a8798}.gate-item.ok i{background:#dcfce7;color:#15803d}.gate-error{color:#b91c1c;margin:10px 0 0;font-weight:600}
    @media(max-width:900px){.gate-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly current$ = this.store.select(selectSelectedVersion)
  readonly routeVersions$ = this.store.select(selectRouteVersions)
  readonly lockCheck$ = this.store.select(selectLockCheck)
  readonly unhandledHighRisk$ = this.store.select(selectLockCheck).pipe(
    mapLock((check) => check.highRisk.filter((item) => !item.handled).length),
  )
  readonly timeline$ = this.store.select((state) =>
    state.routes.audit.filter((entry: { versionId: string }) => entry.versionId === state.routes.selectedVersionId),
  )
  readonly roles: ReviewRole[] = REVIEW_ROLES
  readonly allComments$ = this.current$.pipe(map((version) => version?.comments ?? []))
  readonly pendingComments$ = this.allComments$.pipe(
    map((comments) => comments.filter((comment) => comment.status === '待确认' || comment.status === '待重新确认')),
  )
  role: ReviewRole = '安全'
  segmentId = ''
  content = ''

  constructor() {
    // 当前版本变化时（含页面重新进入），表单区段跟随版本首区段
    this.current$.pipe(takeUntilDestroyed()).subscribe((version) => {
      if (version && !version.segments.some((segment) => segment.id === this.segmentId)) {
        this.segmentId = version.segments[0]?.id ?? ''
      }
    })
  }

  selectVersion(versionId: string) {
    this.store.dispatch(RouteActions.selectVersion({ versionId }))
  }

  addComment() {
    if (!this.content.trim() || !this.segmentId) return
    this.store.dispatch(RouteActions.addComment({
      comment: { segmentId: this.segmentId, role: this.role, author: '当前审阅人', content: this.content.trim(), status: '待确认' },
    }))
    this.content = ''
  }

  resolve(commentId: string, status: '已接受' | '已退回') {
    let versionId = ''
    this.current$.subscribe((version) => { versionId = version?.id ?? '' }).unsubscribe()
    if (!versionId) return
    this.store.dispatch(RouteActions.resolveComment({ versionId, commentId, status }))
  }

  lockBaseline(versionId: string) { this.store.dispatch(RouteActions.lockVersion({ versionId })) }
  revise(versionId: string) { this.store.dispatch(RouteActions.reviseVersion({ versionId })) }
}

function mapLock(project: (check: LockCheck) => number) {
  return map((check: LockCheck | undefined) => (check ? project(check) : 0))
}
