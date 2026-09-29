import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { MatTooltipModule } from '@angular/material/tooltip'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { recalcScore } from '../services/route-domain'
import type { RoutePackage, RouteVersion } from '../types'

@Component({
  selector: 'app-version-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatSelectModule, MatButtonModule, MatChipsModule, MatTooltipModule],
  template: `
    <section class="card version-bar">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>运输单</mat-label>
        <mat-select [ngModel]="route?.id" (ngModelChange)="selectRoute($event)">
          @for (item of routes; track item.id) {
            <mat-option [value]="item.id">{{item.id}} · {{item.trainCode}}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <div class="versions">
        <span class="caption">路线版本</span>
        @for (v of route?.versions ?? []; track v.id) {
          <button
            type="button"
            class="v-chip"
            [class.active]="v.id === version?.id"
            [class.locked]="v.locked"
            [matTooltip]="v.note"
            (click)="selectVersion(v)">
            v{{v.versionNo}}@if (v.locked) {<span class="lock">锁</span>}
          </button>
        }
      </div>

      <div class="meta">
        <span class="state-chip" [class.locked]="version?.locked">
          {{ version?.locked ? '已锁定 · 只读' : '工作版本' }}
        </span>
        @if (version) {
          <small>风险分 <b [class.risk-high]="routeScore >= 70" [class.risk-mid]="routeScore >= 45 && routeScore < 70">{{routeScore}}</b></small>
          <small>区段 {{version.segments.length}}</small>
          <small>待确认意见 {{pendingComments}}</small>
          <small>未会签区段 {{pendingSignoffs}}</small>
        }
      </div>

      <span class="spacer"></span>
      <button mat-stroked-button color="primary" [disabled]="!route" (click)="createAlternative()">
        {{ version?.locked ? '锁定版本另开新版本' : '生成替代方案 / 绕行' }}
      </button>
    </section>
  `,
  styles: [`
    .version-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;padding:12px 16px}
    .version-bar mat-form-field{width:230px}
    .versions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .caption{color:#667085;font-size:12px}
    .v-chip{border:1px solid #cbd5e1;background:#fff;border-radius:16px;padding:4px 12px;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:5px;color:#334155}
    .v-chip.active{background:#2563eb;border-color:#2563eb;color:#fff}
    .v-chip.locked{border-color:#0f172a}
    .v-chip .lock{display:inline-grid;place-items:center;background:#0f172a;color:#fff;border-radius:50%;width:15px;height:15px;font-size:10px;line-height:1}
    .v-chip.active .lock{background:#fff;color:#2563eb}
    .meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .meta small{color:#667085;font-size:12px}.meta b{font-size:14px}
    .state-chip{font-size:12px;font-weight:700;color:#d97706;border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:3px 10px}
    .state-chip.locked{color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}
  `],
})
export class VersionBarComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  routes: RoutePackage[] = []
  route?: RoutePackage
  version?: RouteVersion

  constructor() {
    this.state$.subscribe((state) => {
      this.routes = state.routes
      this.route = state.routes.find((item: RoutePackage) => item.id === state.selectedRouteId)
      this.version = this.route?.versions.find((v) => v.id === state.selectedVersionId)
        ?? this.route?.versions.find((v) => v.id === this.route?.currentVersionId)
    })
  }

  get routeScore(): number {
    return this.version ? recalcScore(this.version.segments) : 0
  }

  get pendingComments(): number {
    return this.version?.comments.filter((c) => c.status === '待确认').length ?? 0
  }

  get pendingSignoffs(): number {
    if (!this.version) return 0
    return this.version.segments.filter((segment) =>
      (this.version!.signoffs[segment.id] ?? []).some((s) => s.status !== '已接受'),
    ).length
  }

  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })) }
  selectVersion(v: RouteVersion) {
    if (this.route) this.store.dispatch(RouteActions.selectVersion({ routeId: this.route.id, versionId: v.id }))
  }
  createAlternative() {
    if (this.route) this.store.dispatch(RouteActions.createAlternative({ routeId: this.route.id }))
  }
}
