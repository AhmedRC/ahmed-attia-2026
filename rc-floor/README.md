# RC-Floor-FEA v1.0

Finite element analysis and ACI 318-19 design of 2D reinforced concrete floor
systems — slab-beam floors, flat slabs, hollow-block (ribbed) slabs, and
combined systems — in a SAP2000-like plan-based workflow, running entirely in
your browser.

## Running the application

No installation required. Open **`index.html`** in Chrome, Edge or Firefox
(double-click the file, or for full PDF-underlay support serve it locally:
`python3 -m http.server` in this folder, then open http://localhost:8000).

## Quick start (2 minutes)

1. Click **Example** in the top bar — a 12×12 m combined floor loads
   (slab-beam bays + ribbed panel + flat slab with an opening).
2. Press **1 Mesh** — the FE mesh is generated (max element size adjustable
   in the right panel).
3. Press **2 Analyze** — cases D and L are solved and combined
   (1.4D, 1.2D+1.6L, D+L).
4. Browse results with the two dropdowns: deflection, slab moment contours
   Mx/My/Mxy, shear, beam BMD/SFD/torsion, reactions.
5. Press **3 Design** — ACI 318-19 design of beams, slabs, punching and columns.
6. Press **4 Report** — printable calculation notebook (browser Print → PDF).

## Modeling your own floor

- **Underlay…** imports an architectural plan: PDF (first page), PNG/JPG, or
  DXF (LINE/LWPOLYLINE/CIRCLE). Click **Scale**, pick two points with a known
  distance, and enter it to calibrate.
- Draw with the left palette: **Column** (support), **Beam** (2 clicks),
  **Slab** (rectangle, 2 clicks), **Poly slab** (double-click to close),
  **Opening**, **Pt load**.
- Select any object to edit its section, material, support type and loads in
  the right panel. Slab self-weight is automatic (dead case); assign
  superimposed dead and live area/line loads explicitly.
- Slab types: **solid** (with beams), **flat** (punching checked at columns),
  **ribbed** (hollow-block: define topping, rib width/spacing — orthotropic
  equivalent rigidities and true self-weight are computed).
- Keyboard: `F` zoom fit, `Esc` cancel/select, `Del` delete, mouse wheel zoom,
  right/middle-drag pan.

## Units & conventions

kN, m, mm, MPa, kN/m², kN·m. Loads are entered **positive downward**.
Deflections are reported positive downward. Slab/beam moments positive =
**sagging** (tension bottom). Reactions positive upward.

## Project structure

```
index.html          UI shell            js/solver.js      assembly + cases/combos
css/style.css       styling             js/design.js      ACI 318-19 design
js/core.js          units/materials     js/report.js      calculation notebook
js/model.js         data model          js/underlay.js    PDF/DXF/image import
js/mesher.js        mesh generation     js/ui-*.js        canvas, tools, panels, results
js/fem.js           skyline LDLᵀ solver js/example.js     demo model
js/elements.js      MITC4 plate + grillage beam           tests/benchmarks.js  verification
```

## Verification

`node tests/benchmarks.js` runs 16 checks against analytical solutions:
skyline solver, simply-supported/fixed beams (exact), Timoshenko plate
coefficients for the MITC4 element (≤0.3% error), and a full-pipeline
flat-slab model (equilibrium to machine precision, symmetry).

## Theory

Plate-grillage model, 3 DOF/node (w, θx, θy): MITC4 Mindlin plate elements
(Bathe & Dvorkin) + Euler/St-Venant grillage beams, skyline LDLᵀ (Bathe COLSOL),
Wood–Armer slab design moments. Full details, assumptions and v1 limitations:
**TECHNICAL_PLAN.md**.

> ⚠ Engineering software disclaimer: results must be independently verified by
> a licensed structural engineer. Version 1 is linear-elastic, gravity-only —
> see TECHNICAL_PLAN.md §8 for limitations.
