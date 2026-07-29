/* =========================================================================
 * RC-Floor-FEA — ui-tools.js
 * Interactive drawing / selection tools operating on the canvas.
 * ========================================================================= */
"use strict";

const TOOLS = (() => {
  const SNAP_STEP = 0.05;        // fine snap (m) — grid snap uses 0.25
  let cv;

  function init(canvas) {
    cv = canvas;
    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("click", onClick);
    cv.addEventListener("dblclick", onDbl);
    window.addEventListener("keydown", onKey);
  }

  function snap(p) {
    if (!APP.snap) return { x: round(p.x, SNAP_STEP), y: round(p.y, SNAP_STEP) };
    const g = 0.25;
    let best = { x: round(p.x, g), y: round(p.y, g) };
    // object snap: endpoints, columns, slab corners within 10 px
    const tolW = 10 / CANVAS.view.scale;
    const cands = [];
    APP.proj.columns.forEach(c => cands.push({ x: c.x, y: c.y }));
    APP.proj.beams.forEach(b => cands.push({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }));
    APP.proj.slabs.forEach(s => s.poly.forEach(pt => cands.push(pt)));
    for (const c of cands)
      if (CORE.G.dist(p, c) < tolW) return { x: c.x, y: c.y };
    return best;
  }
  const round = (v, s) => Math.round(v / s) * s;

  function onMove(e) {
    const w = CANVAS.s2w(e.offsetX, e.offsetY);
    const s = snap(w);
    document.getElementById("coords").textContent =
      `x: ${s.x.toFixed(2)} , y: ${s.y.toFixed(2)} m`;
    if (APP.drawing.points.length) {
      APP.drawing.cursor = s;
      CANVAS.draw();
    }
  }

  function onClick(e) {
    if (CANVAS.isPanning() || e.button !== 0) return;
    const w = snap(CANVAS.s2w(e.offsetX, e.offsetY));
    const t = APP.tool;

    if (t === "select") return doSelect(CANVAS.s2w(e.offsetX, e.offsetY));
    if (t === "column") {
      const c = MODEL.makeColumn(w.x, w.y, { ...APP.defaults.column });
      APP.proj.columns.push(c);
      APP.select("column", c.id);
      APP.invalidate(); CANVAS.draw();
      return;
    }
    if (t === "pload") {
      const pl = MODEL.makePointLoad(w.x, w.y, { ...APP.defaults.pload });
      APP.proj.pointLoads.push(pl);
      APP.select("pload", pl.id);
      APP.invalidate(); CANVAS.draw();
      return;
    }
    if (t === "beam") {
      APP.drawing.points.push(w);
      if (APP.drawing.points.length === 2) {
        const [a, b] = APP.drawing.points;
        if (CORE.G.dist(a, b) > 1e-3) {
          const bm = MODEL.makeBeam(a, b, { ...APP.defaults.beam });
          APP.proj.beams.push(bm);
          APP.select("beam", bm.id);
          APP.invalidate();
        }
        APP.drawing.points = [];
      }
      CANVAS.draw();
      return;
    }
    if (t === "slabRect" || t === "opening") {
      APP.drawing.points.push(w);
      if (APP.drawing.points.length === 2) {
        const [a, b] = APP.drawing.points;
        if (Math.abs(a.x - b.x) > 1e-3 && Math.abs(a.y - b.y) > 1e-3) {
          const poly = [
            { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
            { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
            { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
            { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }
          ];
          if (t === "slabRect") {
            const s = MODEL.makeSlab(poly, { ...APP.defaults.slab });
            APP.proj.slabs.push(s);
            APP.select("slab", s.id);
          } else {
            const o = MODEL.makeOpening(poly);
            APP.proj.openings.push(o);
            APP.select("opening", o.id);
          }
          APP.invalidate();
        }
        APP.drawing.points = [];
      }
      CANVAS.draw();
      return;
    }
    if (t === "slabPoly") {
      APP.drawing.points.push(w);
      CANVAS.draw();
      return;
    }
    if (t === "calib") {
      APP.drawing.points.push(w);
      if (APP.drawing.points.length === 2) UNDERLAY.finishCalibration();
      CANVAS.draw();
      return;
    }
  }

  function onDbl() {
    if (APP.tool === "slabPoly" && APP.drawing.points.length >= 3) {
      const s = MODEL.makeSlab(APP.drawing.points, { ...APP.defaults.slab });
      APP.proj.slabs.push(s);
      APP.drawing.points = [];
      APP.select("slab", s.id);
      APP.invalidate(); CANVAS.draw();
    }
  }

  function onKey(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "Escape") { APP.drawing.points = []; APP.setTool("select"); CANVAS.draw(); }
    if (e.key === "Delete" || e.key === "Backspace") deleteSelection();
    if (e.key === "f" || e.key === "F") CANVAS.zoomFit();
  }

  function doSelect(w) {
    const p = APP.proj;
    const tolW = 8 / CANVAS.view.scale;
    // priority: columns > point loads > beams > openings > slabs
    for (const c of p.columns)
      if (CORE.G.dist(w, c) < Math.max(tolW, Math.max(c.bx, c.by) / 2))
        return APP.select("column", c.id);
    for (const pl of p.pointLoads)
      if (CORE.G.dist(w, pl) < tolW) return APP.select("pload", pl.id);
    for (const b of p.beams)
      if (CORE.G.distToSegment(w, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }) <
          Math.max(tolW, b.b / 2)) return APP.select("beam", b.id);
    for (const o of p.openings)
      if (CORE.G.inPolygon(w, o.poly)) return APP.select("opening", o.id);
    for (const s of p.slabs)
      if (CORE.G.inPolygon(w, s.poly)) return APP.select("slab", s.id);
    APP.select(null);
  }

  function deleteSelection() {
    const sel = APP.selection;
    if (!sel) return;
    const p = APP.proj;
    const del = (arr) => {
      const i = arr.findIndex(o => o.id === sel.id);
      if (i >= 0) arr.splice(i, 1);
    };
    if (sel.kind === "column") del(p.columns);
    else if (sel.kind === "beam") del(p.beams);
    else if (sel.kind === "slab") del(p.slabs);
    else if (sel.kind === "opening") del(p.openings);
    else if (sel.kind === "pload") del(p.pointLoads);
    APP.select(null);
    APP.invalidate();
    CANVAS.draw();
  }

  return { init, deleteSelection, snap };
})();
