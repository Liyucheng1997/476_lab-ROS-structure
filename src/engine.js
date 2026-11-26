// 3D 舞台：把「场景数据」（节点 / 分组 / 连线 / 步骤）渲染成可交互的 Three.js 图。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const V3 = THREE.Vector3;
const PX = 170; // 标签贴图：每个世界单位对应的像素
const FOV = 32;
const SANS = '-apple-system, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const MONO = 'Consolas, "SF Mono", Menlo, "Microsoft YaHei", monospace';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const PALETTES = {
  light: {
    bg: '#f5f5f7', node: '#ffffff', muted: '#e6e6eb', text: '#1d1d1f', text2: '#6e6e73',
    primary: '#0071e3', soft: '#dcebfc', softText: '#0071e3', line: '#b4b4bc',
    group: '#eaeaef', dots: '#d6d6dc', pill: 'rgba(245,245,247,0.94)',
  },
  dark: {
    bg: '#000000', node: '#232326', muted: '#2f2f33', text: '#f5f5f7', text2: '#a1a1a6',
    primary: '#0a84ff', soft: '#12335c', softText: '#6cb6ff', line: '#5c5c62',
    group: '#0e0e10', dots: '#2a2a2e', pill: 'rgba(0,0,0,0.9)',
  },
};

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx, text, weight, family, size, maxW, minSize) {
  let s = size;
  for (;;) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (s <= minSize || ctx.measureText(text).width <= maxW) return s;
    s -= 1;
  }
}

function makeTexture(canvas, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export class Stage {
  constructor(container) {
    this.el = container;
    this.pal = PALETTES.light;
    this.px = 0; this.py = 0; this.top = 0;
    this.nodes = []; this.edges = []; this.byId = new Map();
    this.step = null; this.selected = null; this.hovered = null;
    this.onSelect = () => {};
    this.tween = null;
    this.clock = new THREE.Clock();
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
    this.camera.position.set(0, 0, 30);

    this.scene.add(new THREE.AmbientLight(0xffffff, 2.45));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(3, 6, 10);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, minDistance: 5, maxDistance: 90,
      minAzimuthAngle: -1.15, maxAzimuthAngle: 1.15, minPolarAngle: 0.65, maxPolarAngle: 2.2,
      zoomSpeed: 0.8, rotateSpeed: 0.6,
    });
    this.controls.addEventListener('start', () => { this.tween = null; });

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.dots = null;
    this._buildDots();

    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);
    this._bindPointer();

    new ResizeObserver(() => { this._resize(); if (this.spec) this._focusCamera(true); }).observe(container);
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  /* ---------- 对外接口 ---------- */

  setTheme(dark) {
    this.pal = dark ? PALETTES.dark : PALETTES.light;
    this._buildDots();
    if (this.spec) {
      const { step, selected } = this;
      this.load(this.spec, { keepCamera: true, instant: true });
      this.step = step; this.selected = selected;
      this._apply();
    }
  }

  /** 右侧面板、底部步骤条、顶部标题占掉的像素，用来把画面中心挪到空白区域 */
  setInsets(px, py, top) {
    if (px === this.px && py === this.py && top === this.top) return;
    this.px = px; this.py = py; this.top = top;
    this._resize();
    if (this.spec) this._focusCamera(false);
  }

  load(spec, { keepCamera = false, instant = false } = {}) {
    this._clear();
    this.spec = spec;
    this.step = null; this.selected = null; this.hovered = null;
    const P = this.pal;
    this.scene.background = new THREE.Color(P.bg);
    this.bounds = new THREE.Box3();

    for (const g of spec.groups || []) this._buildGroup(g);
    (spec.nodes || []).forEach((n, i) => this._buildNode(n, i, instant));
    for (const e of spec.edges || []) this._buildEdge(e);
    this.born = instant ? -10 : this.time;
    this._apply();
    if (!keepCamera) this._focusCamera(true);
  }

  setStep(step) {
    this.step = step || null;
    this._apply();
    this._focusCamera(false);
  }

  select(id) {
    this.selected = id || null;
    this._apply();
  }

  /* ---------- 构建 ---------- */

  _buildDots() {
    if (this.dots) { this.scene.remove(this.dots); this.dots.geometry.dispose(); this.dots.material.dispose(); }
    const pts = [];
    for (let x = -40; x <= 40; x += 1.6) for (let y = -26; y <= 26; y += 1.6) pts.push(x, y, -4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.dots = new THREE.Points(geo, new THREE.PointsMaterial({ color: this.pal.dots, size: 2.2, sizeAttenuation: false }));
    this.scene.add(this.dots);
  }

  _buildGroup(g) {
    const P = this.pal;
    const z = g.z ?? -0.45;
    const r = 0.32, w = g.w, h = g.h;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), new THREE.MeshBasicMaterial({ color: P.group }));
    plate.position.set(g.x, g.y, z);
    this.root.add(plate);

    if (g.label) {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const fs = 46;
      ctx.font = `600 ${fs}px ${SANS}`;
      c.width = Math.ceil(ctx.measureText(g.label).width) + 8; c.height = fs + 22;
      ctx.font = `600 ${fs}px ${SANS}`;
      ctx.fillStyle = P.text2; ctx.textBaseline = 'middle';
      ctx.fillText(g.label, 4, c.height / 2);
      const hh = 0.3, ww = hh * c.width / c.height;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh),
        new THREE.MeshBasicMaterial({ map: makeTexture(c, this.renderer), transparent: true, depthWrite: false }));
      m.position.set(g.x - w / 2 + 0.3 + ww / 2, g.y + h / 2 - 0.34, z + 0.02);
      this.root.add(m);
    }
    this.bounds.expandByPoint(new V3(g.x - w / 2, g.y - h / 2, z)).expandByPoint(new V3(g.x + w / 2, g.y + h / 2, z));
  }

  _buildNode(spec, index, instant) {
    const [w, h, t] = spec.size;
    const g = new THREE.Group();
    g.position.set(...spec.pos);
    const box = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, t, 4, Math.min(0.14, h / 2.2, t / 2.2)),
      new THREE.MeshLambertMaterial({ color: this.pal.node, transparent: true }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * PX); canvas.height = Math.round(h * PX);
    const tex = makeTexture(canvas, this.renderer);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.position.z = t / 2 + 0.006;
    g.add(box, label);
    this.root.add(g);
    const node = { spec, g, box, label, canvas, tex, key: '', index, scale: instant ? 1 : 0.001 };
    box.userData.node = node;
    g.scale.setScalar(node.scale);
    this.nodes.push(node);
    this.byId.set(spec.id, node);
    const half = new V3(w / 2, h / 2, t / 2), c = g.position;
    this.bounds.expandByPoint(c.clone().sub(half)).expandByPoint(c.clone().add(half));
  }

  _drawLabel(node, color, subColor) {
    const key = color + subColor;
    if (node.key === key) return;
    node.key = key;
    const { canvas, spec } = node;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const file = spec.kind === 'file';
    const family = file ? MONO : SANS;
    const left = spec.align === 'left';
    const pad = 0.16 * PX;
    const x = left ? pad : W / 2;
    ctx.textAlign = left ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    const big = Math.min(H * (spec.sub ? 0.32 : 0.4), 0.3 * PX);
    fitFont(ctx, spec.label, file ? 500 : 600, family, Math.round(big), W - pad * 2, 14);
    ctx.fillStyle = color;
    ctx.fillText(spec.label, x, spec.sub ? H * 0.36 : H * 0.52);
    if (spec.sub) {
      fitFont(ctx, spec.sub, 400, family, Math.round(Math.min(H * 0.21, 0.17 * PX)), W - pad * 2, 12);
      ctx.fillStyle = subColor;
      ctx.fillText(spec.sub, x, H * 0.7);
    }
    node.tex.needsUpdate = true;
  }

  _buildEdge(spec) {
    const A = this.byId.get(spec.from), B = this.byId.get(spec.to);
    if (!A || !B) { console.warn('连线引用了不存在的节点', spec); return; }
    const a = A.g.position.clone(), b = B.g.position.clone();
    const ctrl = a.clone().add(b).multiplyScalar(0.5);
    if (spec.bend) ctrl.add(new V3(...spec.bend));
    const exit = (center, size, toward) => {
      const d = toward.clone().sub(center);
      if (d.lengthSq() < 1e-6) return center.clone();
      let tt = Infinity;
      ['x', 'y', 'z'].forEach((k, i) => { const v = Math.abs(d[k]); if (v > 1e-6) tt = Math.min(tt, (size[i] / 2) / v); });
      const len = d.length();
      return center.clone().add(d.multiplyScalar(Math.min(tt, 1) + 0.07 / len));
    };
    const start = exit(a, A.spec.size, ctrl), end = exit(b, B.spec.size, ctrl);
    const curve = spec.bend ? new THREE.QuadraticBezierCurve3(start, ctrl, end) : new THREE.LineCurve3(start, end);
    const pts = curve.getPoints(spec.bend ? 30 : 1);
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: this.pal.line, linewidth: 1.6, transparent: true, depthWrite: false,
      dashed: !!spec.dashed, dashSize: 0.16, gapSize: 0.12,
    });
    mat.resolution.set(this.w || 1, this.h || 1);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    this.root.add(line);

    const cones = [];
    const addCone = (pos, dir) => {
      const cg = new THREE.ConeGeometry(0.075, 0.2, 14);
      cg.translate(0, -0.1, 0);
      const cone = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: this.pal.line, transparent: true }));
      cone.position.copy(pos);
      cone.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
      this.root.add(cone); cones.push(cone);
    };
    if (spec.arrow !== false) addCone(end, curve.getTangent(1));
    if (spec.bidir) addCone(start, curve.getTangent(0).negate());

    let sprite = null, labelCanvas = null;
    if (spec.label) {
      labelCanvas = document.createElement('canvas');
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeTexture(labelCanvas, this.renderer), transparent: true, depthWrite: false }));
      sprite.position.copy(curve.getPoint(spec.at ?? 0.5)).add(new V3(0, 0, 0.12));
      sprite.renderOrder = 5;
      this.root.add(sprite);
    }

    const dots = [];
    if (spec.flow !== false) {
      const n = Math.max(2, Math.min(5, Math.round(curve.getLength() / 2)));
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(Stage.dotGeo, new THREE.MeshBasicMaterial({ color: this.pal.primary }));
        m.visible = false; m.renderOrder = 4;
        this.root.add(m);
        dots.push({ m, off: i / n, rev: spec.flow === 'back' || (spec.flow === 'both' && i % 2 === 1) });
      }
    }
    this.edges.push({ spec, curve, line, mat, cones, sprite, labelCanvas, dots, len: curve.getLength(), key: '', flowing: false });
  }

  _drawEdgeLabel(edge, color) {
    if (!edge.sprite || edge.key === color) return;
    edge.key = color;
    const c = edge.labelCanvas, ctx = c.getContext('2d');
    const fs = 40, font = `500 ${fs}px ${SANS}`;
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(edge.spec.label).width) + 44; c.height = 66;
    ctx.font = font;
    ctx.fillStyle = this.pal.pill;
    roundRectPath(ctx, 0, 0, c.width, c.height, 33); ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(edge.spec.label, c.width / 2, c.height / 2 + 2);
    edge.sprite.material.map.dispose();
    edge.sprite.material.map = makeTexture(c, this.renderer);
    const hh = 0.34;
    edge.sprite.scale.set(hh * c.width / c.height, hh, 1);
  }

  /* ---------- 状态 → 外观 ---------- */

  _focusSet() {
    const f = this.step && this.step.focus;
    return f && f.length ? new Set(f) : null;
  }

  _apply() {
    const P = this.pal, focus = this._focusSet(), stepping = !!this.step;
    for (const n of this.nodes) {
      const id = n.spec.id, sel = id === this.selected, foc = focus ? focus.has(id) : false;
      let fill = n.spec.kind === 'muted' ? P.muted : P.node, text = P.text, sub = P.text2;
      if (foc || (!focus && n.spec.kind === 'accent')) { fill = P.primary; text = '#ffffff'; sub = 'rgba(255,255,255,0.82)'; }
      else if (sel) { fill = P.soft; text = P.softText; sub = P.softText; }
      const dim = focus && !foc && !sel;
      n.box.material.color.set(fill);
      n.box.material.opacity = dim ? 0.3 : 1;
      n.box.material.depthWrite = !dim;
      n.label.material.opacity = dim ? 0.3 : 1;
      this._drawLabel(n, text, sub);
    }
    const stepEdges = stepping ? new Set(this.step.edges || []) : null;
    for (const e of this.edges) {
      let active = false;
      if (focus) active = this.step.edges ? stepEdges.has(e.spec.id) : focus.has(e.spec.from) && focus.has(e.spec.to);
      const dim = focus && !active;
      const color = active ? P.primary : P.line;
      e.mat.color.set(color); e.mat.opacity = dim ? 0.16 : 1;
      e.mat.linewidth = active ? 2.4 : 1.6;
      for (const c of e.cones) { c.material.color.set(color); c.material.opacity = dim ? 0.16 : 1; }
      if (e.sprite) { this._drawEdgeLabel(e, active ? P.primary : P.text2); e.sprite.material.opacity = dim ? 0.2 : 1; }
      e.flowing = e.spec.flow !== false && (focus ? active : !!e.spec.flow);
      for (const d of e.dots) d.m.visible = e.flowing && !REDUCED;
    }
  }

  /* ---------- 镜头 ---------- */

  _focusCamera(instant) {
    if (!this.bounds || this.bounds.isEmpty()) return;
    const full = this.bounds;
    let box = full;
    const focus = this._focusSet();
    if (focus) {
      const fb = new THREE.Box3();
      for (const id of focus) {
        const n = this.byId.get(id); if (!n) continue;
        const half = new V3(n.spec.size[0] / 2, n.spec.size[1] / 2, n.spec.size[2] / 2);
        fb.expandByPoint(n.g.position.clone().sub(half)).expandByPoint(n.g.position.clone().add(half));
      }
      if (!fb.isEmpty()) {
        // 不要推得太近：至少保留整幅图 70% 的范围，并向整体中心靠一点
        const fs = full.getSize(new V3()), s = fb.getSize(new V3()), c = fb.getCenter(new V3());
        c.lerp(full.getCenter(new V3()), 0.35);
        s.set(Math.max(s.x, fs.x * 0.7), Math.max(s.y, fs.y * 0.7), s.z);
        box = new THREE.Box3().setFromCenterAndSize(c, s);
      }
    }
    const c = box.getCenter(new V3()), s = box.getSize(new V3());
    const w = this.w, h = this.h;
    const fx = Math.max(0.3, (w - this.px) / w), fy = Math.max(0.3, (h - this.py - this.top) / h);
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = Math.max((s.y / 2 + 0.7) / (tanV * fy), (s.x / 2 + 0.9) / (tanV * (w / h) * fx)) * 1.03 + s.z / 2;
    const az = 0.26, el = 0.13;
    const dir = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const pos = c.clone().add(dir.multiplyScalar(dist));
    if (instant || REDUCED) {
      this.camera.position.copy(pos); this.controls.target.copy(c); this.tween = null;
    } else {
      this.tween = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: c };
    }
  }

  _resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, this.px / 2, (this.py - this.top) / 2, w, h);
    this.camera.updateProjectionMatrix();
    for (const e of this.edges) e.mat.resolution.set(w, h);
  }

  /* ---------- 交互 ---------- */

  _bindPointer() {
    const dom = this.renderer.domElement;
    let down = null;
    const setPointer = (ev) => {
      const r = dom.getBoundingClientRect();
      this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    };
    dom.addEventListener('pointermove', (ev) => { setPointer(ev); this.pointerDirty = true; });
    dom.addEventListener('pointerleave', () => { this.pointer.set(-9, -9); this.pointerDirty = true; });
    dom.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
    dom.addEventListener('pointerup', (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down[0], ev.clientY - down[1]);
      down = null;
      if (moved > 5) return;
      setPointer(ev);
      const n = this._pick();
      this.onSelect(n ? n.spec.id : null);
    });
  }

  _pick() {
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.nodes.map((n) => n.box), false)[0];
    return hit ? hit.object.userData.node : null;
  }

  /* ---------- 每帧 ---------- */

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.25);
    this.time += dt;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const k = easeOut(tw.t);
      this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();

    if (this.pointerDirty) {
      this.pointerDirty = false;
      const n = this._pick();
      this.hovered = n ? n.spec.id : null;
      this.renderer.domElement.style.cursor = n ? 'pointer' : 'grab';
    }

    const age = this.time - (this.born ?? 0);
    for (const n of this.nodes) {
      const id = n.spec.id;
      const intro = REDUCED ? 1 : Math.min(1, Math.max(0, (age - n.index * 0.022) / 0.5));
      const target = id === this.hovered || id === this.selected ? 1.06 : 1;
      if (intro < 1) n.scale = Math.max(0.001, easeBack(intro));
      else n.scale += (target - n.scale) * Math.min(1, dt * 12);
      n.g.scale.setScalar(n.scale);
    }

    const edgesOn = REDUCED || age > 0.35;
    for (const e of this.edges) {
      e.line.visible = edgesOn;
      for (const c of e.cones) c.visible = edgesOn;
      if (e.sprite) e.sprite.visible = edgesOn;
      if (!e.flowing || !edgesOn) { if (!edgesOn) for (const d of e.dots) d.m.visible = false; continue; }
      for (const d of e.dots) {
        d.m.visible = !REDUCED;
        let t = (this.time * 1.9 / e.len + d.off) % 1;
        if (d.rev) t = 1 - t;
        d.m.position.copy(e.curve.getPoint(t));
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  _clear() {
    this.root.traverse((o) => {
      if (o.geometry && o.geometry !== Stage.dotGeo) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.root.clear();
    this.nodes = []; this.edges = []; this.byId.clear();
  }
}

Stage.dotGeo = new THREE.SphereGeometry(0.065, 12, 10);
