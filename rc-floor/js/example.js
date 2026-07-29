/* =========================================================================
 * RC-Floor-FEA — example.js
 * Built-in example: 12 m × 12 m combined floor —
 *   left half: slab-beam system (two 6 m bays with beams on grid lines)
 *   right half: flat slab on columns
 *   plus a stair opening and a ribbed-slab panel.
 * ========================================================================= */
"use strict";

const EXAMPLE = (() => {

  function build() {
    const p = MODEL.newProject();
    p.meta.name = "Example — Combined Slab-Beam + Flat Slab Floor";
    p.meta.engineer = "RC-Floor-FEA demo";
    p.meshSettings.maxSize = 0.5;

    const conc = p.materials.concrete[1];   // C30
    const reb = p.materials.rebar[0];       // Gr420

    // ---------------- columns: 3×3 grid at 6 m ----------------
    // All supports are rollers (vertical only); one corner is the hinged
    // reference support (also restrains the torsion-axis rotation).
    for (const x of [0, 6, 12]) for (const y of [0, 6, 12]) {
      const isRef = (x === 0 && y === 0);
      p.columns.push(MODEL.makeColumn(x, y, {
        bx: 0.5, by: 0.5, Lc: 3.0,
        supportType: isRef ? "hinged" : "roller",
        matId: conc.id, label: `C${x / 6 + 1}${y / 6 + 1}`
      }));
    }

    // ---------------- slab-beam zone: x ∈ [0,6] ----------------
    // beams on all grid lines of the left half
    const beams = [
      [[0, 0], [6, 0]], [[0, 6], [6, 6]], [[0, 12], [6, 12]],
      [[0, 0], [0, 12]], [[6, 0], [6, 12]]
    ];
    let bi = 1;
    for (const [a, b] of beams) {
      const bm = MODEL.makeBeam({ x: a[0], y: a[1] }, { x: b[0], y: b[1] },
        { b: 0.25, h: 0.60, matId: conc.id, rebarId: reb.id, label: `B${bi++}` });
      p.beams.push(bm);
    }
    // solid slab panels (two 6×6 bays)
    const s1 = MODEL.makeSlab(
      [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }],
      { t: 0.16, slabType: "solid", matId: conc.id, rebarId: reb.id, label: "S1" });
    s1.areaLoads.push({ caseId: "DL", q: 2.5 });   // finishes + partitions
    s1.areaLoads.push({ caseId: "LL", q: 3.0 });
    p.slabs.push(s1);

    // ribbed (hollow-block) panel in the top-left bay
    const s2 = MODEL.makeSlab(
      [{ x: 0, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 12 }, { x: 0, y: 12 }],
      { t: 0.30, slabType: "ribbed", matId: conc.id, rebarId: reb.id, label: "S2",
        rib: { tf: 0.08, bw: 0.12, s: 0.52, twoWay: true, blockWeight: 1.1 } });
    s2.areaLoads.push({ caseId: "DL", q: 2.0 });
    s2.areaLoads.push({ caseId: "LL", q: 2.0 });
    p.slabs.push(s2);

    // ---------------- flat-slab zone: x ∈ [6,12] ----------------
    const s3 = MODEL.makeSlab(
      [{ x: 6, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 6, y: 12 }],
      { t: 0.22, slabType: "flat", matId: conc.id, rebarId: reb.id, label: "S3" });
    s3.areaLoads.push({ caseId: "DL", q: 2.5 });
    s3.areaLoads.push({ caseId: "LL", q: 4.0 });
    p.slabs.push(s3);

    // stair opening in the flat slab
    p.openings.push(MODEL.makeOpening(
      [{ x: 8.5, y: 8.5 }, { x: 10.5, y: 8.5 }, { x: 10.5, y: 10.5 }, { x: 8.5, y: 10.5 }]));

    // an extra point load (equipment) on the flat slab
    p.pointLoads.push(MODEL.makePointLoad(9, 3, { caseId: "DL", P: 25 }));

    return p;
  }

  return { build };
})();
