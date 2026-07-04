/* =========================================================================
 * RC-Floor-FEA — ui-canvas.js
 * Viewport (pan / zoom / snap), coordinate transforms, model rendering.
 * World coordinates: meters, y-up. Screen: pixels, y-down.
 * ========================================================================= */
"use strict";

const CANVAS = (() => {
  let cv, ctx, W = 0, H = 0;
  const view = { scale: 60, ox: -1, oy: -1 };    // px per m; world coords of lower-left
  let panning = false, panStart = null;

  function init(canvas) {
    cv = canvas; ctx = cv.getContext("2d");
    const resize = () => {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      draw();
    };
    new ResizeObserver(resize).observe(cv);
    resize();

    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const m = s2w(e.offsetX, e.offsetY);
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      view.scale = Math.max(2, Math.min(2000, view.scale * f));
      // keep mouse point fixed
      view.ox = m.x - e.offsetX / view.scale;
      view.oy = m.y - (H - e.offsetY) / view.scale;
      draw();
    }, { passive: false });

    cv.addEventListener("mousedown", (e) => {
      if (e.button === 1 || e.button === 2 ||
          (e.button === 0 && e.getModifierState("Space"))) {
        panning = true; panStart = { x: e.offsetX, y: e.offsetY, ox: view.ox, oy: view.oy };
        e.preventDefault();
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      const r = cv.getBoundingClientRect();
      const dx = (e.clientX - r.left) - panStart.x, dy = (e.clientY - r.top) - panStart.y;
      view.ox = panStart.ox - dx / view.scale;
      view.oy = panStart.oy + dy / view.scale;
      draw();
    });
    window.addEventListener("mouseup", () => { panning = false; });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // transforms
  const w2s = (x, y) => ({ x: (x - view.ox) * view.scale, y: H - (y - view.oy) * view.scale });
  const s2w = (px, py) => ({ x: view.ox + px / view.scale, y: view.oy + (H - py) / view.scale });
  const isPanning = () => panning;

  function zoomFit() {
    const p = APP.proj;
    const pts = [];
    p.slabs.forEach(s => pts.push(...s.poly));
    p.beams.forEach(b => pts.push({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }));
    p.columns.forEach(c => pts.push(c));
    if (p.underlay && p.underlay.img)
      pts.push({ x: p.underlay.x, y: p.underlay.y },
               { x: p.underlay.x + p.underlay.wm, y: p.underlay.y + p.underlay.hm });
    if (!pts.length) { view.scale = 60; view.ox = -1; view.oy = -1; draw(); return; }
    const bb = CORE.G.bbox(pts);
    const mw = Math.max(bb.maxx - bb.minx, 1), mh = Math.max(bb.maxy - bb.miny, 1);
    view.scale = Math.min(W / (mw * 1.2), H / (mh * 1.2));
    view.ox = bb.minx - (W / view.scale - mw) / 2;
    view.oy = bb.miny - (H / view.scale - mh) / 2;
    draw();
  }

  // ------------------------------------------------------------------
  // rendering
  // ------------------------------------------------------------------
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawUnderlay();
    drawGrid();
    const rt = APP.resultType;
    if (rt !== "model" && APP.proj.mesh &&
        (rt === "mesh" || APP.proj.results)) {
      if (rt === "mesh") { drawModel(0.35); drawMesh(); }
      else RESULTS.draw(ctx, { w2s, view, W, H });
    } else {
      drawModel(1);
      if (APP.proj.mesh && rt === "model") { /* model only */ }
    }
    drawDrawingPreview();
  }

  function drawGrid() {
    const step = niceStep(60 / view.scale);   // aim ~60px
    const a = s2w(0, H), b = s2w(W, 0);
    ctx.save();
    ctx.lineWidth = 1;
    for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) {
      const p = w2s(x, 0);
      ctx.strokeStyle = Math.abs(x) < 1e-9 ? "#3d5a80" : "#23272e";
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
    }
    for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) {
      const p = w2s(0, y);
      ctx.strokeStyle = Math.abs(y) < 1e-9 ? "#3d5a80" : "#23272e";
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
    }
    ctx.restore();
  }
  const niceStep = (raw) => {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  };

  function drawUnderlay() {
    const u = APP.proj.underlay;
    if (!u || !u.visible) return;
    ctx.save();
    ctx.globalAlpha = u.opacity ?? 0.45;
    if (u.img) {
      const p = w2s(u.x, u.y + u.hm);
      ctx.drawImage(u.img, p.x, p.y, u.wm * view.scale, u.hm * view.scale);
    }
    if (u.vectors) {           // DXF line work
      ctx.strokeStyle = "#7f93b8"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const seg of u.vectors) {
        const a = w2s(u.x + seg.x1 * u.vScale, u.y + seg.y1 * u.vScale);
        const b = w2s(u.x + seg.x2 * u.vScale, u.y + seg.y2 * u.vScale);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawModel(alpha) {
    const p = APP.proj;
    ctx.save();
    ctx.globalAlpha = alpha;

    // slabs
    for (const s of p.slabs) {
      const sel = isSel("slab", s.id);
      ctx.beginPath();
      s.poly.forEach((pt, i) => {
        const q = w2s(pt.x, pt.y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = s.slabType === "ribbed" ? "rgba(120,160,90,.18)"
                    : s.slabType === "flat" ? "rgba(90,140,190,.18)" : "rgba(110,120,190,.16)";
      ctx.fill();
      ctx.strokeStyle = sel ? "#ffd75e" : "#5f7fae";
      ctx.lineWidth = sel ? 2.5 : 1.4;
      ctx.stroke();
      const c = CORE.G.polygonCentroid(s.poly), q = w2s(c.x, c.y);
      ctx.fillStyle = "#9fb4d8"; ctx.font = "11px Segoe UI";
      ctx.fillText(`${s.label || "S" + s.id} ${s.slabType} t=${(s.t * 1000) | 0}`, q.x - 30, q.y);
    }
    // openings
    for (const o of p.openings) {
      const sel = isSel("opening", o.id);
      ctx.beginPath();
      o.poly.forEach((pt, i) => {
        const q = w2s(pt.x, pt.y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(20,22,26,.85)"; ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = sel ? "#ffd75e" : "#8a6d3b"; ctx.lineWidth = sel ? 2.5 : 1.3;
      ctx.stroke(); ctx.setLineDash([]);
    }
    // beams
    for (const b of p.beams) {
      const sel = isSel("beam", b.id);
      const a = w2s(b.x1, b.y1), c = w2s(b.x2, b.y2);
      ctx.strokeStyle = sel ? "#ffd75e" : "#4da3ff";
      ctx.lineWidth = Math.max(3, b.b * view.scale);
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.globalAlpha = alpha;
      if (b.lineLoads.length) {
        ctx.fillStyle = "#ffb454"; ctx.font = "10px Segoe UI";
        ctx.fillText("w", (a.x + c.x) / 2 + 4, (a.y + c.y) / 2 - 4);
      }
      // moment-release markers (hollow circle = hinge, M=0)
      const dl = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const ux = (c.x - a.x) / dl, uy = (c.y - a.y) / dl, off = 11;
      const hinge = (px, py) => {
        ctx.beginPath(); ctx.arc(px, py, 4, 0, 7);
        ctx.fillStyle = "#12151a"; ctx.fill();
        ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 1.6; ctx.stroke();
      };
      if (b.releaseStart) hinge(a.x + ux * off, a.y + uy * off);
      if (b.releaseEnd) hinge(c.x - ux * off, c.y - uy * off);
    }
    // columns
    for (const c of p.columns) {
      const sel = isSel("column", c.id);
      const q = w2s(c.x, c.y);
      const bw = Math.max(6, c.bx * view.scale), bh = Math.max(6, c.by * view.scale);
      ctx.fillStyle = sel ? "#ffd75e" : "#e0e5ec";
      if (c.shape === "circle") {
        ctx.beginPath(); ctx.arc(q.x, q.y, bw / 2, 0, 7); ctx.fill();
      } else ctx.fillRect(q.x - bw / 2, q.y - bh / 2, bw, bh);
      ctx.strokeStyle = "#20242a"; ctx.lineWidth = 1;
      if (c.shape !== "circle") ctx.strokeRect(q.x - bw / 2, q.y - bh / 2, bw, bh);
      // support glyph
      ctx.fillStyle = "#9aa5b5"; ctx.font = "9px Segoe UI";
      const gMap = { fixed: "FIX", pinned: "PIN", roller: "ROL", hinged: "HIN", column: "COL" };
      const g = gMap[c.supportType] || "COL";
      ctx.fillText(g, q.x - 9, q.y + bh / 2 + 10);
    }
    // point loads
    for (const pl of p.pointLoads) {
      const q = w2s(pl.x, pl.y);
      const sel = isSel("pload", pl.id);
      ctx.strokeStyle = sel ? "#ffd75e" : "#ff6b6b"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 22); ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x - 4, q.y - 7); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + 4, q.y - 7);
      ctx.stroke();
      ctx.fillStyle = "#ff9b9b"; ctx.font = "10px Segoe UI";
      ctx.fillText(`${pl.P} kN (${pl.caseId})`, q.x + 6, q.y - 14);
    }
    ctx.restore();
  }

  function drawMesh() {
    const mesh = APP.proj.mesh;
    if (!mesh) return;
    ctx.save();
    ctx.strokeStyle = "rgba(120,200,255,.5)"; ctx.lineWidth = 0.7;
    for (const pl of mesh.plates) {
      ctx.beginPath();
      pl.nodes.forEach((n, i) => {
        const q = w2s(mesh.nodes[n].x, mesh.nodes[n].y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath(); ctx.stroke();
    }
    ctx.strokeStyle = "#37c978"; ctx.lineWidth = 2;
    for (const be of mesh.beams) {
      const a = w2s(mesh.nodes[be.n1].x, mesh.nodes[be.n1].y);
      const b = w2s(mesh.nodes[be.n2].x, mesh.nodes[be.n2].y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.fillStyle = "#ffd75e";
    for (const sup of mesh.supports) {
      const n = mesh.nodes[sup.nodeId];
      const q = w2s(n.x, n.y);
      ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
    }
    ctx.restore();
  }

  function drawDrawingPreview() {
    const d = APP.drawing;
    if (!d || !d.points.length) return;
    ctx.save();
    ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    d.points.forEach((pt, i) => {
      const q = w2s(pt.x, pt.y);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    if (d.cursor) { const q = w2s(d.cursor.x, d.cursor.y); ctx.lineTo(q.x, q.y); }
    ctx.stroke();
    ctx.restore();
  }

  const isSel = (kind, id) => APP.selection &&
    APP.selection.kind === kind && APP.selection.id === id;

  return { init, draw, w2s, s2w, zoomFit, view, isPanning, size: () => ({ W, H }) };
})();
