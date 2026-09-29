import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatDividerModule } from '@angular/material/divider'
import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import { length, lineString } from '@turf/turf'
import { VersionBarComponent } from './version-bar.component'
import type { RiskLevel, RiskSegment } from '../types'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { REVIEW_ROLES } from '../types'

@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatCheckboxModule, MatDividerModule, VersionBarComponent],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">地理风险叠加</p>
          <h1>路网与风险图层复核</h1>
          <p>风险调整写入当前路线版本；高风险区段通过「绕行重算」生成下一版本。</p>
        </div>
        <button mat-stroked-button (click)="fitRoute()">定位整条路径</button>
      </div>

      <app-version-bar />

      <div class="toolbar">
        <mat-checkbox [(ngModel)]="layers.tunnel" (change)="refreshLayers()">隧道</mat-checkbox>
        <mat-checkbox [(ngModel)]="layers.bridge" (change)="refreshLayers()">桥梁</mat-checkbox>
        <mat-checkbox [(ngModel)]="layers.water" (change)="refreshLayers()">水源地</mat-checkbox>
        <mat-checkbox [(ngModel)]="layers.population" (change)="refreshLayers()">人口密集区</mat-checkbox>
        @if (version) {
          <span class="state-tag" [class.locked]="version.locked">{{ version.locked ? '🔒 已锁定，风险只读' : '✎ 工作版本，可调整风险' }}</span>
        }
      </div>

      <div class="grid-2">
        <div #mapEl class="map"></div>
        <aside class="card">
          <div class="panel-head">
            <div><h2>区段风险清单</h2><p>当前版本：{{version?.id}}</p></div>
          </div>
          @for (segment of version?.segments ?? []; track segment.id) {
            <button class="segment" [class.active]="segment.id === selectedSegmentId" (click)="selectSegment(segment)">
              <span>
                <b>{{segment.name}}</b>
                <small>{{segment.id}} · {{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</small>
                <em>{{segment.risks.join(' / ')}}</em>
                <small class="change" [class.reroute]="segment.change==='reroute'">
                  {{ segment.change === 'reroute' ? '本版本绕行重算（取代 ' + segment.replacedFrom + '）' : '由上一版本复制，风险未变化' }}
                </small>
              </span>
              <strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
            </button>
          }
          <mat-divider />

          @if (selectedSegment; as seg) {
            <h3>区段处置</h3>
            <div class="signoff-row">
              @for (role of roles; track role) {
                <span class="sign-dot" [class.ok]="isAccepted(seg.id, role)">{{role}}{{ isAccepted(seg.id, role) ? '✓' : '…' }}</span>
              }
            </div>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="level-select">
              <mat-label>风险等级（写入当前版本）</mat-label>
              <mat-select [ngModel]="seg.level" [disabled]="!!version?.locked" (ngModelChange)="changeLevel($event)">
                <mat-option value="高">高</mat-option>
                <mat-option value="中">中</mat-option>
                <mat-option value="低">低</mat-option>
              </mat-select>
            </mat-form-field>
            <p class="muted">
              改为「高」将标记需绕行并重置该区段会签；相关已接受安全/运营/应急意见转入待重新确认。
            </p>
          }

          <h3>路径测算</h3>
          <p class="muted">实测里程：{{routeLength}} km · 预计运行：{{estimatedTime}} · 待绕行高风险：{{restrictedCount}} 处</p>

          <button mat-flat-button color="primary" class="wide-btn" (click)="createAlternative()">
            {{ version?.locked ? '基于锁定版本另开并绕行' : (restrictedCount > 0 ? '生成绕行替代方案（新版本）' : '基于当前版本生成新版本') }}
          </button>
          @if (version) {
            <p class="muted">新版本复制全部区段；{{restrictedCount}} 个高风险区段绕行重算，其余区段意见与会签原样继承。</p>
          }
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.panel-head{display:flex;justify-content:space-between;margin-bottom:6px}
    .segment{width:100%;display:flex;justify-content:space-between;text-align:left;gap:10px;padding:13px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;color:inherit;cursor:pointer}
    .segment.active{border-color:#2563eb;background:#f5f8ff}.segment b,.segment small,.segment em{display:block}.segment small{color:#7a8798;margin:4px 0}.segment em{font-size:12px;color:#475569;font-style:normal}
    .change{color:#15803d}.change.reroute{color:#d97706}
    .muted{color:#7a8798;font-size:12px;margin:6px 0}
    .level-select{width:100%}.wide-btn{width:100%;margin-top:8px}
    .signoff-row{display:flex;gap:8px;margin:8px 0}.sign-dot{font-size:11px;border:1px solid #cbd5e1;border-radius:10px;padding:2px 8px;color:#667085}.sign-dot.ok{border-color:#86efac;color:#15803d;background:#f0fdf4}
    .state-tag{font-size:12px;font-weight:700;color:#d97706}.state-tag.locked{color:#1d4ed8}
  `],
})
export class RiskMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  private map?: MapLibreMap
  private mapReady = false
  selectedSegmentId = ''
  layers = { tunnel: true, bridge: true, water: true, population: true }
  protected readonly roles = REVIEW_ROLES

  state: RouteState = { routes: [], selectedRouteId: '', selectedVersionId: '', selectedSegmentId: '', loading: false, error: '' }

  constructor() {
    this.state$.subscribe((state) => {
      this.state = state
      this.selectedSegmentId = state.selectedSegmentId
      if (this.mapReady) this.drawRoute()
    })
  }

  get route() { return this.state.routes.find((item) => item.id === this.state.selectedRouteId) }
  get version() {
    return this.route?.versions.find((v) => v.id === this.state.selectedVersionId)
      ?? this.route?.versions.find((v) => v.id === this.route?.currentVersionId)
  }
  get selectedSegment(): RiskSegment | undefined {
    return this.version?.segments.find((s) => s.id === this.selectedSegmentId)
  }
  get routeLength() {
    return this.version
      ? length(lineString(this.version.segments.flatMap((segment) => segment.coordinates)), { units: 'kilometers' }).toFixed(1)
      : '0.0'
  }
  get estimatedTime() { return `${Math.round(Number(this.routeLength) / 55 * 60 + this.restrictedCount * 8)} 分钟` }
  get restrictedCount() { return this.version?.segments.filter((segment) => segment.level === '高' && segment.status === '需绕行').length ?? 0 }

  isAccepted(segmentId: string, role: string) {
    return this.version?.signoffs[segmentId]?.some((s) => s.role === role && s.status === '已接受') ?? false
  }

  ngAfterViewInit() {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
      center: [112.2, 34.5], zoom: 5,
    })
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right')
    this.map.on('load', () => { this.mapReady = true; this.addRiskLayers(); this.drawRoute() })
  }
  ngOnDestroy() { this.map?.remove() }

  selectSegment(segment: RiskSegment) {
    this.store.dispatch(RouteActions.selectSegment({ id: segment.id }))
    this.map?.flyTo({ center: segment.coordinates[0], zoom: 8 })
  }

  changeLevel(level: RiskLevel) {
    if (this.route && this.version && this.selectedSegmentId) {
      this.store.dispatch(RouteActions.updateSegmentLevel({
        routeId: this.route.id, versionId: this.version.id, segmentId: this.selectedSegmentId, level,
      }))
    }
  }

  createAlternative() {
    if (this.route) this.store.dispatch(RouteActions.createAlternative({ routeId: this.route.id }))
  }

  fitRoute() {
    if (!this.map || !this.version) return
    const bounds = new LngLatBounds()
    this.version.segments.flatMap((segment) => segment.coordinates).forEach((point) => bounds.extend(point))
    this.map.fitBounds(bounds, { padding: 50 })
  }

  refreshLayers() {
    for (const [id, visible] of Object.entries(this.layers)) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }

  private addRiskLayers() {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [
      { type: 'Feature', properties: { kind: 'tunnel' }, geometry: { type: 'Point', coordinates: [114.3, 35.2] } },
      { type: 'Feature', properties: { kind: 'bridge' }, geometry: { type: 'Point', coordinates: [116.1, 34.2] } },
      { type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'Point', coordinates: [110.4, 34.8] } },
      { type: 'Feature', properties: { kind: 'population' }, geometry: { type: 'Point', coordinates: [118.0, 35.8] } },
    ]
    const colors: Record<string, string> = { tunnel: '#4f46e5', bridge: '#d97706', water: '#0891b2', population: '#dc2626' }
    Object.entries(colors).forEach(([kind, color]) => {
      this.map?.addSource(kind, { type: 'geojson', data: { type: 'FeatureCollection', features: features.filter((feature) => feature.properties?.['kind'] === kind) } })
      this.map?.addLayer({ id: kind, type: 'circle', source: kind, paint: { 'circle-radius': 10, 'circle-color': color, 'circle-opacity': .75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    })
  }

  private drawRoute() {
    if (!this.map?.isStyleLoaded() || !this.version) return
    for (const [layer, source] of [['route-line', 'route'], ['reroute-line', 'reroute']] as const) {
      if (this.map.getLayer(layer)) this.map.removeLayer(layer)
      if (this.map.getSource(source)) this.map.removeSource(source)
    }
    const copied = this.version.segments.filter((s) => s.change === 'copy')
    const rerouted = this.version.segments.filter((s) => s.change === 'reroute')
    this.map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: copied.map((s) => s.coordinates) } } })
    this.map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': .9 } })
    this.map.addSource('reroute', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: rerouted.map((s) => s.coordinates) } } })
    this.map.addLayer({ id: 'reroute-line', type: 'line', source: 'reroute', paint: { 'line-color': '#d97706', 'line-width': 5, 'line-dasharray': [1.5, 1], 'line-opacity': .95 } })
  }
}
