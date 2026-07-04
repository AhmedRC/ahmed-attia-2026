/* =========================================================================
 * RC-Floor-FEA — core.js
 * Units, material database, geometry utilities.
 * Internal units: kN, m, kPa (kN/m²), kN·m. UI converts to mm/MPa as needed.
 * ========================================================================= */
"use strict";

const CORE = (() => {

  // ---------------- Units helpers ----------------
  const U = {
    MPa2kPa: (v) => v * 1000,          // MPa -> kN/m²
    kPa2MPa: (v) => v / 1000,
    mm2m:    (v) => v / 1000,
    m2mm:    (v) => v * 1000,
    fmt: (v, d = 3) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(d),
    // Engineering formatting with automatic precision
    eng: (v, d = 2) => {
      if (!isFinite(v)) return "-";
      const a = Math.abs(v);
      if (a < 1e-10) return "0";
      if (a >= 1000) return v.toFixed(0);
      if (a >= 10) return v.toFixed(d);
      return v.toFixed(Math.min(4, d + 1));
    }
  };

  // ---------------- Material models ----------------
  // Concrete: fc' in MPa. Ec per ACI 318-19 19.2.2.1(b): Ec = 4700*sqrt(fc') MPa
  function concrete(name, fc, gamma = 25.0, nu = 0.2) {
    const Ec = 4700 * Math.sqrt(fc);              // MPa
    return {
      id: null, type: "concrete", name,
      fc,                                          // MPa
      Ec,                                          // MPa
      E: U.MPa2kPa(Ec),                            // kPa (internal)
      G: U.MPa2kPa(Ec / (2 * (1 + nu))),           // kPa
      nu, gamma                                    // kN/m³
    };
  }
  // Rebar: fy in MPa
  function rebar(name, fy, Es = 200000) {
    return { id: null, type: "rebar", name, fy, Es };
  }

  const DEFAULT_MATERIALS = {
    concrete: [
      concrete("C25 (fc'=25 MPa)", 25),
      concrete("C30 (fc'=30 MPa)", 30),
      concrete("C35 (fc'=35 MPa)", 35),
      concrete("C40 (fc'=40 MPa)", 40)
    ],
    rebar: [
      rebar("Grade 420 (fy=420 MPa)", 420),
      rebar("Grade 280 (fy=280 MPa)", 280),
      rebar("B500 (fy=500 MPa)", 500)
    ]
  };

  // Standard metric bar diameters (mm) and areas (mm²)
  const BARS = [10, 12, 14, 16, 18, 20, 22, 25, 28, 32].map(d => ({
    d, area: Math.PI * d * d / 4
  }));

  // ---------------- Geometry utilities ----------------
  const EPS = 1e-9;
  const TOL = 1e-6;      // coordinate merge tolerance (m)

  const G = {
    dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),

    // point p on segment a-b (within tol)
    onSegment(p, a, b, tol = 1e-4) {
      const L = G.dist(a, b);
      if (L < EPS) return G.dist(p, a) < tol;
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L);
      if (t < -tol / L || t > 1 + tol / L) return false;
      const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      return G.dist(p, proj) < tol;
    },

    // Ray-casting point-in-polygon; boundary counts as inside (tol)
    inPolygon(p, poly, tol = 1e-4) {
      const n = poly.length;
      for (let i = 0; i < n; i++)
        if (G.onSegment(p, poly[i], poly[(i + 1) % n], tol)) return true;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > p.y) !== (yj > p.y)) &&
            (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    },

    polygonArea(poly) {
      let s = 0;
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
      }
      return Math.abs(s) / 2;
    },

    polygonCentroid(poly) {
      let sx = 0, sy = 0, sa = 0;
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const cr = a.x * b.y - b.x * a.y;
        sa += cr; sx += (a.x + b.x) * cr; sy += (a.y + b.y) * cr;
      }
      sa *= 0.5;
      return Math.abs(sa) < EPS
        ? { x: poly[0].x, y: poly[0].y }
        : { x: sx / (6 * sa), y: sy / (6 * sa) };
    },

    // distance from point to segment
    distToSegment(p, a, b) {
      const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (L2 < EPS) return G.dist(p, a);
      let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2;
      t = Math.max(0, Math.min(1, t));
      return G.dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    },

    bbox(pts) {
      let minx = 1e30, miny = 1e30, maxx = -1e30, maxy = -1e30;
      for (const p of pts) {
        minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
        miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
      }
      return { minx, miny, maxx, maxy };
    }
  };

  // ---------------- Hollow-block (ribbed) slab equivalent plate ---------
  // Returns bending rigidity ratios and equivalent self-weight for a
  // one/two-way ribbed slab: total depth t, topping tf, rib width bw,
  // rib spacing s (c/c), two-way flag.
  function ribbedSlabProps(t, tf, bw, s, twoWay, gamma, blockWeight /*kN/m² extra*/) {
    // Moment of inertia of ribbed strip per meter width (T-section per rib)
    const nRibs = 1 / s;                     // ribs per meter
    const bf = 1.0;                          // flange width per meter strip
    const hw = t - tf;
    // T-section (per rib): flange s×tf + web bw×hw
    const Af = s * tf, Aw = bw * hw;
    const yf = t - tf / 2, yw = hw / 2;
    const A = Af + Aw;
    const ybar = (Af * yf + Aw * yw) / A;
    const I_rib = s * tf ** 3 / 12 + Af * (yf - ybar) ** 2 +
                  bw * hw ** 3 / 12 + Aw * (yw - ybar) ** 2;
    const I_perM = I_rib * nRibs;            // m⁴ per m width
    const I_solid = t ** 3 / 12;
    const ratio = Math.min(1, I_perM / I_solid);   // flexural rigidity modifier
    // Self-weight per m²: concrete volume (topping + ribs) + block weight
    const swConc = gamma * (tf + hw * bw / s);
    return {
      bendRatio: ratio,
      bendRatioY: twoWay ? ratio : 0.15 * ratio,  // one-way: weak transverse
      torsRatio: 0.35 * ratio,                    // reduced torsional rigidity
      selfWeight: swConc + (blockWeight || 0)
    };
  }

  return { U, G, concrete, rebar, DEFAULT_MATERIALS, BARS, ribbedSlabProps, TOL };
})();
