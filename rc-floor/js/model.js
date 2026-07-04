/* =========================================================================
 * RC-Floor-FEA — model.js
 * Project data model: materials, sections, columns (supports), beams,
 * slab regions, openings, loads, load cases & combinations.
 * All geometry in meters; loads kN, kN/m, kN/m²; internal stress unit kPa.
 * ========================================================================= */
"use strict";

const MODEL = (() => {

  let _nextId = 1;
  const uid = () => _nextId++;

  // ------------------------------------------------------------------
  // Factories
  // ------------------------------------------------------------------

  // Support / column at a point.
  // supportType:
  //   "roller" — vertical only (w=0; both rotations free)      ← default
  //   "hinged" — vertical + torsion-axis rotation (w=0, θx=0)   ← one reference support
  //   "pinned" — vertical only (w=0)         (legacy, == roller DOF-wise)
  //   "fixed"  — vertical + both rotations (w=0, θx=0, θy=0)
  //   "column" — elastic spring from the column below
  function makeColumn(x, y, opts = {}) {
    return {
      id: uid(), kind: "column",
      x, y,
      bx: opts.bx ?? 0.4,          // column dimension along X (m)
      by: opts.by ?? 0.4,          // along Y (m)
      shape: opts.shape ?? "rect", // rect | circle (bx = diameter)
      Lc: opts.Lc ?? 3.0,          // storey height below (m), for springs
      supportType: opts.supportType ?? "roller",
      matId: opts.matId ?? null,   // concrete material
      label: opts.label ?? ""
    };
  }

  // Beam between two points
  function makeBeam(p1, p2, opts = {}) {
    return {
      id: uid(), kind: "beam",
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      b: opts.b ?? 0.25,           // width (m)
      h: opts.h ?? 0.6,            // total depth (m)
      matId: opts.matId ?? null,
      rebarId: opts.rebarId ?? null,
      stiffMod: opts.stiffMod ?? 1.0,   // flexural stiffness modifier
      torsMod: opts.torsMod ?? 0.35,    // cracked torsion (ACI-style reduction)
      // moment/torsion end releases (moment hinge): frees bending + torsion at
      // that end so the recovered moment there is exactly zero.
      releaseStart: opts.releaseStart ?? false,   // at (x1,y1)
      releaseEnd: opts.releaseEnd ?? false,       // at (x2,y2)
      lineLoads: [],               // {caseId, w (kN/m, +down)}
      label: opts.label ?? ""
    };
  }

  // Slab region: polygon (array of {x,y}, CCW or CW)
  // slabType: "solid" | "flat" | "ribbed"
  function makeSlab(poly, opts = {}) {
    return {
      id: uid(), kind: "slab",
      poly: poly.map(p => ({ x: p.x, y: p.y })),
      t: opts.t ?? 0.2,            // thickness (m)
      slabType: opts.slabType ?? "solid",
      // ribbed slab parameters
      rib: opts.rib ?? { tf: 0.07, bw: 0.12, s: 0.52, twoWay: true, blockWeight: 1.0 },
      matId: opts.matId ?? null,
      rebarId: opts.rebarId ?? null,
      cover: opts.cover ?? 0.025,  // m, to bar centroid ≈ cover+bar/2 handled in design
      areaLoads: [],               // {caseId, q (kN/m², +down)}
      edgeCondition: opts.edgeCondition ?? "auto", // reserved
      label: opts.label ?? ""
    };
  }

  function makeOpening(poly) {
    return { id: uid(), kind: "opening", poly: poly.map(p => ({ x: p.x, y: p.y })) };
  }

  // Point load at coordinates (applied to nearest mesh node)
  function makePointLoad(x, y, opts = {}) {
    return {
      id: uid(), kind: "pload",
      x, y,
      caseId: opts.caseId ?? "DL",
      P: opts.P ?? 0,      // kN, +down
      Mx: opts.Mx ?? 0,    // kN·m about global X
      My: opts.My ?? 0
    };
  }

  // ------------------------------------------------------------------
  // Project
  // ------------------------------------------------------------------
  function newProject() {
    const mats = JSON.parse(JSON.stringify(CORE.DEFAULT_MATERIALS));
    mats.concrete.forEach(m => m.id = uid());
    mats.rebar.forEach(m => m.id = uid());
    return {
      meta: {
        name: "New Floor Project",
        engineer: "", company: "", date: new Date().toISOString().slice(0, 10),
        notes: ""
      },
      materials: mats,
      columns: [], beams: [], slabs: [], openings: [], pointLoads: [],
      loadCases: [
        { id: "DL", name: "Dead (D)", type: "dead", selfWeight: true },
        { id: "LL", name: "Live (L)", type: "live", selfWeight: false }
      ],
      combos: [
        { id: "U1", name: "1.4D",        factors: { DL: 1.4, LL: 0.0 }, type: "strength" },
        { id: "U2", name: "1.4D + 1.6L", factors: { DL: 1.4, LL: 1.6 }, type: "strength" },
        { id: "S1", name: "D + L",       factors: { DL: 1.0, LL: 1.0 }, type: "service" }
      ],
      meshSettings: { maxSize: 0.5 },
      underlay: null,        // {imgDataUrl, x, y, scale (m/px), opacity, visible}
      mesh: null,            // generated mesh (mesher.js)
      results: null,         // analysis results (solver.js)
      designResults: null    // design.js
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const getMat = (proj, id) =>
    proj.materials.concrete.find(m => m.id === id) ||
    proj.materials.rebar.find(m => m.id === id) ||
    proj.materials.concrete[0];

  const getRebar = (proj, id) =>
    proj.materials.rebar.find(m => m.id === id) || proj.materials.rebar[0];

  const defaultConcrete = (proj) => proj.materials.concrete[1] || proj.materials.concrete[0];

  // Effective plate properties for a slab region (handles ribbed slabs)
  function slabPlateProps(proj, slab) {
    const mat = slab.matId ? getMat(proj, slab.matId) : defaultConcrete(proj);
    const base = {
      E: mat.E, nu: mat.nu, G: mat.G, t: slab.t, gamma: mat.gamma,
      bendX: 1, bendY: 1, tors: 1, shear: 1,
      selfWeight: mat.gamma * slab.t
    };
    if (slab.slabType === "ribbed") {
      const r = CORE.ribbedSlabProps(slab.t, slab.rib.tf, slab.rib.bw, slab.rib.s,
        slab.rib.twoWay, mat.gamma, slab.rib.blockWeight);
      base.bendX = r.bendRatio; base.bendY = r.bendRatioY;
      base.tors = r.torsRatio; base.selfWeight = r.selfWeight;
      base.shear = Math.max(0.1, slab.rib.bw / slab.rib.s);
    }
    return base;
  }

  // Beam section properties
  function beamSectionProps(proj, beam) {
    const mat = beam.matId ? getMat(proj, beam.matId) : defaultConcrete(proj);
    const b = beam.b, h = beam.h;
    const I = b * h ** 3 / 12 * beam.stiffMod;
    // St-Venant torsion constant for rectangle
    const a = Math.max(b, h), c = Math.min(b, h);
    const J = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4))) * beam.torsMod;
    return { E: mat.E, G: mat.G, I, J, A: b * h, gamma: mat.gamma, mat };
  }

  // Serialize / deserialize project (files, examples)
  function save(proj) {
    const cp = { ...proj, mesh: null, results: null, designResults: null };
    return JSON.stringify(cp, null, 1);
  }
  function load(json) {
    const p = JSON.parse(json);
    // keep id counter ahead of everything
    let maxId = 0;
    const scan = (o) => { if (o && typeof o.id === "number") maxId = Math.max(maxId, o.id); };
    ["columns", "beams", "slabs", "openings", "pointLoads"].forEach(k => (p[k] || []).forEach(scan));
    p.materials.concrete.forEach(scan); p.materials.rebar.forEach(scan);
    _nextId = maxId + 1;
    p.mesh = null; p.results = null; p.designResults = null;
    return p;
  }

  return {
    uid, newProject, makeColumn, makeBeam, makeSlab, makeOpening, makePointLoad,
    getMat, getRebar, defaultConcrete, slabPlateProps, beamSectionProps, save, load
  };
})();
