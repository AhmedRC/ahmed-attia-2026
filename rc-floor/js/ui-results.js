/* =========================================================================
 * RC-Floor-FEA — ui-results.js
 * Post-processing views: slab contour maps, deflection, beam BMD/SFD/torsion
 * diagrams, support reactions. SAP2000-style presentation.
 * ========================================================================= */
"use strict";

const RESULTS = (() => {

  // 12-step engineering rainbow (blue = min … red = max)
  const RAMP = ["#2c2c9e", "#2450c8", "#1e7ee0", "#2fa8e0", "#4ec9c3", "#7fdc9a",
                "#b6e878", "#e6e25c", "#f7c04a", "#f5923b", "#e85e30", "#d32f2f"];
  const rampColor = (t) => RAMP[Math.max(0, Math.min(RAMP.length - 1,
    Math.floor(t * RAMP.length)))];

  function currentSet() {
    const r = APP.proj.results;
    if (!r) return null;
    return r.sets[APP.resultSet] || r.sets[r.order[0]];
  }

  // nodal scalar for contour plots
  function nodalValues(set, type) {
    const mesh = APP.proj.results.mesh;
    const vals = new Array(mesh.nodes.length).fill(null);
    for (let i = 0; i < mesh.nodes.length; i++) {
      if (type === "defl") vals[i] = -set.ufull[3 * i] * 1000;      // mm, +down
      else if (set.plateNodal[i]) vals[i] = set.plateNodal[i][type];
    }
    return vals;
  }

  function draw(ctx, vp) {
    const set = currentSet();
    if (!set) return;
    const type = APP.resultType;
    if (["defl", "Mx", "My", "Mxy", "Vx", "Vy"].includes(type))
      drawContours(ctx, vp, set, type);
    else if (["beamM", "beamV", "beamT"].includes(type))
      drawBeamDiagrams(ctx, vp, set, type);
    else if (type === "react")
      drawReactions(ctx, vp, set);
  }

  /* ------------------- slab contours ------------------- */
  function drawContours(ctx, vp, set, type) {
    const mesh = APP.proj.results.mesh;
    const vals = nodalValues(set, type);
    let vmin = 1e30, vmax = -1e30;
    for (const v of vals) if (v !== null) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    if (vmin > vmax) { hideLegend(); return; }
    const span = (vmax - vmin) || 1;

    // draw model outline dimmed
    ctx.save();
    ctx.globalAlpha = 1;
    for (const pl of mesh.plates) {
      const vv = pl.nodes.map(n => vals[n] ?? 0);
      // subdivide quad into 4 sub-quads via edge midpoints for smoother fill
      const pts = pl.nodes.map(n => ({ x: mesh.nodes[n].x, y: mesh.nodes[n].y }));
      fillQuadInterp(ctx, vp, pts, vv, vmin, span);
    }
    // element edges (faint)
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 0.5;
    for (const pl of mesh.plates) {
      ctx.beginPath();
      pl.nodes.forEach((n, i) => {
        const q = vp.w2s(mesh.nodes[n].x, mesh.nodes[n].y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath(); ctx.stroke();
    }
    // beams over contours
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2;
    for (const be of mesh.beams) {
      const a = vp.w2s(mesh.nodes[be.n1].x, mesh.nodes[be.n1].y);
      const b = vp.w2s(mesh.nodes[be.n2].x, mesh.nodes[be.n2].y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // min/max markers
    markExtreme(ctx, vp, mesh, vals, vmax, "max");
    markExtreme(ctx, vp, mesh, vals, vmin, "min");
    ctx.restore();

    const units = { defl: "mm", Mx: "kN·m/m", My: "kN·m/m", Mxy: "kN·m/m", Vx: "kN/m", Vy: "kN/m" };
    showLegend(`${labelOf(type)} — ${set.name}`, vmin, vmax, units[type]);
  }

  // bilinear-ish fill: split quad into 2x2 sub-quads with averaged values
  function fillQuadInterp(ctx, vp, pts, vv, vmin, span) {
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const c = { x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4,
                y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4 };
    const vc = (vv[0] + vv[1] + vv[2] + vv[3]) / 4;
    const e = [mid(pts[0], pts[1]), mid(pts[1], pts[2]), mid(pts[2], pts[3]), mid(pts[3], pts[0])];
    const ev = [(vv[0] + vv[1]) / 2, (vv[1] + vv[2]) / 2, (vv[2] + vv[3]) / 2, (vv[3] + vv[0]) / 2];
    const sub = [
      [pts[0], e[0], c, e[3], (vv[0] + ev[0] + vc + ev[3]) / 4],
      [e[0], pts[1], e[1], c, (ev[0] + vv[1] + ev[1] + vc) / 4],
      [c, e[1], pts[2], e[2], (vc + ev[1] + vv[2] + ev[2]) / 4],
      [e[3], c, e[2], pts[3], (ev[3] + vc + ev[2] + vv[3]) / 4]
    ];
    for (const s of sub) {
      ctx.fillStyle = rampColor((s[4] - vmin) / span);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const q = vp.w2s(s[i].x, s[i].y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.closePath(); ctx.fill();
    }
  }

  function markExtreme(ctx, vp, mesh, vals, v, tag) {
    const i = vals.findIndex(x => x === v);
    if (i < 0) return;
    const q = vp.w2s(mesh.nodes[i].x, mesh.nodes[i].y);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
    ctx.font = "bold 11px Consolas";
    const txt = `${tag} ${CORE.U.eng(v)}`;
    ctx.strokeText(txt, q.x + 6, q.y - 6);
    ctx.fillText(txt, q.x + 6, q.y - 6);
    ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, 7); ctx.fill();
  }

  /* ------------------- beam diagrams ------------------- */
  function drawBeamDiagrams(ctx, vp, set, type) {
    const mesh = APP.proj.results.mesh;
    const key = type === "beamM" ? "M" : type === "beamV" ? "V" : "T";
    // scale: max |value| → 40 px
    let vmax = 0;
    for (const br of set.beamRes)
      for (const st of br.sta) vmax = Math.max(vmax, Math.abs(st[key]));
    if (vmax < 1e-9) { hideLegend(); drawModelGhost(ctx, vp, mesh); return; }
    const pxScale = 42 / vmax;

    drawModelGhost(ctx, vp, mesh);
    ctx.save();
    for (const br of set.beamRes) {
      const n1 = mesh.nodes[br.be.n1], n2 = mesh.nodes[br.be.n2];
      const L = Math.hypot(n2.x - n1.x, n2.y - n1.y);
      const ux = (n2.x - n1.x) / L, uy = (n2.y - n1.y) / L;
      const nx = -uy, ny = ux;                       // plan normal
      // sign convention: sagging M drawn on +normal side flipped (tension side)
      ctx.beginPath();
      const a0 = vp.w2s(n1.x, n1.y);
      ctx.moveTo(a0.x, a0.y);
      for (const st of br.sta) {
        const off = (type === "beamM" ? -st[key] : st[key]) * pxScale / vp.view.scale;
        const wx = n1.x + ux * st.x + nx * off;
        const wy = n1.y + uy * st.x + ny * off;
        const q = vp.w2s(wx, wy);
        ctx.lineTo(q.x, q.y);
      }
      const a1 = vp.w2s(n2.x, n2.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.closePath();
      ctx.fillStyle = type === "beamM" ? "rgba(77,163,255,.35)"
                    : type === "beamV" ? "rgba(255,107,107,.35)" : "rgba(255,180,84,.35)";
      ctx.strokeStyle = type === "beamM" ? "#4da3ff" : type === "beamV" ? "#ff6b6b" : "#ffb454";
      ctx.lineWidth = 1.2;
      ctx.fill(); ctx.stroke();
    }
    // per parent beam: annotate extremes
    const byParent = {};
    for (const br of set.beamRes) {
      const arr = byParent[br.parentId] || (byParent[br.parentId] = []);
      for (const st of br.sta) arr.push({ br, st });
    }
    ctx.font = "bold 10.5px Consolas";
    for (const pid of Object.keys(byParent)) {
      const arr = byParent[pid];
      let mx = arr[0], mn = arr[0];
      for (const it of arr) {
        if (it.st[key] > mx.st[key]) mx = it;
        if (it.st[key] < mn.st[key]) mn = it;
      }
      for (const it of (mx.st[key] * mn.st[key] < 0 ? [mx, mn] :
                        [Math.abs(mx.st[key]) > Math.abs(mn.st[key]) ? mx : mn])) {
        const n1 = mesh.nodes[it.br.be.n1], n2 = mesh.nodes[it.br.be.n2];
        const L = Math.hypot(n2.x - n1.x, n2.y - n1.y);
        const t = it.st.x / L;
        const q = vp.w2s(n1.x + (n2.x - n1.x) * t, n1.y + (n2.y - n1.y) * t);
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
        const txt = CORE.U.eng(it.st[key]);
        ctx.strokeText(txt, q.x + 4, q.y - 4);
        ctx.fillText(txt, q.x + 4, q.y - 4);
      }
    }
    ctx.restore();
    const units = { beamM: "kN·m", beamV: "kN", beamT: "kN·m" };
    showLegend(`${labelOf(type)} — ${set.name}`, -vmax, vmax, units[type]);
  }

  function drawModelGhost(ctx, vp, mesh) {
    ctx.save();
    ctx.strokeStyle = "rgba(120,140,170,.35)"; ctx.lineWidth = 0.6;
    for (const pl of mesh.plates) {
      ctx.beginPath();
      pl.nodes.forEach((n, i) => {
        const q = vp.w2s(mesh.nodes[n].x, mesh.nodes[n].y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath(); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(200,215,235,.8)"; ctx.lineWidth = 2;
    for (const be of mesh.beams) {
      const a = vp.w2s(mesh.nodes[be.n1].x, mesh.nodes[be.n1].y);
      const b = vp.w2s(mesh.nodes[be.n2].x, mesh.nodes[be.n2].y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------- reactions ------------------- */
  function drawReactions(ctx, vp, set) {
    const mesh = APP.proj.results.mesh;
    drawModelGhost(ctx, vp, mesh);
    let rmax = 0;
    for (const r of set.reactions) rmax = Math.max(rmax, Math.abs(r.Rz));
    ctx.save();
    ctx.font = "bold 11px Consolas";
    for (const r of set.reactions) {
      const n = mesh.nodes[r.nodeId];
      const q = vp.w2s(n.x, n.y);
      const len = 18 + 30 * Math.abs(r.Rz) / (rmax || 1);
      ctx.strokeStyle = "#37c978"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y + len); ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x - 5, q.y + 8); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + 5, q.y + 8);
      ctx.stroke();
      ctx.fillStyle = "#b9f6ce"; ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
      const t1 = `${CORE.U.eng(r.Rz, 1)} kN`;
      ctx.strokeText(t1, q.x + 7, q.y + len - 2);
      ctx.fillText(t1, q.x + 7, q.y + len - 2);
      if (Math.abs(r.Mx) > 0.01 || Math.abs(r.My) > 0.01) {
        const t2 = `M ${CORE.U.eng(Math.hypot(r.Mx, r.My), 1)}`;
        ctx.strokeText(t2, q.x + 7, q.y + len + 11);
        ctx.fillStyle = "#ffe2a8";
        ctx.fillText(t2, q.x + 7, q.y + len + 11);
      }
    }
    ctx.restore();
    showLegend(`Reactions — ${set.name} (ΣR=${set.sumR.toFixed(1)} kN, ΣV=${set.totalLoad.toFixed(1)} kN)`,
      0, rmax, "kN");
  }

  /* ------------------- legend ------------------- */
  function showLegend(title, vmin, vmax, unit) {
    const el = document.getElementById("legend");
    if (!el) return;
    let html = `<div style="margin-bottom:5px;color:#d8dde5">${title}</div>`;
    const n = RAMP.length;
    for (let i = n - 1; i >= 0; i--) {
      const v = vmin + (vmax - vmin) * (i + 0.5) / n;
      html += `<div><span class="swatch" style="background:${RAMP[i]}"></span>${CORE.U.eng(v)} ${unit}</div>`;
    }
    el.innerHTML = html;
    el.style.display = "block";
  }
  const hideLegend = () => {
    const el = document.getElementById("legend");
    if (el) el.style.display = "none";
  };

  const labelOf = (t) => ({
    defl: "Deflection (+down)", Mx: "Slab moment Mx (sagging+)", My: "Slab moment My (sagging+)",
    Mxy: "Slab twisting Mxy", Vx: "Slab shear Vx", Vy: "Slab shear Vy",
    beamM: "Beam bending moment", beamV: "Beam shear", beamT: "Beam torsion",
    react: "Support reactions"
  }[t] || t);

  return { draw, hideLegend, labelOf, RAMP, rampColor, nodalValues, currentSet };
})();
