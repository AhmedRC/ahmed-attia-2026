/* =========================================================================
 * RC-Floor-FEA — mesher.js
 * Grid-superposition mesh generator.
 *
 * Strategy (see TECHNICAL_PLAN.md §4):
 *   1. Collect governing x/y coordinates from slabs, openings, beams, columns.
 *   2. Subdivide intervals to satisfy max element size.
 *   3. Create nodes at grid points inside slabs / on beams / at columns.
 *   4. Quad plate elements for cells inside a slab & outside openings.
 *   5. Beam line elements split at every node on the beam axis.
 * Guarantees shared nodes between slabs, beams and supports.
 * ========================================================================= */
"use strict";

const MESHER = (() => {
  const { G } = CORE;
  const CTOL = 1e-4;              // coordinate identity tolerance (m)

  function uniqSorted(vals) {
    vals.sort((a, b) => a - b);
    const out = [];
    for (const v of vals)
      if (!out.length || v - out[out.length - 1] > CTOL) out.push(v);
    return out;
  }

  function refine(coords, maxSize) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      out.push(a);
      const n = Math.ceil((b - a) / maxSize - 1e-9);
      for (let k = 1; k < n; k++) out.push(a + (b - a) * k / n);
    }
    if (coords.length) out.push(coords[coords.length - 1]);
    return out;
  }

  function generate(proj) {
    const maxSize = Math.max(0.05, proj.meshSettings.maxSize || 0.5);
    const warnings = [];

    // ---- 1. governing coordinates -------------------------------------
    let xs = [], ys = [];
    const addPt = (p) => { xs.push(p.x); ys.push(p.y); };
    proj.slabs.forEach(s => s.poly.forEach(addPt));
    proj.openings.forEach(o => o.poly.forEach(addPt));
    proj.columns.forEach(c => addPt(c));
    proj.pointLoads.forEach(c => addPt(c));
    proj.beams.forEach(b => {
      addPt({ x: b.x1, y: b.y1 }); addPt({ x: b.x2, y: b.y2 });
      const dx = Math.abs(b.x2 - b.x1), dy = Math.abs(b.y2 - b.y1);
      if (dx > CTOL && dy > CTOL)
        warnings.push(`Beam #${b.id} is not axis-aligned: it connects to the slab mesh only at endpoints and grid crossings.`);
    });
    if (!xs.length) throw new Error("Model is empty — draw slabs, beams or columns first.");

    xs = refine(uniqSorted(xs), maxSize);
    ys = refine(uniqSorted(ys), maxSize);

    // ---- 2. candidate grid nodes --------------------------------------
    // A grid point becomes a node if it is inside/on a slab (and not strictly
    // inside an opening), on a beam axis, or at a column / point load.
    const nodeIndex = new Map();      // "i,j" -> node id
    const nodes = [];                 // {id, x, y, i, j}
    const inSlab = (p) => proj.slabs.some(s => G.inPolygon(p, s.poly, CTOL));
    const inOpening = (p) => proj.openings.some(o =>
      G.inPolygon(p, o.poly, -CTOL) && !onPolyBoundary(p, o.poly));
    const onPolyBoundary = (p, poly) => {
      for (let i = 0; i < poly.length; i++)
        if (G.onSegment(p, poly[i], poly[(i + 1) % poly.length], CTOL)) return true;
      return false;
    };
    const onBeam = (p) => proj.beams.some(b =>
      G.onSegment(p, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }, CTOL));
    const atColumn = (p) => proj.columns.some(c => G.dist(p, c) < CTOL) ||
                            proj.pointLoads.some(c => G.dist(p, c) < CTOL);

    // note: numbering along the SHORTER direction first minimizes bandwidth
    const xMajor = xs.length >= ys.length;   // iterate long direction outer
    const outer = xMajor ? xs : ys, inner = xMajor ? ys : xs;

    for (let io = 0; io < outer.length; io++) {
      for (let ii = 0; ii < inner.length; ii++) {
        const x = xMajor ? outer[io] : inner[ii];
        const y = xMajor ? inner[ii] : outer[io];
        const p = { x, y };
        const opening = proj.openings.some(o => G.inPolygon(p, o.poly, -1e-3) && !onPolyBoundary(p, o.poly));
        const keep = (!opening && inSlab(p)) || onBeam(p) || atColumn(p);
        if (keep) {
          const i = xs.indexOf(x), j = ys.indexOf(y);
          const id = nodes.length;
          nodes.push({ id, x, y, i, j });
          nodeIndex.set(i + "," + j, id);
        }
      }
    }
    // indexOf on floats is safe here because xs/ys entries are the exact values used.

    // fast lookup helpers
    const xIdx = new Map(xs.map((v, i) => [v, i]));
    const yIdx = new Map(ys.map((v, i) => [v, i]));
    const nodeAt = (i, j) => nodeIndex.get(i + "," + j);

    // ---- 3. plate elements ---------------------------------------------
    const plates = [];   // {id, nodes:[n1..n4 CCW], slabId}
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
        const c = { x: cx, y: cy };
        if (proj.openings.some(o => G.inPolygon(c, o.poly, CTOL))) continue;
        const slab = proj.slabs.find(s => G.inPolygon(c, s.poly, CTOL));
        if (!slab) continue;
        const n1 = nodeAt(i, j), n2 = nodeAt(i + 1, j),
              n3 = nodeAt(i + 1, j + 1), n4 = nodeAt(i, j + 1);
        if (n1 == null || n2 == null || n3 == null || n4 == null) continue;
        plates.push({ id: plates.length, nodes: [n1, n2, n3, n4], slabId: slab.id });
      }
    }

    // ---- 4. beam elements ----------------------------------------------
    // split each beam at every node lying on its axis
    const beamEls = [];  // {id, n1, n2, beamId, s1, s2 (station m from start)}
    for (const b of proj.beams) {
      const A = { x: b.x1, y: b.y1 }, B = { x: b.x2, y: b.y2 };
      const L = G.dist(A, B);
      if (L < CTOL) { warnings.push(`Beam #${b.id} has zero length — skipped.`); continue; }
      const onIt = [];
      for (const n of nodes)
        if (G.onSegment(n, A, B, CTOL)) {
          const t = ((n.x - A.x) * (B.x - A.x) + (n.y - A.y) * (B.y - A.y)) / (L * L);
          onIt.push({ n: n.id, t: Math.max(0, Math.min(1, t)) });
        }
      onIt.sort((p, q) => p.t - q.t);
      if (onIt.length < 2) { warnings.push(`Beam #${b.id}: fewer than 2 mesh nodes found on its axis.`); continue; }
      const last = onIt.length - 2;   // index of the final sub-element
      for (let k = 0; k < onIt.length - 1; k++) {
        if (onIt[k + 1].t - onIt[k].t < CTOL / L) continue;
        beamEls.push({
          id: beamEls.length, n1: onIt[k].n, n2: onIt[k + 1].n,
          beamId: b.id, s1: onIt[k].t * L, s2: onIt[k + 1].t * L,
          // end releases apply only at the extreme ends of the parent beam
          relN1: (k === 0) && !!b.releaseStart,
          relN2: (k === last) && !!b.releaseEnd
        });
      }
    }

    // ---- 5. supports -----------------------------------------------------
    const supports = []; // {nodeId, columnId, restraint:{w,rx,ry}, springs:{kw,krx,kry}}
    for (const c of proj.columns) {
      const i = xIdx.get([...xIdx.keys()].find(v => Math.abs(v - c.x) < CTOL));
      const j = yIdx.get([...yIdx.keys()].find(v => Math.abs(v - c.y) < CTOL));
      const nid = (i != null && j != null) ? nodeAt(i, j) : null;
      // fallback: nearest node
      let nodeId = nid;
      if (nodeId == null) {
        let best = 1e30;
        for (const n of nodes) { const d = G.dist(n, c); if (d < best) { best = d; nodeId = n.id; } }
        if (best > maxSize) warnings.push(`Column #${c.id} is ${best.toFixed(2)} m from the nearest mesh node.`);
      }
      const mat = c.matId ? MODEL.getMat(proj, c.matId) : MODEL.defaultConcrete(proj);
      let restraint = null, springs = null;
      if (c.supportType === "roller" || c.supportType === "pinned")
        restraint = { w: true, rx: false, ry: false };     // vertical only
      else if (c.supportType === "hinged")
        restraint = { w: true, rx: true, ry: false };       // vertical + torsion-axis (θx)
      else if (c.supportType === "fixed") restraint = { w: true, rx: true, ry: true };
      else { // "column" spring from column below (far end fixed): kw=EA/L, kr=4EI/L
        const A = c.shape === "circle" ? Math.PI * c.bx * c.bx / 4 : c.bx * c.by;
        const Ix = c.shape === "circle" ? Math.PI * c.bx ** 4 / 64 : c.bx * c.by ** 3 / 12;
        const Iy = c.shape === "circle" ? Ix : c.by * c.bx ** 3 / 12;
        springs = {
          kw: mat.E * A / c.Lc,
          krx: 4 * mat.E * Ix / c.Lc,   // rotation about X bends about X: uses Ix (b·h³ with h along Y)
          kry: 4 * mat.E * Iy / c.Lc
        };
      }
      supports.push({ nodeId, columnId: c.id, restraint, springs });
    }

    if (!plates.length && !beamEls.length)
      throw new Error("Mesh generated no elements — check geometry.");
    if (!supports.length)
      warnings.push("No supports/columns defined — the model will be singular.");

    return {
      nodes, plates, beams: beamEls, supports, xs, ys, warnings,
      maxSize, ndof: nodes.length * 3,
      stats: {
        nodes: nodes.length, plates: plates.length, beamEls: beamEls.length,
        supports: supports.length, dofs: nodes.length * 3
      }
    };
  }

  return { generate };
})();
