/* =========================================================================
 * RC-Floor-FEA — elements.js
 * Element formulations for the plate-grillage floor model.
 *
 * Global DOFs per node: [w, θx, θy]
 *   w  : vertical deflection, positive UP (user loads are entered +down and
 *        applied as negative Fz; displayed deflections are negated → +down)
 *   θx : rotation about global X,  θy : rotation about global Y
 *
 * Plate rotations (Mindlin, Bathe convention u=-zβx, v=-zβy):
 *   βx = -θy ,  βy = +θx
 * Sign convention for output: Mx, My positive = SAGGING (tension bottom).
 * ========================================================================= */
"use strict";

const ELEMENTS = (() => {
  const { M } = FEM;

  /* =====================================================================
   * GRILLAGE BEAM: 2-node, local DOFs [w1 θlx1 θly1 w2 θlx2 θly2]
   *   θlx = torsional rotation (about member axis)
   *   θly = bending rotation (about local y, θly = -dw/dl)
   * ===================================================================== */
  function beamLocalK(E, I, G, J, L) {
    const k = M.zeros(6, 6);
    const a = E * I / L ** 3;
    // bending on (w1,θly1,w2,θly2) — Hermitian with θ = -dw/dx sign map
    const kb = [
      [ 12 * a,      -6 * a * L, -12 * a,     -6 * a * L],
      [ -6 * a * L,   4 * a * L * L, 6 * a * L, 2 * a * L * L],
      [-12 * a,       6 * a * L,  12 * a,      6 * a * L],
      [ -6 * a * L,   2 * a * L * L, 6 * a * L, 4 * a * L * L]
    ];
    const map = [0, 2, 3, 5];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) k[map[i]][map[j]] = kb[i][j];
    // torsion on (θlx1, θlx2)
    const t = G * J / L;
    k[1][1] += t; k[4][4] += t; k[1][4] -= t; k[4][1] -= t;
    return k;
  }

  // transformation local<-global for direction cosines (c,s) of member axis
  // θlx = c θX + s θY ;  θly = -s θX + c θY ;  w = w
  function beamT(c, s) {
    const T = M.zeros(6, 6);
    for (const o of [0, 3]) {
      T[o][o] = 1;
      T[o + 1][o + 1] = c; T[o + 1][o + 2] = s;
      T[o + 2][o + 1] = -s; T[o + 2][o + 2] = c;
    }
    return T;
  }

  // Equivalent (consistent) nodal load vector for uniform load w0 (kN/m, +down)
  // in LOCAL dofs. Vertical forces negative (z-up).
  function beamLocalFeq(w0, L) {
    const f = new Float64Array(6);
    f[0] = -w0 * L / 2;              // Fz node 1
    f[3] = -w0 * L / 2;              // Fz node 2
    // fixed-end moments, θly convention (θ = -dw/dx): M1=+qL²/12, M2=-qL²/12
    f[2] = +w0 * L * L / 12;
    f[5] = -w0 * L * L / 12;
    return f;
  }

  // ---- end-release (moment hinge) support ----------------------------
  // Local dof indices: node1 [w0 θlx1 θly2] = 0,1,2 ; node2 = 3,4,5.
  // A release frees bending (θly) AND torsion (θlx) at that end so the
  // recovered bending and torsional moments there are exactly zero.
  function releasedDofs(rel) {
    const R = [];
    if (rel && rel.n1) R.push(1, 2);   // torsion + bending at node 1
    if (rel && rel.n2) R.push(4, 5);   // torsion + bending at node 2
    return R;
  }

  // Invert a small dense symmetric matrix (Gauss–Jordan). n ≤ 4.
  function invSmall(A) {
    const n = A.length;
    const Mn = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(Mn[r][c]) > Math.abs(Mn[piv][c])) piv = r;
      [Mn[c], Mn[piv]] = [Mn[piv], Mn[c]];
      const d = Mn[c][c];
      for (let j = 0; j < 2 * n; j++) Mn[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = Mn[r][c];
        if (f === 0) continue;
        for (let j = 0; j < 2 * n; j++) Mn[r][j] -= f * Mn[c][j];
      }
    }
    return Mn.map(r => r.slice(n));
  }

  // Statically condense released dofs R out of local stiffness kl (6×6).
  // Returns condensed 6×6 (released rows/cols zeroed) and Grr = inv(kl_RR).
  function condenseK(kl, R) {
    if (!R.length) return { klc: kl, Grr: null };
    const Krr = R.map(a => R.map(b => kl[a][b]));
    const Grr = invSmall(Krr);
    const klc = kl.map(row => row.slice());
    // klc[i][j] -= Σ kl[i][Rp] Grr[p][q] kl[Rq][j]   for all i,j
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        let sub = 0;
        for (let p = 0; p < R.length; p++)
          for (let q = 0; q < R.length; q++)
            sub += kl[i][R[p]] * Grr[p][q] * kl[R[q]][j];
        klc[i][j] -= sub;
      }
    for (const d of R) for (let k = 0; k < 6; k++) { klc[d][k] = 0; klc[k][d] = 0; }
    return { klc, Grr };
  }

  // Condensed local equivalent-load vector (released entries → 0).
  function condenseFeq(el, feqL) {
    const R = el.released;
    if (!R || !R.length) return feqL;
    const f = feqL.slice();
    for (let i = 0; i < 6; i++) {
      let sub = 0;
      for (let p = 0; p < R.length; p++)
        for (let q = 0; q < R.length; q++)
          sub += el.kl[i][R[p]] * el.Grr[p][q] * feqL[R[q]];
      f[i] -= sub;
    }
    for (const d of R) f[d] = 0;
    return f;
  }

  // Recover the true local displacements at released dofs (the global rotation
  // at a released node belongs to the slab/other members, not this hinge):
  //   u_R = Grr · ( feq_R − Σ_retained kl[R][k]·u_k )
  function recoverReleasedU(el, ul, feqL) {
    const R = el.released;
    if (!R || !R.length) return ul;
    const u = Float64Array.from(ul);
    const retained = [0, 1, 2, 3, 4, 5].filter(d => !R.includes(d));
    const rhs = R.map((rd, q) => {
      let s = feqL[rd];
      for (const k of retained) s -= el.kl[rd][k] * u[k];
      return s;
    });
    for (let p = 0; p < R.length; p++) {
      let v = 0;
      for (let q = 0; q < R.length; q++) v += el.Grr[p][q] * rhs[q];
      u[R[p]] = v;
    }
    return u;
  }

  // Build global stiffness + transformation for a meshed beam element.
  // rel (optional): {n1:bool, n2:bool} end moment/torsion releases.
  function beamElement(sec, x1, y1, x2, y2, rel = null) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    const c = (x2 - x1) / L, s = (y2 - y1) / L;
    const kl = beamLocalK(sec.E, sec.I, sec.G, sec.J, L);
    const R = releasedDofs(rel);
    const { klc, Grr } = condenseK(kl, R);
    const T = beamT(c, s);
    const kg = M.tBA(T, klc);        // Tᵀ kl_condensed T
    return { L, c, s, kl, klc, Grr, released: R, T, kg };
  }

  // End-force recovery. ug: 6 global dofs; w0 total uniform load (+down).
  // Returns engineering stations: V (shear), Mb (sagging+), Tq (torsion)
  function beamForces(el, sec, ug, w0, nSta = 9) {
    const feq = beamLocalFeq(w0, el.L);
    let ul = M.mulVec(el.T, ug);
    if (el.released && el.released.length) ul = recoverReleasedU(el, ul, feq);
    const fl = M.mulVec(el.kl, ul);
    for (let i = 0; i < 6; i++) fl[i] -= feq[i];
    // fl = forces exerted ON the element at its ends, local dofs
    const f1z = fl[0], c1 = fl[2];          // c1: moment about local y at end 1
    const T1 = fl[1];
    const sta = [];
    for (let i = 0; i < nSta; i++) {
      const x = el.L * i / (nSta - 1);
      sta.push({
        x,
        V: f1z - w0 * x,                    // engineering shear
        M: c1 + f1z * x - w0 * x * x / 2,   // sagging positive
        T: -T1                              // torsion (constant, no dist. torque)
      });
    }
    return { sta, end: fl };
  }

  /* =====================================================================
   * MITC4 MINDLIN PLATE (Bathe & Dvorkin 1985; Bathe FEP §5.4.2)
   * 4 nodes CCW; plate DOFs per node [w, βx, βy]; 12 dofs total.
   * props: {E, nu, G, t, bendX, bendY, tors, shear} (modifiers for ribbed)
   * ===================================================================== */
  const GP = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const RI = [-1, 1, 1, -1], SI = [-1, -1, 1, 1];

  function shape(r, s) {
    const N = [], dNr = [], dNs = [];
    for (let i = 0; i < 4; i++) {
      N[i]   = 0.25 * (1 + r * RI[i]) * (1 + s * SI[i]);
      dNr[i] = 0.25 * RI[i] * (1 + s * SI[i]);
      dNs[i] = 0.25 * SI[i] * (1 + r * RI[i]);
    }
    return { N, dNr, dNs };
  }

  function jacobian(xy, dNr, dNs) {
    let xr = 0, yr = 0, xs = 0, ys = 0;
    for (let i = 0; i < 4; i++) {
      xr += dNr[i] * xy[i][0]; yr += dNr[i] * xy[i][1];
      xs += dNs[i] * xy[i][0]; ys += dNs[i] * xy[i][1];
    }
    const det = xr * ys - yr * xs;
    return { xr, yr, xs, ys, det,
      // J = [[x,r  y,r],[x,s  y,s]]  →  J⁻¹ = 1/det [[y,s  -y,r],[-x,s  x,r]]
      rx: ys / det, sx: -yr / det, ry: -xs / det, sy: xr / det };
  }

  // Constitutive matrices with orthotropic modifiers
  function plateD(p) {
    const D0 = p.E * p.t ** 3 / (12 * (1 - p.nu * p.nu));
    const m12 = Math.min(p.bendX, p.bendY);
    const Db = [
      [D0 * p.bendX,        D0 * p.nu * m12,  0],
      [D0 * p.nu * m12,     D0 * p.bendY,     0],
      [0, 0, D0 * (1 - p.nu) / 2 * p.tors]
    ];
    const ks = 5 / 6;
    const Ds = [
      [ks * p.G * p.t * p.shear, 0],
      [0, ks * p.G * p.t * p.shear]
    ];
    return { Db, Ds };
  }

  // Bending B-matrix (3 x 12) at (r,s): κ = [βx,x ; βy,y ; βx,y + βy,x]
  function Bbend(jac, dNr, dNs) {
    const B = M.zeros(3, 12);
    for (let i = 0; i < 4; i++) {
      const Nx = dNr[i] * jac.rx + dNs[i] * jac.sx;
      const Ny = dNr[i] * jac.ry + dNs[i] * jac.sy;
      B[0][3 * i + 1] = Nx;                 // βx,x
      B[1][3 * i + 2] = Ny;                 // βy,y
      B[2][3 * i + 1] = Ny;                 // βx,y
      B[2][3 * i + 2] = Nx;                 // βy,x
    }
    return B;
  }

  // MITC covariant shear B-rows.
  // γ_r = w,r - (x,r βx + y,r βy) evaluated at a sampling point (rp,sp):
  function covShearRow(xy, rp, sp, dir /*"r"|"s"*/) {
    const { dNr, dNs, N } = shape(rp, sp);
    const jac = jacobian(xy, dNr, dNs);
    const row = new Float64Array(12);
    const dN = dir === "r" ? dNr : dNs;
    const gx = dir === "r" ? jac.xr : jac.xs;
    const gy = dir === "r" ? jac.yr : jac.ys;
    for (let i = 0; i < 4; i++) {
      row[3 * i]     += dN[i];       // w,dir
      row[3 * i + 1] -= N[i] * gx;   // -x,dir · βx
      row[3 * i + 2] -= N[i] * gy;   // -y,dir · βy
    }
    return row;
  }

  // Shear B (2 x 12, Cartesian γxz γyz) at (r,s) using MITC interpolation
  function BshearMITC(xy, r, s, rowsA, rowsC, rowsD, rowsB) {
    // covariant interpolation
    const gr = new Float64Array(12), gs = new Float64Array(12);
    for (let k = 0; k < 12; k++) {
      gr[k] = 0.5 * (1 + s) * rowsA[k] + 0.5 * (1 - s) * rowsC[k];
      gs[k] = 0.5 * (1 + r) * rowsD[k] + 0.5 * (1 - r) * rowsB[k];
    }
    // convert covariant -> cartesian: [γx;γy] = J⁻¹ [γr;γs]
    const { dNr, dNs } = shape(r, s);
    const jac = jacobian(xy, dNr, dNs);
    const B = M.zeros(2, 12);
    for (let k = 0; k < 12; k++) {
      B[0][k] = jac.rx * gr[k] + jac.sx * gs[k];
      B[1][k] = jac.ry * gr[k] + jac.sy * gs[k];
    }
    return { B, jac };
  }

  // Full element: stiffness (12x12 in plate dofs), consistent load, recovery data
  function plateElement(props, xy /*[[x,y]x4 CCW]*/) {
    const { Db, Ds } = plateD(props);
    const K = M.zeros(12, 12);
    // MITC sampling rows: A(0,1), C(0,-1) for γ_r ; D(1,0), B(-1,0) for γ_s
    const rowsA = covShearRow(xy, 0, 1, "r");
    const rowsC = covShearRow(xy, 0, -1, "r");
    const rowsD = covShearRow(xy, 1, 0, "s");
    const rowsB = covShearRow(xy, -1, 0, "s");

    let area = 0;
    const Nint = new Float64Array(4);       // ∫Ni dA for load vector
    const gpData = [];                       // for stress recovery

    for (const r of GP) for (const s of GP) {
      const { N, dNr, dNs } = shape(r, s);
      const jac = jacobian(xy, dNr, dNs);
      if (jac.det <= 0) throw new Error("Plate element has non-positive Jacobian (bad geometry).");
      const w = jac.det;                     // gauss weight = 1
      area += w;
      for (let i = 0; i < 4; i++) Nint[i] += N[i] * w;
      const Bb = Bbend(jac, dNr, dNs);
      M.addInPlace(K, M.tBA(Bb, Db), w);
      const { B: Bs } = BshearMITC(xy, r, s, rowsA, rowsC, rowsD, rowsB);
      M.addInPlace(K, M.tBA(Bs, Ds), w);
      gpData.push({ r, s, Bb, Bs });
    }
    return { K, area, Nint, gpData, Db, Ds };
  }

  // plate DOF transformation: [w, βx, βy] = Tp · [w, θx, θy]
  //   βx=-θy, βy=+θx
  const Tp3 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  function plateGlobalK(pe) {
    // K_g = Tᵀ K_p T with block-diagonal T of Tp3
    const T = M.zeros(12, 12);
    for (let n = 0; n < 4; n++)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        T[3 * n + i][3 * n + j] = Tp3[i][j];
    return { Kg: M.tBA(T, pe.K), T };
  }

  // Moments/shears at gauss points from global element displacements.
  // Output sign: Mx,My positive = sagging (tension bottom).
  function plateStresses(pe, T, ug) {
    const up = M.mulVec(T, ug);              // plate-convention dofs
    const out = [];
    for (const g of pe.gpData) {
      const kappa = M.mulVec(g.Bb, up);
      const gam = M.mulVec(g.Bs, up);
      const Mx  = pe.Db[0][0] * kappa[0] + pe.Db[0][1] * kappa[1];
      const My  = pe.Db[1][0] * kappa[0] + pe.Db[1][1] * kappa[1];
      const Mxy = pe.Db[2][2] * kappa[2];
      const Vx  = pe.Ds[0][0] * gam[0];
      const Vy  = pe.Ds[1][1] * gam[1];
      out.push({ r: g.r, s: g.s, Mx, My, Mxy, Vx, Vy });
    }
    return out; // order matches GP double loop: (r-,s-),(r-,s+),(r+,s-),(r+,s+)
  }

  // Extrapolate 2x2 gauss values to the 4 corner nodes (standard √3 factors)
  function gaussToNodes(gpVals /*4 gp in loop order*/, key) {
    // gp loop order: g0=(-a,-a), g1=(-a,+a), g2=(+a,-a), g3=(+a,+a), a=1/√3
    // node i at (ri,si): value = Σ Ng(gp evaluated at r=ri√3, s=si√3)
    const a = Math.sqrt(3);
    const res = [];
    for (let i = 0; i < 4; i++) {
      const r = RI[i] * a, s = SI[i] * a;
      const N = [
        0.25 * (1 - r) * (1 - s),  // gp (-,-)
        0.25 * (1 - r) * (1 + s),  // gp (-,+)
        0.25 * (1 + r) * (1 - s),  // gp (+,-)
        0.25 * (1 + r) * (1 + s)   // gp (+,+)
      ];
      let v = 0;
      for (let g = 0; g < 4; g++) v += N[g] * gpVals[g][key];
      res.push(v);
    }
    return res;
  }

  return {
    beamElement, beamForces, beamLocalFeq, condenseFeq, recoverReleasedU,
    plateElement, plateGlobalK, plateStresses, gaussToNodes, Tp3
  };
})();
