import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { Subscription } from 'rxjs'
import { MatButtonModule } from '@angular/material/button'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatDividerModule } from '@angular/material/divider'
import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import { length, lineString } from '@turf/turf'
import type { RiskLevel, RiskSegment, RouteVersion } from '../types'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { selectRouteVersions, selectSelectedVersion } from '../store/route.selectors'

@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatCheckboxModule, MatDividerModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">地理风险叠加</p><h1>路网与风险图层复核</h1><p>风险结论随版本保存；调整等级会让该区段会签意见转待重新确认。</p></div><button mat-stroked-button (click)="fitRoute()">定位整条路径</button></div>
      <div class="toolbar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>运输单</mat-label><mat-select [ngModel]="(state$ | async)?.selectedRouteId" (ngModelChange)="selectRoute($event)">@for (version of (latestOptions$ | async); track version.routeId) { <mat-option [value]="version.routeId">{{version.routeId}} · {{version.trainCode}}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>路线版本</mat-label><mat-select [ngModel]="(state$ | async)?.selectedVersionId" (ngModelChange)="selectVersion($event)">@for (version of routeVersions$ | async; track version.id) { <mat-option [value]="version.id">v{{version.versionNo}} · {{version.type}}{{version.locked ? ' · 已锁定' : ''}}</mat-option> }</mat-select></mat-form-field>
        <mat-checkbox [(ngModel)]="layers.tunnel" (change)="refreshLayers()">隧道</mat-checkbox><mat-checkbox [(ngModel)]="layers.bridge" (change)="refreshLayers()">桥梁</mat-checkbox><mat-checkbox [(ngModel)]="layers.water" (change)="refreshLayers()">水源地</mat-checkbox><mat-checkbox [(ngModel)]="layers.population" (change)="refreshLayers()">人口密集区</mat-checkbox>
      </div>
      @if (current$ | async; as current) {
        <div class="lock-banner" [class.locked]="current.locked">
          @if (current.locked) {
            🔒 v{{current.versionNo}} 已锁定（{{current.lockedAt}}）：路径、风险与会签结果只读，需要调整请在路径编组页另开修订版本。
          } @else {
            v{{current.versionNo}}（{{current.type}}）工作中：共 {{current.segments.length}} 个区段，{{highCount(current)}} 个高风险，{{pendingCount(current)}} 条意见待确认。
          }
        </div>
      }
      <div class="grid-2">
        <div #mapEl class="map"></div>
        <aside class="card">
          <div class="panel-head"><div><h2>区段风险清单</h2><p>风险等级由要素/限速/里程统一重算</p></div><strong [class.risk-high]="current !== undefined && current.score >= 55">总风险 {{current?.score}}</strong></div>
          @if (current; as currentVersion) {
            @for (segment of currentVersion.segments; track segment.id) {
            <div class="segment" [class.active]="segment.id === (state$ | async)?.selectedSegmentId">
              <button class="segment-main" (click)="selectSegment(segment)">
                <span><b>{{segment.name}}</b><small>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</small><em>{{segment.risks.join(' / ')}}</em><small class="status-line">状态：{{segment.status}}</small></span>
              </button>
              <div class="segment-side">
                <strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
                @if (!currentVersion.locked) {
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="level-select" (click)="$event.stopPropagation()">
                    <mat-select [ngModel]="segment.level" (ngModelChange)="setLevel(segment, $event)">
                      <mat-option value="高">高</mat-option><mat-option value="中">中</mat-option><mat-option value="低">低</mat-option>
                    </mat-select>
                  </mat-form-field>
                }
                @if (!currentVersion.locked && segment.status === '需绕行') {
                  <button mat-stroked-button color="primary" class="detour-btn" (click)="resolveDetour(segment); $event.stopPropagation()">绕行已处理</button>
                }
              </div>
            </div>
            }
          }
          <mat-divider />
          <h3>路径测算</h3><p>实测里程：{{routeLength}} km</p><p>预计运行：{{estimatedTime}}</p><p>限制区段：{{restrictedCount}} 处</p>
          @if (current$ | async; as current) {
            @if (current.locked) {
              <button mat-flat-button disabled style="width:100%">版本已锁定，不能修改风险</button>
            } @else {
              <button mat-flat-button color="primary" style="width:100%" (click)="requireAlternative()">生成绕行替代方案（复制区段并重算风险）</button>
            }
          }
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.panel-head{display:flex;justify-content:space-between}.muted{color:#7a8798}
    .lock-banner{margin-bottom:12px;padding:10px 14px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:13px}
    .lock-banner.locked{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}
    .segment{display:flex;justify-content:space-between;gap:10px;padding:11px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;cursor:pointer}
    .segment.active{border-color:#2563eb;background:#f5f8ff}.segment-main{border:0;background:transparent;padding:0;text-align:left;cursor:pointer;flex:1}
    .segment b,.segment small,.segment em{display:block}.segment small{color:#7a8798;margin:4px 0}.segment em{font-size:12px;color:#475569;font-style:normal}.status-line{font-size:11px}
    .segment-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:96px}.level-select{width:80px}.level-select .mat-mdc-form-field-infix{min-height:0;padding:6px 0}
    .detour-btn{font-size:12px}
  `],
})
export class RiskMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly current$ = this.store.select(selectSelectedVersion)
  readonly routeVersions$ = this.store.select(selectRouteVersions)
  readonly latestOptions$ = this.store.select((state) => {
    const map = new Map<string, RouteVersion>()
    for (const version of state.routes.versions) {
      const existing = map.get(version.routeId)
      if (!existing || version.versionNo > existing.versionNo) map.set(version.routeId, version)
    }
    return [...map.values()]
  })
  private map?: MapLibreMap
  private subscription?: Subscription
  layers = { tunnel: true, bridge: true, water: true, population: true }

  current: RouteVersion | undefined

  constructor() {
    this.subscription = this.current$.subscribe((version) => {
      this.current = version
      if (this.map) this.drawRoute()
    })
  }

  get routeLength() { return this.current ? length(lineString(this.current.segments.flatMap((segment) => segment.coordinates)), { units: 'kilometers' }).toFixed(1) : '0.0' }
  get estimatedTime() { return `${Math.round(Number(this.routeLength) / 55 * 60 + this.restrictedCount * 8)} 分钟` }
  get restrictedCount() { return this.current?.segments.filter((segment) => segment.status === '需绕行').length ?? 0 }

  highCount(version: RouteVersion) { return version.segments.filter((segment) => segment.level === '高').length }
  pendingCount(version: RouteVersion) { return version.comments.filter((comment) => comment.status === '待确认' || comment.status === '待重新确认').length }

  ngAfterViewInit() {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
      center: [112.2, 34.5], zoom: 5,
    })
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right')
    this.map.on('load', () => { this.addRiskLayers(); this.drawRoute() })
  }
  ngOnDestroy() { this.subscription?.unsubscribe(); this.map?.remove() }

  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })) }
  selectVersion(versionId: string) { this.store.dispatch(RouteActions.selectVersion({ versionId })) }
  selectSegment(segment: RiskSegment) { this.store.dispatch(RouteActions.selectSegment({ id: segment.id })); this.map?.flyTo({ center: segment.coordinates[0], zoom: 8 }) }
  setLevel(segment: RiskSegment, level: RiskLevel) {
    if (!this.current || this.current.locked) return
    this.store.dispatch(RouteActions.updateSegmentLevel({ versionId: this.current.id, segmentId: segment.id, level }))
  }
  resolveDetour(segment: RiskSegment) {
    if (!this.current || this.current.locked) return
    this.store.dispatch(RouteActions.resolveDetour({ versionId: this.current.id, segmentId: segment.id }))
  }
  requireAlternative() { this.store.dispatch(RouteActions.createAlternative()) }
  fitRoute() { if (!this.map || !this.current) return; const bounds = new LngLatBounds(); this.current.segments.flatMap((segment) => segment.coordinates).forEach((point) => bounds.extend(point)); this.map.fitBounds(bounds, { padding: 50 }) }
  refreshLayers() { for (const [id, visible] of Object.entries(this.layers)) { if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') } }

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
    if (!this.map?.isStyleLoaded() || !this.current) {
      if (this.map?.getLayer('route-line')) { this.map.removeLayer('route-line'); this.map.removeSource('route') }
      return
    }
    if (this.map.getLayer('route-line')) { this.map.removeLayer('route-line'); this.map.removeSource('route') }
    const locked = this.current.locked
    this.map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: this.current.segments.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': locked ? '#64748b' : '#2563eb', 'line-width': 4, 'line-opacity': .9 } })
  }
}
