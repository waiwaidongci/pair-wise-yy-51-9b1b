import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { checkLock } from '../services/route-domain'
import { VersionBarComponent } from './version-bar.component'
import type { RiskSegment, RoutePackage } from '../types'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatProgressBarModule, MatDividerModule, VersionBarComponent],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">运输许可与路径编组</p>
          <h1>危险货物运输路径审批</h1>
          <p>核对货物类别、编组、许可与区段约束；所有页面共用同一份路线版本。</p>
        </div>
        <button mat-stroked-button (click)="refresh()">重新校验本地数据</button>
      </div>

      <app-version-bar />

      <div class="grid-4">
        <article class="card metric"><span>在册运输单</span><strong>{{ state.routes.length }}</strong><small>锁定版本只读保留</small></article>
        <article class="card metric"><span>当前版本高风险区段</span><strong class="risk-high">{{ highRiskCount }}</strong><small>须绕行处理并完成三方会签</small></article>
        <article class="card metric"><span>待重新确认意见</span><strong class="risk-mid">{{ pendingComments }}</strong><small>风险变化后自动转入</small></article>
        <article class="card metric"><span>路线版本总数</span><strong>{{ totalVersions }}</strong><small>旧版本均可回看</small></article>
      </div>

      @if (state.loading) { <mat-progress-bar mode="indeterminate" /> }

      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar">
            <h2>运输单与当前版本</h2>
            <span class="spacer"></span>
            <button mat-stroked-button [disabled]="!route" (click)="createAlternative()">生成替代方案</button>
          </div>
          <table mat-table [dataSource]="state.routes">
            <ng-container matColumnDef="id">
              <th mat-header-cell *matHeaderCellDef>运输单</th>
              <td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">v{{ currentVersionNo(row) }} · {{row.updatedAt}}</small></td>
            </ng-container>
            <ng-container matColumnDef="cargo">
              <th mat-header-cell *matHeaderCellDef>货物 / 车次</th>
              <td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td>
            </ng-container>
            <ng-container matColumnDef="route">
              <th mat-header-cell *matHeaderCellDef>起终点</th>
              <td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}</td>
            </ng-container>
            <ng-container matColumnDef="permission">
              <th mat-header-cell *matHeaderCellDef>许可</th>
              <td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span></td>
            </ng-container>
            <ng-container matColumnDef="score">
              <th mat-header-cell *matHeaderCellDef>当前版本风险分</th>
              <td mat-cell *matCellDef="let row">
                <b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100
                @if (currentVersion(row)?.locked) { <small class="block">基线已锁定</small> }
              </td>
            </ng-container>
            <ng-container matColumnDef="action">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">切换到此单</button></td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === state.selectedRouteId"></tr>
          </table>
        </section>

        <aside class="card">
          <h2>当前版本编组（{{ version?.id }}）</h2>
          @if (!version) { <p class="muted">请选择运输单</p> }
          @if (version) {
            <div class="lock-line" [class.locked]="version.locked">
              {{ version.locked ? '🔒 版本已于 ' + version.lockedAt + ' 锁定，路径/风险/会签不可修改' : '✎ 工作版本，可调整区段风险' }}
            </div>
            <p class="muted">{{ version.note }}</p>
            @for (segment of version.segments; track segment.id) {
              <div class="rule" [class.active]="segment.id === state.selectedSegmentId">
                <div>
                  <b>{{segment.name}}</b>
                  <span>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</span>
                  <em class="change" [class.reroute]="segment.change==='reroute'">
                    {{ segment.change === 'reroute' ? '绕行重算（原区段 ' + segment.replacedFrom + '）' : '复制自上一版本（未变化）' }}
                  </em>
                </div>
                <strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
              </div>
            }
            <mat-divider />
            <h3>锁定前置校验（基于当前版本）</h3>
            <p [class.risk-low]="lockCheck.pendingSegments === 0">
              {{ lockCheck.pendingSegments === 0 ? '✓' : '!' }} 三方会签：{{ lockCheck.pendingSegments === 0 ? '全部区段三方已接受' : lockCheck.pendingSegments + ' 个区段尚有角色未接受' }}
            </p>
            <p [class.risk-low]="lockCheck.unresolvedHighRisk.length === 0" [class.risk-high]="lockCheck.unresolvedHighRisk.length > 0">
              {{ lockCheck.unresolvedHighRisk.length === 0 ? '✓' : '!' }} 高风险绕行：
              {{ lockCheck.unresolvedHighRisk.length === 0 ? '无未处理的高风险区段' : unresolvedHighRiskText + ' 仍需绕行' }}
            </p>
            <p [class.risk-low]="lockCheck.pendingComments === 0" [class.risk-mid]="lockCheck.pendingComments > 0">
              {{ lockCheck.pendingComments === 0 ? '✓' : '!' }} 意见状态：{{ lockCheck.pendingComments === 0 ? '无待确认意见' : lockCheck.pendingComments + ' 条意见待确认/重新确认' }}
            </p>
          }
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.table-wrap{overflow:auto}.toolbar{display:flex;align-items:center;margin-bottom:10px}
    .block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}
    .rule{display:flex;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #edf0f5}
    .rule span{display:block;color:#7a8798;font-size:12px;margin-top:4px}
    .rule em{display:block;font-style:normal;font-size:12px;margin-top:3px;color:#15803d}
    .rule em.reroute{color:#d97706}
    .rule.active{padding-left:10px;border-left:3px solid #2563eb}.rule strong{font-size:12px;align-self:center}
    .muted{color:#7a8798;font-size:13px;margin:8px 0}
    .lock-line{font-size:13px;font-weight:700;color:#d97706;margin-bottom:6px}
    .lock-line.locked{color:#1d4ed8}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'action']
  state: RouteState = { routes: [], selectedRouteId: '', selectedVersionId: '', selectedSegmentId: '', loading: false, error: '' }

  constructor() {
    this.store.select('routes').subscribe((state) => { this.state = state })
  }

  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }
  createAlternative() {
    if (this.state.selectedRouteId) this.store.dispatch(RouteActions.createAlternative({ routeId: this.state.selectedRouteId }))
  }

  currentVersion(row: RoutePackage) {
    return row.versions.find((v) => v.id === row.currentVersionId)
  }
  currentVersionNo(row: RoutePackage) {
    return this.currentVersion(row)?.versionNo ?? '—'
  }

  get route() {
    return this.state.routes.find((row) => row.id === this.state.selectedRouteId)
  }
  get version() {
    return this.route?.versions.find((v) => v.id === this.state.selectedVersionId)
      ?? this.route?.versions.find((v) => v.id === this.route?.currentVersionId)
  }
  get highRiskCount() {
    return this.version?.segments.filter((s) => s.level === '高').length ?? 0
  }
  get pendingComments() {
    return this.version?.comments.filter((c) => c.status === '待确认').length ?? 0
  }
  get totalVersions() {
    return this.state.routes.reduce((sum, row) => sum + row.versions.length, 0)
  }
  get lockCheck() {
    const empty = { canLock: false, pendingSegments: 0, unresolvedHighRisk: [] as RiskSegment[], pendingComments: 0 }
    return this.version ? checkLock(this.version) : empty
  }
  get unresolvedHighRiskText() {
    return this.lockCheck.unresolvedHighRisk.map((segment) => segment.id).join('、')
  }
}
