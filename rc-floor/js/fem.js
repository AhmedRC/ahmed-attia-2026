/* =========================================================================
 * RC-Floor-FEA — fem.js
 * Skyline (active-column) LDLᵀ direct solver — a JavaScript port of the
 * COLSOL algorithm in K.J. Bathe, "Finite Element Procedures", §8.2.3.
 *
 * Storage: for equation j (0-based), column entries K(i,j), i ≤ j are kept
 * from the diagonal upward:  A[maxa[j] + (j - i)] = K(i,j).
 * maxa[j] = address of the diagonal of column j;  maxa[neq] = total length.
 * ========================================================================= */
"use strict";

const FEM = (() => {

  // ---------- Skyline system ----------
  function Skyline(neq) {
    this.neq = neq;
    this.colTop = new Int32Array(neq);      // smallest row index coupled to eq j
    for (let i = 0; i < neq; i++) this.colTop[i] = i;
    this.maxa = null;
    this.A = null;
  }

  // register element connectivity (array of equation numbers, -1 = restrained)
  Skyline.prototype.connect = function (lm) {
    let mn = this.neq;
    for (const e of lm) if (e >= 0 && e < mn) mn = e;
    if (mn === this.neq) return;
    for (const e of lm)
      if (e >= 0 && mn < this.colTop[e]) this.colTop[e] = mn;
  };

  Skyline.prototype.allocate = function () {
    const n = this.neq;
    this.maxa = new Int32Array(n + 1);
    let addr = 0;
    for (let j = 0; j < n; j++) {
      this.maxa[j] = addr;
      addr += (j - this.colTop[j]) + 1;      // column height incl. diagonal
    }
    this.maxa[n] = addr;
    this.A = new Float64Array(addr);
  };

  // add k(i,j) (i,j equation numbers, i<=j not required — symmetric add once)
  Skyline.prototype.add = function (i, j, v) {
    if (i > j) { const t = i; i = j; j = t; }
    this.A[this.maxa[j] + (j - i)] += v;
  };

  // assemble a full element matrix ke (n x n) with location map lm
  Skyline.prototype.assemble = function (ke, lm) {
    const n = lm.length;
    for (let a = 0; a < n; a++) {
      const i = lm[a]; if (i < 0) continue;
      for (let b = a; b < n; b++) {
        const j = lm[b]; if (j < 0) continue;
        this.add(i, j, ke[a][b]);
      }
    }
  };

  // ---------- LDLᵀ factorization (in place) ----------
  Skyline.prototype.factorize = function () {
    const { A, maxa, neq } = this;
    for (let j = 0; j < neq; j++) {
      const kj = maxa[j];
      const mj = j - (maxa[j + 1] - kj - 1);      // top row of column j
      // 1) reduce off-diagonal entries: u(i,j), i = mj..j-1
      for (let i = mj; i <= j - 1; i++) {
        const ki = maxa[i];
        const mi = i - (maxa[i + 1] - ki - 1);
        const mm = Math.max(mi, mj);
        let s = 0;
        for (let r = mm; r <= i - 1; r++) {
          // L(r,i) is stored (already reduced & divided), u(r,j) currently in A
          s += A[ki + (i - r)] * A[kj + (j - r)];
        }
        A[kj + (j - i)] -= s;
      }
      // 2) divide by D and accumulate diagonal
      let d = A[kj];
      for (let i = mj; i <= j - 1; i++) {
        const u = A[kj + (j - i)];
        const Di = A[maxa[i]];
        const l = u / Di;
        d -= l * u;
        A[kj + (j - i)] = l;                       // store L(i,j)
      }
      if (Math.abs(d) < 1e-30)
        throw new Error(`Singular/ill-conditioned stiffness matrix at equation ${j}. ` +
          `Check supports and element connectivity.`);
      A[kj] = d;
    }
    return this;
  };

  // ---------- solve (after factorize); rhs modified in place, returned ----
  Skyline.prototype.solve = function (rhs) {
    const { A, maxa, neq } = this;
    const v = rhs;
    // forward:  L v = f
    for (let j = 0; j < neq; j++) {
      const kj = maxa[j];
      const mj = j - (maxa[j + 1] - kj - 1);
      let s = 0;
      for (let r = mj; r <= j - 1; r++) s += A[kj + (j - r)] * v[r];
      v[j] -= s;
    }
    // diagonal
    for (let j = 0; j < neq; j++) v[j] /= A[maxa[j]];
    // backward: Lᵀ x = v
    for (let j = neq - 1; j >= 0; j--) {
      const kj = maxa[j];
      const mj = j - (maxa[j + 1] - kj - 1);
      const xj = v[j];
      for (let r = mj; r <= j - 1; r++) v[r] -= A[kj + (j - r)] * xj;
    }
    return v;
  };

  // ---------- small dense helpers ----------
  const M = {
    zeros: (r, c) => Array.from({ length: r }, () => new Float64Array(c)),
    // C = Aᵀ B A  (A: n×m, B: n×n) -> m×m
    tBA(Amat, B) {
      const n = Amat.length, m = Amat[0].length;
      const BA = M.zeros(n, m);
      for (let i = 0; i < n; i++)
        for (let k = 0; k < n; k++) {
          const b = B[i][k];
          if (b === 0) continue;
          for (let j = 0; j < m; j++) BA[i][j] += b * Amat[k][j];
        }
      const C = M.zeros(m, m);
      for (let i = 0; i < m; i++)
        for (let k = 0; k < n; k++) {
          const a = Amat[k][i];
          if (a === 0) continue;
          for (let j = 0; j < m; j++) C[i][j] += a * BA[k][j];
        }
      return C;
    },
    // y = A x
    mulVec(Amat, x) {
      const y = new Float64Array(Amat.length);
      for (let i = 0; i < Amat.length; i++) {
        let s = 0;
        for (let j = 0; j < x.length; j++) s += Amat[i][j] * x[j];
        y[i] = s;
      }
      return y;
    },
    addInPlace(Amat, Bmat, f = 1) {
      for (let i = 0; i < Amat.length; i++)
        for (let j = 0; j < Amat[i].length; j++) Amat[i][j] += f * Bmat[i][j];
    },
    transpose(Amat) {
      const r = Amat.length, c = Amat[0].length, T = M.zeros(c, r);
      for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = Amat[i][j];
      return T;
    }
  };

  return { Skyline, M };
})();
