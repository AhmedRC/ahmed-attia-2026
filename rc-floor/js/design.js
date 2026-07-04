/* =========================================================================
 * RC-Floor-FEA — design.js
 * Reinforced-concrete design per ACI 318-19 (SI units: MPa, mm, kN, kN·m).
 *   - Beam flexure & shear (envelope of strength combos)
 *   - Slab flexural reinforcement (Wood–Armer design moments)
 *   - Punching shear at columns in flat-slab regions
 *   - Column axial design (supports modeled as columns)
 * ========================================================================= */
"use strict";

const DESIGN = (() => {

  const PHI_FLEX = 0.90, PHI_SHEAR = 0.75, PHI_COMP_TIED = 0.65;

  // -------- rectangular-section flexural steel (SI: mm, MPa, kN·m) --------
  // Returns {As (mm²), a, ok, note}
  function flexSteel(Mu /*kN·m*/, b /*mm*/, d /*mm*/, fc, fy) {
    if (Mu <= 1e-9) return { As: 0, a: 0, ok: true, note: "" };
    const MuNmm = Mu * 1e6;                    // N·mm
    let As = MuNmm / (PHI_FLEX * fy * 0.9 * d);   // initial guess
    for (let i = 0; i < 30; i++) {
      const a = As * fy / (0.85 * fc * b);
      const AsNew = MuNmm / (PHI_FLEX * fy * (d - a / 2));
      if (Math.abs(AsNew - As) < 1e-3) { As = AsNew; break; }
      As = AsNew;
    }
    const a = As * fy / (0.85 * fc * b);
    const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
    const c = a / beta1;
    const et = 0.003 * (d - c) / c;            // net tensile strain
    const ety = fy / 200000;
    const ok = et >= ety + 0.003;              // tension-controlled (φ=0.9 valid)
    return { As, a, c, et, ok, note: ok ? "" : "NOT tension-controlled — increase section" };
  }

  // minimum flexural steel for beams — ACI 9.6.1.2
  const beamAsMin = (bw, d, fc, fy) =>
    Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy) * bw * d;

  // suggest bars: returns "nØd" string for a required area
  function pickBars(AsReq /*mm²*/, bmm, forSlab = false) {
    if (AsReq <= 0) return "-";
    const opts = forSlab ? [10, 12, 14, 16, 18, 20, 22, 25] : [12, 16, 18, 20, 22, 25];
    for (const dia of opts) {
      const a1 = Math.PI * dia * dia / 4;
      const n = Math.ceil(AsReq / a1);
      if (forSlab) {
        const s = Math.floor(1000 / n / 10) * 10;      // spacing per meter
        if (s >= 100) return `Ø${dia}@${Math.min(s, 250)}mm (${(1000 / Math.min(s,250) * a1).toFixed(0)} mm²/m)`;
      } else {
        const maxFit = Math.floor((bmm - 80) / (dia + 30)) + 1;
        if (n >= 2 && n <= Math.max(2, maxFit)) return `${n}Ø${dia} (${(n * a1).toFixed(0)} mm²)`;
      }
    }
    const dia = forSlab ? 20 : 25, a1 = Math.PI * dia * dia / 4;
    return `${Math.ceil(AsReq / a1)}Ø${dia} (${(Math.ceil(AsReq / a1) * a1).toFixed(0)} mm²)`;
  }

  /* =====================================================================
   * BEAM DESIGN
   * ===================================================================== */
  function designBeams(proj, results) {
    const out = [];
    const strengthSets = results.order.filter(id =>
      results.sets[id].kind === "strength");
    for (const beam of proj.beams) {
      const mat = beam.matId ? MODEL.getMat(proj, beam.matId) : MODEL.defaultConcrete(proj);
      const reb = MODEL.getRebar(proj, beam.rebarId);
      const fc = mat.fc, fy = reb.fy;
      const bmm = beam.b * 1000, hmm = beam.h * 1000;
      const cover = 40, dsMain = 16, dsStir = 8;
      const d = hmm - cover - dsStir - dsMain / 2;      // mm

      // envelope along the beam from all strength sets
      let MposMax = 0, MnegMax = 0, Vmax = 0, Tmax = 0, L = 0;
      let xMpos = 0, xMneg = 0;
      for (const sid of strengthSets) {
        const set = results.sets[sid];
        const els = set.beamRes.filter(r => r.parentId === beam.id);
        for (const el of els) {
          for (const st of el.sta) {
            const xg = el.be.s1 + st.x;
            if (st.M > MposMax) { MposMax = st.M; xMpos = xg; }
            if (st.M < -MnegMax) { MnegMax = -st.M; xMneg = xg; }
            Vmax = Math.max(Vmax, Math.abs(st.V));
            Tmax = Math.max(Tmax, Math.abs(st.T));
          }
          L = Math.max(L, el.be.s2);
        }
      }

      // ---- flexure
      const bot = flexSteel(MposMax, bmm, d, fc, fy);
      const top = flexSteel(MnegMax, bmm, d, fc, fy);
      const AsMin = beamAsMin(bmm, d, fc, fy);
      const AsBot = Math.max(bot.As, MposMax > 0 ? AsMin : 0);
      const AsTop = Math.max(top.As, MnegMax > 0 ? AsMin : 0);
      const rhoMax = 0.025;   // practical ceiling flag
      const flexOK = bot.ok && top.ok &&
        AsBot / (bmm * d) < rhoMax && AsTop / (bmm * d) < rhoMax;

      // ---- shear (ACI 22.5): Vc = 0.17 λ √fc' bw d
      const Vc = 0.17 * Math.sqrt(fc) * bmm * d / 1000;        // kN
      const VsReq = Math.max(0, Vmax / PHI_SHEAR - Vc);        // kN
      const VsMax = 0.66 * Math.sqrt(fc) * bmm * d / 1000;
      const shearOK = VsReq <= VsMax;
      // Av/s required (mm²/mm): Vs = Av fy d / s
      let AvS = VsReq * 1000 / (fy * d);                       // mm²/mm
      const AvSmin = Math.max(0.062 * Math.sqrt(fc), 0.35) * bmm / fy;
      const needStirrups = Vmax > PHI_SHEAR * Vc / 2;
      if (needStirrups) AvS = Math.max(AvS, AvSmin);
      // 2-leg Ø8 stirrups
      const Av2L8 = 2 * Math.PI * 64 / 4;                      // = 100.5 mm²
      let s = AvS > 0 ? Av2L8 / AvS : 0;
      const sMax = (VsReq <= 0.33 * Math.sqrt(fc) * bmm * d / 1000)
        ? Math.min(d / 2, 600) : Math.min(d / 4, 300);
      if (s > 0) s = Math.min(s, sMax);
      s = Math.floor(s / 10) * 10;

      // development length (ACI 25.4.2.3, simplified: Ø≤19, normal weight)
      const ld = Math.max(300, (fy * 1.0 * 1.0 / (2.1 * Math.sqrt(fc))) * dsMain);

      out.push({
        beamId: beam.id, label: beam.label || `B${beam.id}`,
        b: bmm, h: hmm, d, L, fc, fy,
        MposMax, xMpos, MnegMax, xMneg, Vmax, Tmax,
        AsBot, AsTop, AsMin,
        barsBot: pickBars(AsBot, bmm), barsTop: pickBars(AsTop, bmm),
        Vc, VsReq, AvS, stirrups: needStirrups && s > 0 ? `2-leg Ø8 @ ${s} mm` : "min. stirrups Ø8 @ " + Math.min(Math.floor(d / 2 / 10) * 10, 600) + " mm",
        ld: Math.ceil(ld / 10) * 10,
        flexOK, shearOK,
        notes: [bot.note, top.note, shearOK ? "" : "Vs > 0.66√fc'·bw·d — enlarge section"].filter(Boolean)
      });
    }
    return out;
  }

  /* =====================================================================
   * SLAB DESIGN — Wood–Armer per node, aggregated per slab region
   * ===================================================================== */
  function designSlabs(proj, results) {
    const out = [];
    const strengthSets = results.order.filter(id => results.sets[id].kind === "strength");
    const mesh = results.mesh;

    for (const slab of proj.slabs) {
      const mat = slab.matId ? MODEL.getMat(proj, slab.matId) : MODEL.defaultConcrete(proj);
      const reb = MODEL.getRebar(proj, slab.rebarId);
      const fc = mat.fc, fy = reb.fy;
      const tmm = slab.t * 1000;
      const cover = (slab.cover ?? 0.02) * 1000;
      const dX = tmm - cover - 6;          // bottom X (first layer), bar Ø12 avg
      const dY = tmm - cover - 6 - 12;     // second layer

      // envelope Wood–Armer design moments over slab nodes
      let MxBot = 0, MyBot = 0, MxTop = 0, MyTop = 0;
      let wMaxSrv = 0;
      const nodeIds = new Set();
      mesh.plates.filter(p => p.slabId === slab.id)
        .forEach(p => p.nodes.forEach(n => nodeIds.add(n)));

      for (const sid of strengthSets) {
        const set = results.sets[sid];
        for (const nid of nodeIds) {
          const m = set.plateNodal[nid];
          if (!m) continue;
          const ax = Math.abs(m.Mxy);
          MxBot = Math.max(MxBot, m.Mx + ax);      // bottom steel demand
          MyBot = Math.max(MyBot, m.My + ax);
          MxTop = Math.max(MxTop, -(m.Mx - ax));   // top steel demand (hogging)
          MyTop = Math.max(MyTop, -(m.My - ax));
        }
      }
      for (const sid of results.order) {
        const set = results.sets[sid];
        if (set.kind !== "service") continue;
        for (const nid of nodeIds)
          wMaxSrv = Math.max(wMaxSrv, -set.ufull[3 * nid]);   // +down (m)
      }

      const AsMin = 0.0018 * 1000 * tmm;   // mm²/m (ACI 24.4.3.2, Gr420)
      const sMax = Math.min(3 * tmm, 450);
      const mk = (Mu, d) => {
        const r = flexSteel(Math.max(0, Mu), 1000, d, fc, fy);
        const As = Math.max(r.As, Mu > 0.05 ? AsMin : AsMin);   // always ≥ As,min
        return { As, bars: pickBars(As, 1000, true), ok: r.ok };
      };
      const botX = mk(MxBot, dX), botY = mk(MyBot, dY);
      const topX = mk(MxTop, dX), topY = mk(MyTop, dY);

      out.push({
        slabId: slab.id, label: slab.label || `S${slab.id}`,
        type: slab.slabType, t: tmm, fc, fy, cover, AsMin, sMax,
        MxBot, MyBot, MxTop, MyTop,
        botX, botY, topX, topY,
        wMaxSrv: wMaxSrv * 1000,   // mm
        deflLimit: null,           // filled by caller with span/240 if desired
        ok: botX.ok && botY.ok && topX.ok && topY.ok
      });
    }
    return out;
  }

  /* =====================================================================
   * PUNCHING SHEAR — flat-slab columns (ACI 22.6)
   * ===================================================================== */
  function designPunching(proj, results) {
    const out = [];
    const strengthSets = results.order.filter(id => results.sets[id].kind === "strength");
    const mesh = results.mesh;

    for (const col of proj.columns) {
      // find slab containing the column that is of type "flat" (or solid)
      const here = proj.slabs.find(s => CORE.G.inPolygon({ x: col.x, y: col.y }, s.poly, 1e-3));
      if (!here || here.slabType === "ribbed") continue;
      const mat = here.matId ? MODEL.getMat(proj, here.matId) : MODEL.defaultConcrete(proj);
      const fc = mat.fc;
      const tmm = here.t * 1000;
      const dAvg = tmm - (here.cover ?? 0.02) * 1000 - 12;   // mm

      // classify interior/edge/corner by quadrant coverage over ALL slab
      // regions (columns often sit on the border between two regions)
      const e = col.bx / 2 + dAvg / 1000 + 0.05;
      const covered = [[1, 1], [-1, 1], [-1, -1], [1, -1]].filter(([sx, sy]) => {
        const pt = { x: col.x + sx * e, y: col.y + sy * e };
        return proj.slabs.some(s => CORE.G.inPolygon(pt, s.poly, 1e-3)) &&
               !proj.openings.some(o => CORE.G.inPolygon(pt, o.poly, -1e-3));
      }).length;
      const kind = covered >= 4 ? "interior" : covered >= 2 ? "edge" : "corner";
      const alphaS = kind === "interior" ? 40 : kind === "edge" ? 30 : 20;

      const c1 = (col.shape === "circle" ? col.bx : col.bx) * 1000;
      const c2 = (col.shape === "circle" ? col.bx : col.by) * 1000;
      // critical perimeter b0 (mm)
      let b0;
      if (kind === "interior") b0 = 2 * (c1 + dAvg) + 2 * (c2 + dAvg);
      else if (kind === "edge") b0 = 2 * (c1 + dAvg / 2) + (c2 + dAvg);
      else b0 = (c1 + dAvg / 2) + (c2 + dAvg / 2);

      // Vu: max factored reaction MINUS shear delivered directly by beams
      // framing into the column (beam load does not punch through the slab).
      // Load inside the critical perimeter is ignored (small, conservative).
      const sup = mesh.supports.find(s => s.columnId === col.id);
      let Vu = 0, setName = "";
      for (const sid of strengthSets) {
        const set = results.sets[sid];
        const r = set.reactions.find(r => r.columnId === col.id);
        if (!r) continue;
        let beamV = 0;
        if (sup) for (const br of set.beamRes) {
          // beam share of the vertical reaction: end force ON the element
          // from the node (z-up, = +qL/2 at a simple support end)
          if (br.be.n1 === sup.nodeId) beamV += br.end[0];
          else if (br.be.n2 === sup.nodeId) beamV += br.end[3];
        }
        const v = Math.max(0, Math.abs(r.Rz) - Math.max(0, beamV));
        if (v > Vu) { Vu = v; setName = set.name; }
      }
      if (Vu === 0) continue;

      const beta = Math.max(c1, c2) / Math.min(c1, c2);
      const vc = Math.min(
        0.33 * Math.sqrt(fc),
        0.17 * (1 + 2 / beta) * Math.sqrt(fc),
        0.083 * (2 + alphaS * dAvg / b0) * Math.sqrt(fc)
      );                                             // MPa
      const vu = Vu * 1000 / (b0 * dAvg);            // MPa
      const util = vu / (PHI_SHEAR * vc);
      out.push({
        columnId: col.id, label: col.label || `C${col.id}`,
        kind, c1, c2, d: dAvg, b0, Vu, setName, fc,
        vc, phiVc: PHI_SHEAR * vc, vu, util,
        ok: util <= 1.0,
        remedy: util <= 1.0 ? "" :
          util <= 1.5 ? "Increase slab thickness, add drop panel, or provide shear reinforcement/studs."
                      : "Punching capacity greatly exceeded — add drop panel / column capital or increase thickness."
      });
    }
    return out;
  }

  /* =====================================================================
   * COLUMN DESIGN — axial (+ reaction moments) per ACI 318-19 Ch.10
   * ===================================================================== */
  function designColumns(proj, results) {
    const out = [];
    const strengthSets = results.order.filter(id => results.sets[id].kind === "strength");
    for (const col of proj.columns) {
      const mat = col.matId ? MODEL.getMat(proj, col.matId) : MODEL.defaultConcrete(proj);
      const reb = proj.materials.rebar[0];
      const fc = mat.fc, fy = reb.fy;
      const b = col.bx * 1000, h = (col.shape === "circle" ? col.bx : col.by) * 1000;
      const Ag = col.shape === "circle" ? Math.PI * b * b / 4 : b * h;

      let Pu = 0, Mu = 0, setName = "";
      for (const sid of strengthSets) {
        const set = results.sets[sid];
        const r = set.reactions.find(r => r.columnId === col.id);
        if (!r) continue;
        const m = Math.hypot(r.Mx, r.My);
        if (Math.abs(r.Rz) > Pu) { Pu = Math.abs(r.Rz); Mu = m; setName = set.name; }
      }
      if (Pu === 0) continue;

      // required Ast from φPn,max = 0.80 φ [0.85fc'(Ag−Ast) + fy Ast]
      const phi = PHI_COMP_TIED;
      let AstReq = (Pu * 1000 / (0.80 * phi) - 0.85 * fc * Ag) / (fy - 0.85 * fc);
      const AstMin = 0.01 * Ag;
      AstReq = Math.max(AstReq, AstMin);
      const AstMax = 0.08 * Ag;
      const rho = AstReq / Ag;
      const capacity = 0.80 * phi * (0.85 * fc * (Ag - AstReq) + fy * AstReq) / 1000; // kN

      // bars (min 4 corner bars)
      let bars = "-";
      for (const dia of [16, 18, 20, 22, 25, 28, 32]) {
        const a1 = Math.PI * dia * dia / 4;
        let n = Math.ceil(AstReq / a1);
        n = Math.max(4, n % 2 ? n + 1 : n);
        if (n <= 16) { bars = `${n}Ø${dia} (${(n * a1).toFixed(0)} mm², ρ=${(n * a1 / Ag * 100).toFixed(2)}%)`; break; }
      }
      // ties: Ø10 for main ≤ Ø32 (25.7.2.2); spacing 25.7.2.1
      const mainDia = parseInt(bars.split("Ø")[1]) || 16;
      const tieS = Math.min(16 * mainDia, 48 * 10, Math.min(b, h));
      out.push({
        columnId: col.id, label: col.label || `C${col.id}`,
        shape: col.shape, b, h, Ag, fc, fy, Lc: col.Lc,
        Pu, Mu, setName, AstReq, AstMin, rho, capacity,
        bars, ties: `Ø10 @ ${Math.floor(tieS / 10) * 10} mm`,
        ok: AstReq <= AstMax && rho >= 0.01,
        note: AstReq > AstMax ? "ρ > 8% — increase column size" :
              Mu > 0.05 * Pu * Math.min(b, h) / 1000 ?
                "Significant reaction moment — verify with full P-M interaction (v2)." : ""
      });
    }
    return out;
  }

  function run(proj, results) {
    return {
      beams: designBeams(proj, results),
      slabs: designSlabs(proj, results),
      punching: designPunching(proj, results),
      columns: designColumns(proj, results),
      code: "ACI 318-19", date: new Date().toISOString()
    };
  }

  return { run, flexSteel, pickBars, beamAsMin };
})();
