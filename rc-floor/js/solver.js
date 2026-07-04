/* =========================================================================
 * RC-Floor-FEA — solver.js
 * Analysis pipeline: equation numbering → assembly (skyline) → LDLᵀ →
 * per-case solutions → combinations → force recovery → reactions.
 * See TECHNICAL_PLAN.md §5.
 * ========================================================================= */
"use strict";

const SOLVER = (() => {
  const { Skyline, M } = FEM;

  function analyze(proj, log = () => {}) {
    const mesh = proj.mesh;
    if (!mesh) throw new Error("Generate the mesh first.");
    const t0 = performance.now();

    // ---- 1. restraints ------------------------------------------------
    // dof index per node: 3*n + [0:w, 1:θx, 2:θy]
    const nn = mesh.nodes.length;
    const restrained = new Uint8Array(nn * 3);
    for (const sup of mesh.supports) {
      if (!sup.restraint) continue;
      if (sup.restraint.w)  restrained[3 * sup.nodeId] = 1;
      if (sup.restraint.rx) restrained[3 * sup.nodeId + 1] = 1;
      if (sup.restraint.ry) restrained[3 * sup.nodeId + 2] = 1;
    }
    const eqn = new Int32Array(nn * 3).fill(-1);
    let neq = 0;
    for (let i = 0; i < nn * 3; i++) if (!restrained[i]) eqn[i] = neq++;
    log(`Equations: ${neq} (of ${nn * 3} DOFs)`);

    // ---- 2. element stiffnesses ---------------------------------------
    const beamData = [];   // per beam element: {el, sec, lm, parent}
    for (const be of mesh.beams) {
      const parent = proj.beams.find(b => b.id === be.beamId);
      const sec = MODEL.beamSectionProps(proj, parent);
      const n1 = mesh.nodes[be.n1], n2 = mesh.nodes[be.n2];
      const el = ELEMENTS.beamElement(sec, n1.x, n1.y, n2.x, n2.y,
        { n1: be.relN1, n2: be.relN2 });
      const lm = [];
      for (const nd of [be.n1, be.n2])
        for (let d = 0; d < 3; d++) lm.push(eqn[3 * nd + d]);
      beamData.push({ be, el, sec, lm, parent });
    }

    const plateData = []; // per plate: {pe, T, Kg, lm, slab, props, xy}
    for (const pl of mesh.plates) {
      const slab = proj.slabs.find(s => s.id === pl.slabId);
      const props = MODEL.slabPlateProps(proj, slab);
      const xy = pl.nodes.map(n => [mesh.nodes[n].x, mesh.nodes[n].y]);
      const pe = ELEMENTS.plateElement(props, xy);
      const { Kg, T } = ELEMENTS.plateGlobalK(pe);
      const lm = [];
      for (const nd of pl.nodes)
        for (let d = 0; d < 3; d++) lm.push(eqn[3 * nd + d]);
      plateData.push({ pl, pe, T, Kg, lm, slab, props, xy });
    }

    // ---- 3. skyline assembly ------------------------------------------
    const sky = new Skyline(neq);
    for (const b of beamData) sky.connect(b.lm);
    for (const p of plateData) sky.connect(p.lm);
    sky.allocate();
    log(`Skyline storage: ${(sky.A.length * 8 / 1048576).toFixed(1)} MB`);
    for (const b of beamData) sky.assemble(b.el.kg, b.lm);
    for (const p of plateData) sky.assemble(p.Kg, p.lm);

    // column springs → diagonal
    for (const sup of mesh.supports) {
      if (!sup.springs) continue;
      const e = [eqn[3 * sup.nodeId], eqn[3 * sup.nodeId + 1], eqn[3 * sup.nodeId + 2]];
      const k = [sup.springs.kw, sup.springs.krx, sup.springs.kry];
      for (let d = 0; d < 3; d++) if (e[d] >= 0) sky.add(e[d], e[d], k[d]);
    }

    // ---- 4. load vectors per case --------------------------------------
    // Also remember per-element line load (for recovery) and full nodal
    // force vector incl. restrained DOFs (for equilibrium/reactions).
    const cases = {};
    for (const lc of proj.loadCases) {
      const F = new Float64Array(neq);
      const Ffull = new Float64Array(nn * 3);
      const beamW = new Float64Array(beamData.length);   // kN/m +down per element
      let totalLoad = 0;                                  // ΣFz applied (kN, +down)

      // beam loads: self-weight + line loads
      for (let ib = 0; ib < beamData.length; ib++) {
        const { be, el, sec, parent } = beamData[ib];
        let w0 = 0;
        if (lc.selfWeight) {
          // subtract slab overlap where the beam midpoint lies inside a slab
          const n1 = mesh.nodes[be.n1], n2 = mesh.nodes[be.n2];
          const mid = { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 };
          const slabHere = proj.slabs.find(s => CORE.G.inPolygon(mid, s.poly, 1e-4));
          const tOver = slabHere ? Math.min(slabHere.t, parent.h) : 0;
          w0 += sec.gamma * parent.b * Math.max(0, parent.h - tOver);
        }
        for (const ll of parent.lineLoads)
          if (ll.caseId === lc.id) w0 += ll.w;
        beamW[ib] = w0;
        if (w0 === 0) continue;
        totalLoad += w0 * el.L;
        // condensed fixed-end forces so released ends carry no moment/torsion
        const feqL = ELEMENTS.condenseFeq(el, ELEMENTS.beamLocalFeq(w0, el.L));
        const feqG = M.mulVec(M.transpose(el.T), feqL);
        const lm = beamData[ib].lm;
        const nds = [be.n1, be.n2];
        for (let a = 0; a < 6; a++) {
          const gdof = 3 * nds[Math.floor(a / 3)] + (a % 3);
          Ffull[gdof] += feqG[a];
          if (lm[a] >= 0) F[lm[a]] += feqG[a];
        }
      }

      // plate loads: self-weight + area loads (lumped by consistent ∫Ni dA)
      const plateQ = new Float64Array(plateData.length);
      for (let ip = 0; ip < plateData.length; ip++) {
        const { pl, pe, slab, props } = plateData[ip];
        let q = 0;
        if (lc.selfWeight) q += props.selfWeight;
        for (const al of slab.areaLoads) if (al.caseId === lc.id) q += al.q;
        plateQ[ip] = q;
        if (q === 0) continue;
        totalLoad += q * pe.area;
        for (let i = 0; i < 4; i++) {
          const gdof = 3 * pl.nodes[i];       // w dof, force = -q·∫Ni dA (z-up)
          const val = -q * pe.Nint[i];
          Ffull[gdof] += val;
          const e = eqn[gdof];
          if (e >= 0) F[e] += val;
        }
      }

      // point loads (nearest node) — tracked separately for reaction recovery
      const Fpoint = new Float64Array(nn * 3);
      for (const plo of proj.pointLoads) {
        if (plo.caseId !== lc.id) continue;
        let best = 1e30, nid = 0;
        for (const n of mesh.nodes) {
          const d = CORE.G.dist(n, plo); if (d < best) { best = d; nid = n.id; }
        }
        totalLoad += plo.P;
        const vals = [-plo.P, plo.Mx, plo.My];
        for (let d = 0; d < 3; d++) {
          Ffull[3 * nid + d] += vals[d];
          Fpoint[3 * nid + d] += vals[d];
          const e = eqn[3 * nid + d];
          if (e >= 0) F[e] += vals[d];
        }
      }

      cases[lc.id] = { F, Ffull, Fpoint, beamW, plateQ, totalLoad };
      log(`Case ${lc.name}: total gravity load = ${totalLoad.toFixed(1)} kN`);
    }

    // ---- 5. factorize + solve ------------------------------------------
    sky.factorize();
    for (const lc of proj.loadCases) {
      const c = cases[lc.id];
      c.u = sky.solve(Float64Array.from(c.F));     // keep original F intact
    }
    log(`Factorized & solved ${proj.loadCases.length} case(s) in ${(performance.now() - t0).toFixed(0)} ms`);

    // ---- 6. combinations -------------------------------------------------
    // Build result sets for every case AND combo (combos = linear superposition)
    const sets = [];
    for (const lc of proj.loadCases)
      sets.push({ id: lc.id, name: lc.name, kind: "case",
                  factors: { [lc.id]: 1 } });
    for (const cb of proj.combos)
      sets.push({ id: cb.id, name: cb.name, kind: cb.type, factors: cb.factors });

    const results = { sets: {}, mesh, eqn, neq, order: sets.map(s => s.id) };

    for (const set of sets) {
      // combined displacement vector (full, incl. restrained = 0)
      const ufull = new Float64Array(nn * 3);
      const beamWc = new Float64Array(beamData.length);
      const plateQc = new Float64Array(plateData.length);
      const Fpointc = new Float64Array(nn * 3);
      let totalLoad = 0;
      for (const [cid, f] of Object.entries(set.factors)) {
        if (!f || !cases[cid]) continue;
        const c = cases[cid];
        for (let i = 0; i < nn * 3; i++) {
          if (eqn[i] >= 0) ufull[i] += f * c.u[eqn[i]];
          Fpointc[i] += f * c.Fpoint[i];
        }
        for (let i = 0; i < beamData.length; i++) beamWc[i] += f * c.beamW[i];
        for (let i = 0; i < plateData.length; i++) plateQc[i] += f * c.plateQ[i];
        totalLoad += f * c.totalLoad;
      }

      // --- beam force recovery ---
      const beamRes = beamData.map((bd, ib) => {
        const ug = new Float64Array(6);
        const nds = [bd.be.n1, bd.be.n2];
        for (let a = 0; a < 6; a++) ug[a] = ufull[3 * nds[Math.floor(a / 3)] + (a % 3)];
        const fr = ELEMENTS.beamForces(bd.el, bd.sec, ug, beamWc[ib], 9);
        return { be: bd.be, parentId: bd.parent.id, ...fr };
      });

      // --- plate stress recovery: gauss → nodes → average ---
      const nAcc = mesh.nodes.map(() => null);
      const keys = ["Mx", "My", "Mxy", "Vx", "Vy"];
      for (let ip = 0; ip < plateData.length; ip++) {
        const { pl, pe, T } = plateData[ip];
        const ug = new Float64Array(12);
        for (let a = 0; a < 12; a++)
          ug[a] = ufull[3 * pl.nodes[Math.floor(a / 3)] + (a % 3)];
        const gp = ELEMENTS.plateStresses(pe, T, ug);
        for (const key of keys) {
          const nodal = ELEMENTS.gaussToNodes(gp, key);
          for (let i = 0; i < 4; i++) {
            const nid = pl.nodes[i];
            if (!nAcc[nid]) nAcc[nid] = { cnt: 0, Mx: 0, My: 0, Mxy: 0, Vx: 0, Vy: 0 };
            nAcc[nid][key] += nodal[i];
          }
        }
        for (let i = 0; i < 4; i++) nAcc[pl.nodes[i]].cnt++;
      }
      const plateNodal = nAcc.map(a => a ? {
        Mx: a.Mx / a.cnt, My: a.My / a.cnt, Mxy: a.Mxy / a.cnt,
        Vx: a.Vx / a.cnt, Vy: a.Vy / a.cnt
      } : null);

      // --- reactions at supports: R = Σe(k·u − f)|dof + springs ---
      const reactions = [];
      let sumR = 0;
      for (const sup of mesh.supports) {
        const nid = sup.nodeId;
        let R = [0, 0, 0];
        if (sup.restraint) {
          // element-based recovery
          for (let ib = 0; ib < beamData.length; ib++) {
            const bd = beamData[ib];
            const nds = [bd.be.n1, bd.be.n2];
            const li = nds.indexOf(nid);
            if (li < 0) continue;
            const ug = new Float64Array(6);
            for (let a = 0; a < 6; a++) ug[a] = ufull[3 * nds[Math.floor(a / 3)] + (a % 3)];
            const feq = ELEMENTS.beamLocalFeq(beamWc[ib], bd.el.L);
            let ul = M.mulVec(bd.el.T, ug);
            if (bd.el.released && bd.el.released.length)
              ul = ELEMENTS.recoverReleasedU(bd.el, ul, feq);
            const fl = M.mulVec(bd.el.kl, ul);
            for (let i = 0; i < 6; i++) fl[i] -= feq[i];
            const fg = M.mulVec(M.transpose(bd.el.T), fl);
            for (let d = 0; d < 3; d++) R[d] += fg[3 * li + d];
          }
          for (let ip = 0; ip < plateData.length; ip++) {
            const pd = plateData[ip];
            const li = pd.pl.nodes.indexOf(nid);
            if (li < 0) continue;
            const ug = new Float64Array(12);
            for (let a = 0; a < 12; a++)
              ug[a] = ufull[3 * pd.pl.nodes[Math.floor(a / 3)] + (a % 3)];
            // global element force = Kg·u − feq(global)
            const fg = M.mulVec(pd.Kg, ug);
            const q = plateQc[ip];
            for (let d = 0; d < 3; d++) {
              let v = fg[3 * li + d];
              if (d === 0 && q !== 0) v -= (-q * pd.pe.Nint[li]);
              R[d] += v;
            }
          }
          // point loads applied directly at the support node go straight
          // into the support:  R = Σe(k·u − f_elem) − F_point
          for (let d = 0; d < 3; d++) R[d] -= Fpointc[3 * nid + d];
        } else if (sup.springs) {
          R = [
            -sup.springs.kw * ufull[3 * nid],
            -sup.springs.krx * ufull[3 * nid + 1],
            -sup.springs.kry * ufull[3 * nid + 2]
          ];
        }
        // R[0] = vertical reaction, positive UP; R[1],R[2] = reaction moments
        reactions.push({
          nodeId: nid, columnId: sup.columnId,
          Rz: R[0], Mx: R[1], My: R[2]
        });
        sumR += R[0];
      }

      // equilibrium check: ΣRz (up) should equal total applied (down)
      const eqErr = totalLoad > 1e-6 ? Math.abs(sumR - totalLoad) / totalLoad : 0;

      results.sets[set.id] = {
        name: set.name, kind: set.kind, ufull, beamRes, plateNodal,
        reactions, totalLoad, sumR, eqErr
      };
      log(`${set.name}: ΣV=${totalLoad.toFixed(1)} kN, ΣR=${sumR.toFixed(1)} kN, equilibrium error ${(eqErr * 100).toFixed(2)}%`);
    }

    results.time = performance.now() - t0;
    return results;
  }

  return { analyze };
})();
