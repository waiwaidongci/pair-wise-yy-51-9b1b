import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { map } from 'rxjs'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { selectLatestByRoute, selectRouteVersions, selectSelectedVersion } from '../store/route.selectors'
import type { RouteVersion } from '../types'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatDividerModule, MatChipsModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">运输许可与路径编组</p><h1>危险货物运输路径审批</h1><p>候选路径按版本管理，路径、风险与三方会签锚定同一份路线版本。</p></div>
        <div>
          @if (current$ | async; as current) {
            @if (current.locked) {
              <button mat-stroked-button (click)="revise(current)">基于 v{{current.versionNo}} 另开修订</button>
            } @else {
              <button mat-stroked-button (click)="createAlternative()">生成绕行替代方案</button>
            }
          }
          <button mat-flat-button color="primary" (click)="refresh()">重新校验</button>
        </div>
      </div>
      <div class="grid-4">
        <article class="card metric"><span>运输单</span><strong>{{ (latest$ | async)?.size || 0 }}</strong><small>按最新版本统计</small></article>
        <article class="card metric"><span>高风险区段</span><strong class="risk-high">{{ highRiskCount$ | async }}</strong><small>需绕行并经三方会签</small></article>
        <article class="card metric"><span>待重新确认意见</span><strong class="risk-mid">{{ pendingCount$ | async }}</strong><small>风险变化后需重签</small></article>
        <article class="card metric"><span>当前版本</span><strong>v{{ (current$ | async)?.versionNo || '—' }}</strong><small>{{ (current$ | async)?.locked ? '已锁定 · 只读' : '未锁定 · 可调整' }}</small></article>
      </div>
      @if ((state$ | async)?.loading) { <mat-progress-bar mode="indeterminate" /> }
      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>货物类别</mat-label><mat-select><mat-option>全部类别</mat-option><mat-option>第 3 类 易燃液体</mat-option><mat-option>第 8 类 腐蚀品</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批状态</mat-label><mat-select><mat-option>全部状态</mat-option><mat-option>待安全复核</mat-option><mat-option>待应急复核</mat-option></mat-select></mat-form-field>
            <span class="spacer"></span><button mat-stroked-button>导出审批包</button>
          </div>
          <table mat-table [dataSource]="(routeRows$ | async) ?? []">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let row"><b>{{row.routeId}}</b><small class="block">v{{row.versionNo}} · {{row.type}} · {{row.createdAt}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}</td></ng-container>
            <ng-container matColumnDef="permission"><th mat-header-cell *matHeaderCellDef>许可</th><td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span></td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=55" [class.risk-mid]="row.score>=30 && row.score<55">{{row.score}}</b> / 100</td></ng-container>
            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>版本状态</th><td mat-cell *matCellDef="let row"><mat-chip [highlighted]="row.locked" [color]="row.locked ? 'primary' : 'default'">{{row.locked ? '已锁定 v'+row.versionNo : '工作中 v'+row.versionNo}}</mat-chip></td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="selectRoute(row.routeId)">查看版本</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.routeId === (state$ | async)?.selectedRouteId"></tr>
          </table>
        </section>
        <aside class="card">
          <h2>当前运输单版本链</h2>
          @if (current$ | async; as current) {
            <p class="muted">{{current.routeId}} · {{current.origin}} → {{current.destination}}</p>
          }
          @for (version of routeVersions$ | async; track version.id) {
            <button class="version" [class.active]="version.id === (state$ | async)?.selectedVersionId" (click)="selectVersion(version.id)">
              <div>
                <b>v{{version.versionNo}} · {{version.type}}</b>
                <span>{{version.createdAt}} · {{version.segments.length}} 区段 · 风险分 {{version.score}}</span>
                <em>{{version.note}}</em>
              </div>
              <strong [class.risk-high]="!version.locked" [class.risk-low]="version.locked">{{version.locked ? '已锁定' : '工作中'}}</strong>
            </button>
          } @empty {
            <p class="muted">暂无版本数据。</p>
          }
          <mat-divider />
          <h3>版本规则</h3>
          <p class="rule-line">✓ 生成替代方案：复制当前全部区段，高风险区段绕行并重算风险</p>
          <p class="rule-line">✓ 未变化区段继承原有安全/运营/应急意见；风险等级变化转待重新确认</p>
          <p class="rule-line risk-high">! 已锁定版本的路径、风险与会签结果只读，调整须另开版本</p>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.muted{color:#7a8798;font-size:12px;margin:2px 0 10px}.table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}
    .toolbar{margin-bottom:10px}.toolbar mat-form-field{width:160px}
    .version{width:100%;display:flex;justify-content:space-between;text-align:left;gap:10px;padding:12px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;color:inherit;cursor:pointer}
    .version.active{border-color:#2563eb;background:#f5f8ff}.version b,.version span,.version em{display:block}.version span{color:#7a8798;font-size:12px;margin:4px 0}.version em{font-size:12px;color:#475569;font-style:normal}
    .rule-line{font-size:13px;color:#475569;margin:8px 0}
  `],
})
export class WorkspaceComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly latest$ = this.store.select(selectLatestByRoute)
  readonly current$ = this.store.select(selectSelectedVersion)
  readonly routeVersions$ = this.store.select(selectRouteVersions)
  readonly routeRows$ = this.store.select(selectLatestByRoute).pipe(
    mapLatestVersions(),
  )
  readonly highRiskCount$ = this.store.select(selectSelectedVersion).pipe(
    mapVersion((version) => version.segments.filter((segment) => segment.level === '高').length),
  )
  readonly pendingCount$ = this.store.select(selectSelectedVersion).pipe(
    mapVersion((version) => version.comments.filter((comment) => comment.status === '待确认' || comment.status === '待重新确认').length),
  )
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'status', 'action']

  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  selectRoute(routeId: string) { this.store.dispatch(RouteActions.selectRoute({ id: routeId })) }
  selectVersion(versionId: string) { this.store.dispatch(RouteActions.selectVersion({ versionId })) }
  createAlternative() { this.store.dispatch(RouteActions.createAlternative()) }
  revise(version: RouteVersion) { this.store.dispatch(RouteActions.reviseVersion({ versionId: version.id })) }
}

function mapLatestVersions() {
  return map((latest: Map<string, RouteVersion>) =>
    [...latest.values()].map((version) => ({
      routeId: version.routeId,
      versionNo: version.versionNo,
      type: version.type,
      createdAt: version.createdAt,
      cargo: version.cargo,
      hazardClass: version.hazardClass,
      trainCode: version.trainCode,
      origin: version.origin,
      destination: version.destination,
      permission: version.permission,
      score: version.score,
      locked: version.locked,
    })),
  )
}

function mapVersion<T>(project: (version: RouteVersion) => T) {
  return map((version: RouteVersion | undefined) => (version ? project(version) : 0))
}
