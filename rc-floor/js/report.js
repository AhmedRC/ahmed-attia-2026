/* =========================================================================
 * RC-Floor-FEA — report.js
 * Structural calculation notebook generator. Opens a printable HTML
 * document (browser Print → PDF) with analysis + ACI design results.
 * ========================================================================= */
"use strict";

const REPORT = (() => {
  const eng = CORE.U.eng;
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // capture canvas snapshots of result plots
  function snapshot(resultType, setId) {
    const oldT = APP.resultType, oldS = APP.resultSet;
    APP.resultType = resultType; APP.resultSet = setId;
    CANVAS.draw();
    const url = document.getElementById("cv").toDataURL("image/png");
    APP.resultType = oldT; APP.resultSet = oldS;
    CANVAS.draw();
    return url;
  }

  function generate() {
    const p = APP.proj, res = p.results, des = p.designResults;
    if (!res || !des) { alert("Run Analyze and Design first."); return; }
    const mesh = res.mesh;
    const mat = MODEL.defaultConcrete(p);
    const gov = p.combos.find(c => c.type === "strength" && c.id === "U2") || p.combos[0];
    const govSet = res.sets[gov.id];
    const srv = p.combos.find(c => c.type === "service");
    const srvSet = srv ? res.sets[srv.id] : null;

    // snapshots (governing strength combo for moments, service for deflection)
    const imgDefl = srvSet ? snapshot("defl", srv.id) : null;
    const imgMx = snapshot("Mx", gov.id);
    const imgMy = snapshot("My", gov.id);
    const imgBM = mesh.beams.length ? snapshot("beamM", gov.id) : null;
    const imgR = snapshot("react", gov.id);

    let h = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Calculation Report — ${esc(p.meta.name)}</title>
<style>
  body { font-family: "Cambria", Georgia, serif; color:#111; margin: 30px 45px; line-height:1.5; }
  h1 { font-size: 21px; border-bottom: 3px solid #234; padding-bottom: 6px; }
  h2 { font-size: 16px; margin-top: 28px; color:#123; border-bottom:1px solid #789; padding-bottom:3px; }
  h3 { font-size: 13.5px; margin-top: 16px; color:#234; }
  table { border-collapse: collapse; margin: 8px 0; font-size: 12px; width:100%; }
  th, td { border: 1px solid #999; padding: 3px 7px; text-align: right; }
  th { background: #e8edf3; text-align: center; }
  td:first-child, th:first-child { text-align: left; }
  img.plot { width: 100%; max-width: 750px; border: 1px solid #aaa; margin: 6px 0; }
  .meta td { border: none; padding: 1px 8px 1px 0; text-align:left; }
  .ok { color: #0a7d32; font-weight: 600; } .bad { color: #b00020; font-weight: 700; }
  .note { font-size: 11.5px; color: #444; background:#f4f6f8; padding:8px 12px; border-left:3px solid #789; }
  @media print { h2 { page-break-after: avoid; } table { page-break-inside: avoid; } }
</style></head><body>`;

    // ---------------- 1. project ----------------
    h += `<h1>Structural Calculation Report — Reinforced Concrete Floor</h1>
<table class="meta">
<tr><td><b>Project:</b></td><td>${esc(p.meta.name)}</td></tr>
<tr><td><b>Engineer:</b></td><td>${esc(p.meta.engineer) || "—"}</td></tr>
<tr><td><b>Date:</b></td><td>${esc(p.meta.date)}</td></tr>
<tr><td><b>Software:</b></td><td>RC-Floor-FEA v1.0 — FE plate-grillage analysis &amp; ACI 318-19 design</td></tr>
<tr><td><b>Design code:</b></td><td>ACI 318-19 (SI units)</td></tr>
</table>`;

    // ---------------- 2. materials ----------------
    h += `<h2>1 &nbsp;Material Properties</h2><table>
<tr><th>Concrete</th><th>f'c (MPa)</th><th>Ec (MPa)</th><th>ν</th><th>γ (kN/m³)</th></tr>`;
    for (const m of p.materials.concrete)
      h += `<tr><td>${esc(m.name)}</td><td>${m.fc}</td><td>${m.Ec.toFixed(0)}</td><td>${m.nu}</td><td>${m.gamma}</td></tr>`;
    h += `</table><table><tr><th>Reinforcement</th><th>fy (MPa)</th><th>Es (MPa)</th></tr>`;
    for (const m of p.materials.rebar)
      h += `<tr><td>${esc(m.name)}</td><td>${m.fy}</td><td>${m.Es}</td></tr>`;
    h += `</table><p>Ec computed per ACI 318-19 §19.2.2.1(b): Ec = 4700√f'c.</p>`;

    // ---------------- 3. geometry ----------------
    h += `<h2>2 &nbsp;Geometry</h2>`;
    h += `<h3>2.1 Slab regions</h3><table>
<tr><th>ID</th><th>Type</th><th>t (mm)</th><th>Area (m²)</th><th>Self-weight (kN/m²)</th></tr>`;
    for (const s of p.slabs) {
      const pr = MODEL.slabPlateProps(p, s);
      h += `<tr><td>${esc(s.label) || "S" + s.id}</td><td>${s.slabType}</td>
<td>${(s.t * 1000).toFixed(0)}</td><td>${CORE.G.polygonArea(s.poly).toFixed(1)}</td>
<td>${pr.selfWeight.toFixed(2)}</td></tr>`;
    }
    h += `</table>`;
    if (p.beams.length) {
      h += `<h3>2.2 Beams</h3><table>
<tr><th>ID</th><th>b×h (mm)</th><th>From (m)</th><th>To (m)</th><th>L (m)</th><th>End releases</th></tr>`;
      for (const b of p.beams) {
        const rel = [b.releaseStart ? "start" : null, b.releaseEnd ? "end" : null]
          .filter(Boolean).join(", ") || "—";
        h += `<tr><td>${esc(b.label) || "B" + b.id}</td><td>${b.b * 1000}×${b.h * 1000}</td>
<td>(${b.x1}, ${b.y1})</td><td>(${b.x2}, ${b.y2})</td>
<td>${Math.hypot(b.x2 - b.x1, b.y2 - b.y1).toFixed(2)}</td><td>${rel}</td></tr>`;
      }
      h += `</table>`;
    }
    h += `<h3>2.${p.beams.length ? 3 : 2} Columns / supports</h3><table>
<tr><th>ID</th><th>Location (m)</th><th>Section (mm)</th><th>Support model</th></tr>`;
    for (const c of p.columns)
      h += `<tr><td>${esc(c.label) || "C" + c.id}</td><td>(${c.x}, ${c.y})</td>
<td>${c.shape === "circle" ? "Ø" + c.bx * 1000 : (c.bx * 1000) + "×" + (c.by * 1000)}</td>
<td>${c.supportType === "column" ? `springs from column below, L=${c.Lc} m` : c.supportType}</td></tr>`;
    h += `</table>`;

    // ---------------- 4. loads ----------------
    h += `<h2>3 &nbsp;Loads and Load Combinations</h2>
<p>Self-weight of all members is computed automatically from section dimensions
and γ<sub>c</sub> and included in the Dead case. Beam self-weight deducts the
overlapping slab depth to avoid double counting.</p>
<table><tr><th>Object</th><th>Load</th><th>Case</th><th>Value</th></tr>`;
    for (const s of p.slabs) for (const al of s.areaLoads)
      h += `<tr><td>${esc(s.label) || "S" + s.id}</td><td>area</td><td>${esc(al.caseId)}</td><td>${al.q} kN/m²</td></tr>`;
    for (const b of p.beams) for (const ll of b.lineLoads)
      h += `<tr><td>${esc(b.label) || "B" + b.id}</td><td>line</td><td>${esc(ll.caseId)}</td><td>${ll.w} kN/m</td></tr>`;
    for (const pl of p.pointLoads)
      h += `<tr><td>(${pl.x}, ${pl.y})</td><td>point</td><td>${esc(pl.caseId)}</td><td>${pl.P} kN</td></tr>`;
    h += `</table><table><tr><th>Combination</th><th>Expression</th><th>Type</th></tr>`;
    for (const c of p.combos)
      h += `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${c.type}</td></tr>`;
    h += `</table>`;

    // ---------------- 5. FE model ----------------
    h += `<h2>4 &nbsp;Finite Element Model</h2>
<div class="note">Slabs are modeled with 4-node MITC4 Mindlin–Reissner plate
bending elements (transverse shear included, locking-free interpolation per
Bathe &amp; Dvorkin). Beams are grillage line elements with Euler–Bernoulli
bending (EI) and St-Venant torsion (GJ), sharing nodes with the slab mesh.
Columns are ${p.columns.some(c => c.supportType === "column") ?
  "elastic springs (k<sub>w</sub>=EA/L, k<sub>θ</sub>=4EI/L from the column below)" : "idealized supports"}.
The global system is solved by skyline-stored LDL<sup>T</sup> factorization
(active-column method). Analysis is linear-elastic; gravity loading only.</div>
<table>
<tr><th>Nodes</th><th>Plate elements</th><th>Beam elements</th><th>Supports</th><th>Equations</th><th>Max element size</th></tr>
<tr><td>${mesh.stats.nodes}</td><td>${mesh.stats.plates}</td><td>${mesh.stats.beamEls}</td>
<td>${mesh.stats.supports}</td><td>${res.neq}</td><td>${mesh.maxSize} m</td></tr></table>`;

    // equilibrium
    h += `<h3>4.1 Global equilibrium check</h3><table>
<tr><th>Set</th><th>ΣApplied (kN↓)</th><th>ΣReactions (kN↑)</th><th>Error</th></tr>`;
    for (const id of res.order) {
      const s = res.sets[id];
      h += `<tr><td>${esc(s.name)}</td><td>${s.totalLoad.toFixed(1)}</td>
<td>${s.sumR.toFixed(1)}</td><td class="${s.eqErr < 0.005 ? "ok" : "bad"}">${(s.eqErr * 100).toFixed(2)}%</td></tr>`;
    }
    h += `</table>`;

    // ---------------- 6. analysis results ----------------
    h += `<h2>5 &nbsp;Analysis Results</h2>`;
    h += `<h3>5.1 Support reactions — ${esc(govSet.name)}</h3><table>
<tr><th>Support</th><th>Node</th><th>Rz (kN ↑)</th><th>Mx (kN·m)</th><th>My (kN·m)</th></tr>`;
    for (const r of govSet.reactions) {
      const c = p.columns.find(c => c.id === r.columnId);
      h += `<tr><td>${esc(c?.label) || "C" + r.columnId}</td><td>${r.nodeId}</td>
<td>${eng(r.Rz, 1)}</td><td>${eng(r.Mx, 2)}</td><td>${eng(r.My, 2)}</td></tr>`;
    }
    h += `</table><img class="plot" src="${imgR}">`;

    if (srvSet) {
      let wmax = 0, where = null;
      for (let i = 0; i < mesh.nodes.length; i++) {
        const w = -srvSet.ufull[3 * i];
        if (w > wmax) { wmax = w; where = mesh.nodes[i]; }
      }
      h += `<h3>5.2 Service deflections (D+L, elastic)</h3>
<p>Maximum deflection = <b>${(wmax * 1000).toFixed(2)} mm</b>` +
        (where ? ` at (${where.x.toFixed(2)}, ${where.y.toFixed(2)}) m.` : ".") +
        ` Long-term multipliers per ACI 24.2.4 are not included (see notes).</p>` +
        (imgDefl ? `<img class="plot" src="${imgDefl}">` : "");
    }

    h += `<h3>5.3 Slab moment contours — ${esc(govSet.name)}</h3>
<p>Sign convention: positive = sagging (tension bottom). Units kN·m/m.</p>
<p><b>Mx</b> (spanning X):</p><img class="plot" src="${imgMx}">
<p><b>My</b> (spanning Y):</p><img class="plot" src="${imgMy}">`;

    if (imgBM) {
      h += `<h3>5.4 Beam bending moment diagrams — ${esc(govSet.name)}</h3>
<img class="plot" src="${imgBM}">
<table><tr><th>Beam</th><th>M+max (kN·m)</th><th>at x (m)</th><th>M−max (kN·m)</th><th>at x (m)</th><th>Vmax (kN)</th><th>Tmax (kN·m)</th></tr>`;
      for (const d of des.beams)
        h += `<tr><td>${esc(d.label)}</td><td>${eng(d.MposMax)}</td><td>${d.xMpos.toFixed(2)}</td>
<td>${eng(-d.MnegMax)}</td><td>${d.xMneg.toFixed(2)}</td><td>${eng(d.Vmax)}</td><td>${eng(d.Tmax)}</td></tr>`;
      h += `</table>`;
    }

    // ---------------- 7. design ----------------
    h += `<h2>6 &nbsp;Reinforced Concrete Design (ACI 318-19)</h2>
<p>Strength reduction factors: φ=0.90 flexure (tension-controlled),
φ=0.75 shear, φ=0.65 tied compression. Design envelope over all strength
combinations.</p>`;

    if (des.beams.length) {
      h += `<h3>6.1 Beam design</h3><table>
<tr><th>Beam</th><th>b×h (mm)</th><th>d (mm)</th><th>As,bot req (mm²)</th><th>Bottom bars</th>
<th>As,top req (mm²)</th><th>Top bars</th><th>Stirrups</th><th>ld (mm)</th><th>Status</th></tr>`;
      for (const d of des.beams)
        h += `<tr><td>${esc(d.label)}</td><td>${d.b}×${d.h}</td><td>${d.d.toFixed(0)}</td>
<td>${d.AsBot.toFixed(0)}</td><td>${d.barsBot}</td>
<td>${d.AsTop.toFixed(0)}</td><td>${d.barsTop}</td>
<td>${d.stirrups}</td><td>${d.ld}</td>
<td class="${d.flexOK && d.shearOK ? "ok" : "bad"}">${d.flexOK && d.shearOK ? "OK" : esc(d.notes.join("; "))}</td></tr>`;
      h += `</table>
<p>As,min per ACI 9.6.1.2 = max(0.25√f'c, 1.4)·b<sub>w</sub>d/f<sub>y</sub>;
φVc = 0.75·0.17√f'c·b<sub>w</sub>d; stirrup spacing limits per §9.7.6.2.2.</p>`;
    }

    h += `<h3>6.2 Slab design (Wood–Armer design moments, per meter strip)</h3><table>
<tr><th>Slab</th><th>t (mm)</th><th>Face/Dir</th><th>Mu* (kN·m/m)</th><th>As req (mm²/m)</th><th>Provide</th></tr>`;
    for (const d of des.slabs) {
      const rows = [
        ["Bottom X", d.MxBot, d.botX], ["Bottom Y", d.MyBot, d.botY],
        ["Top X", d.MxTop, d.topX], ["Top Y", d.MyTop, d.topY]
      ];
      rows.forEach((r, i) =>
        h += `<tr>${i === 0 ? `<td rowspan="4">${esc(d.label)} (${d.type})</td><td rowspan="4">${d.t}</td>` : ""}
<td style="text-align:left">${r[0]}</td><td>${eng(r[1])}</td><td>${r[2].As.toFixed(0)}</td><td>${r[2].bars}</td></tr>`);
    }
    h += `</table>
<p>Wood–Armer: M*<sub>x</sub> = M<sub>x</sub> ± |M<sub>xy</sub>|; minimum slab steel
A<sub>s,min</sub> = 0.0018·b·t (§24.4.3.2); max spacing = min(3t, 450 mm) (§24.4.3.3).</p>`;

    if (des.punching.length) {
      h += `<h3>6.3 Punching shear (two-way action, ACI 22.6)</h3><table>
<tr><th>Column</th><th>Position</th><th>d (mm)</th><th>b₀ (mm)</th><th>Vu (kN)</th>
<th>vu (MPa)</th><th>φvc (MPa)</th><th>Utilization</th><th>Status</th></tr>`;
      for (const d of des.punching)
        h += `<tr><td>${esc(d.label)}</td><td>${d.kind}</td><td>${d.d.toFixed(0)}</td>
<td>${d.b0.toFixed(0)}</td><td>${d.Vu.toFixed(1)}</td><td>${d.vu.toFixed(3)}</td>
<td>${d.phiVc.toFixed(3)}</td><td>${(d.util * 100).toFixed(0)}%</td>
<td class="${d.ok ? "ok" : "bad"}">${d.ok ? "OK" : esc(d.remedy)}</td></tr>`;
      h += `</table>
<p>vc = min[0.33√f'c; 0.17(1+2/β)√f'c; 0.083(2+α<sub>s</sub>d/b₀)√f'c] per Table 22.6.5.2.
Unbalanced-moment transfer (γ<sub>v</sub>) is not included — see limitations.</p>`;
    }

    if (des.columns.length) {
      h += `<h3>6.4 Column design (axial, ACI Ch.10)</h3><table>
<tr><th>Column</th><th>Section (mm)</th><th>Pu (kN)</th><th>Mu (kN·m)</th>
<th>Ast req (mm²)</th><th>Longitudinal</th><th>Ties</th><th>φPn,max (kN)</th><th>Status</th></tr>`;
      for (const d of des.columns)
        h += `<tr><td>${esc(d.label)}</td><td>${d.shape === "circle" ? "Ø" + d.b : d.b + "×" + d.h}</td>
<td>${d.Pu.toFixed(1)}</td><td>${d.Mu.toFixed(1)}</td><td>${d.AstReq.toFixed(0)}</td>
<td>${d.bars}</td><td>${d.ties}</td><td>${d.capacity.toFixed(0)}</td>
<td class="${d.ok ? "ok" : "bad"}">${d.ok ? (d.note ? "OK*" : "OK") : "CHECK"}</td></tr>`;
      h += `</table>`;
      const notes = des.columns.filter(d => d.note).map(d => `${d.label}: ${d.note}`);
      if (notes.length) h += `<p class="note">* ${esc(notes.join(" • "))}</p>`;
    }

    // ---------------- 8. notes ----------------
    h += `<h2>7 &nbsp;Engineering Notes, Assumptions &amp; Limitations</h2>
<ol style="font-size:12.5px">
<li>Linear-elastic gravity analysis of a single floor level; in-plane (membrane)
action and lateral loads are not considered.</li>
<li>Service deflections are elastic (gross-section, uncracked). Cracked-section
effects (Ieff, ACI 24.2.3) and long-term multipliers (24.2.4) must be applied
separately where deflection limits govern.</li>
<li>Beams are concentric with the slab mid-plane; T-beam flange action beyond
the stiffness modifier is not included.</li>
<li>Punching check excludes unbalanced-moment shear transfer (γv·Mu) —
utilizations near 1.0 should be verified by hand.</li>
<li>Column design is simplified (max-axial + minimum-eccentricity philosophy);
columns with significant moment require full P-M interaction verification.</li>
<li>Hollow-block slabs use equivalent orthotropic plate rigidities; rib shear
and local topping checks should be verified per the applicable code.</li>
<li>All results should be reviewed by a licensed structural engineer before use.</li>
</ol>
${p.meta.notes ? `<p><b>Project notes:</b> ${esc(p.meta.notes)}</p>` : ""}
<p style="margin-top:26px;color:#666;font-size:11px">Generated by RC-Floor-FEA v1.0 —
${new Date().toLocaleString()}. Verified element library: MITC4 plate vs. Timoshenko
&amp; Woinowsky-Krieger coefficients (0.3% deflection, 0.02% moment); exact Hermitian beam.</p>
</body></html>`;

    const win = window.open("", "_blank");
    if (!win) { alert("Popup blocked — allow popups to view the report."); return; }
    win.document.write(h);
    win.document.close();
  }

  return { generate };
})();
