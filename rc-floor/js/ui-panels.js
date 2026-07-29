/* =========================================================================
 * RC-Floor-FEA — ui-panels.js
 * Right sidebar: property editors, load assignment, model statistics.
 * ========================================================================= */
"use strict";

const PANELS = (() => {

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function row(label, inputHtml, unit = "") {
    return `<div class="prow"><label>${label}</label>${inputHtml}` +
           (unit ? `<span class="unit">${unit}</span>` : "") + `</div>`;
  }
  const num = (id, v, step = "any") =>
    `<input type="number" id="${id}" value="${v}" step="${step}">`;
  const sel = (id, opts, cur) =>
    `<select id="${id}">` + opts.map(o =>
      `<option value="${o.v}" ${String(o.v) === String(cur) ? "selected" : ""}>${o.t}</option>`).join("") + `</select>`;

  const matOpts = () => APP.proj.materials.concrete.map(m => ({ v: m.id, t: m.name }));
  const rebOpts = () => APP.proj.materials.rebar.map(m => ({ v: m.id, t: m.name }));
  const caseOpts = () => APP.proj.loadCases.map(c => ({ v: c.id, t: c.name }));

  // ==================================================================
  function refresh() {
    renderProps();
    renderLoads();
  }

  function renderProps() {
    const box = $("tab-props");
    const sel_ = APP.selection;
    const p = APP.proj;
    let html = "";

    // ---- project group ----
    html += `<div class="pgroup"><h3>Project</h3>` +
      row("Name", `<input id="pj-name" value="${esc(p.meta.name)}">`) +
      row("Engineer", `<input id="pj-eng" value="${esc(p.meta.engineer)}">`) +
      row("Max mesh size", num("pj-mesh", p.meshSettings.maxSize, 0.05), "m") +
      `</div>`;

    if (!sel_) {
      html += `<div class="pgroup"><h3>Model summary</h3>
        <table class="mini">
        <tr><th>Item</th><th>Count</th></tr>
        <tr><td>Slab regions</td><td>${p.slabs.length}</td></tr>
        <tr><td>Beams</td><td>${p.beams.length}</td></tr>
        <tr><td>Columns / supports</td><td>${p.columns.length}</td></tr>
        <tr><td>Openings</td><td>${p.openings.length}</td></tr>
        <tr><td>Point loads</td><td>${p.pointLoads.length}</td></tr>
        </table>
        <div class="note">Select an object to edit its properties, or pick a
        drawing tool on the left. New objects use the defaults below.</div></div>`;
      html += defaultsForms();
    } else {
      html += objectForm(sel_);
    }
    box.innerHTML = html;
    bindProps();
  }

  // ---- defaults for new objects (per active tool) ----
  function defaultsForms() {
    const d = APP.defaults, t = APP.tool;
    let html = "";
    if (t === "column") {
      html += `<div class="pgroup"><h3>New column defaults</h3>` +
        row("Shape", sel("df-c-shape", [{ v: "rect", t: "Rectangular" }, { v: "circle", t: "Circular" }], d.column.shape)) +
        row("bx (X dim / Ø)", num("df-c-bx", d.column.bx, 0.05), "m") +
        row("by (Y dim)", num("df-c-by", d.column.by, 0.05), "m") +
        row("Storey height", num("df-c-lc", d.column.Lc, 0.1), "m") +
        row("Support", sel("df-c-sup", [
          { v: "roller", t: "Roller (w=0)" },
          { v: "hinged", t: "Hinged (w=0, θx=0)" },
          { v: "column", t: "Column below (springs)" },
          { v: "pinned", t: "Pinned (w=0)" },
          { v: "fixed", t: "Fixed (w=θ=0)" }], d.column.supportType)) +
        `</div>`;
    } else if (t === "beam") {
      html += `<div class="pgroup"><h3>New beam defaults</h3>` +
        row("Width b", num("df-b-b", d.beam.b, 0.05), "m") +
        row("Depth h", num("df-b-h", d.beam.h, 0.05), "m") +
        `</div>`;
    } else if (t === "slabRect" || t === "slabPoly") {
      html += `<div class="pgroup"><h3>New slab defaults</h3>` +
        row("Type", sel("df-s-type", [
          { v: "solid", t: "Solid (slab-beam)" }, { v: "flat", t: "Flat slab" },
          { v: "ribbed", t: "Hollow block / ribbed" }], d.slab.slabType)) +
        row("Thickness t", num("df-s-t", d.slab.t, 0.01), "m") +
        `</div>`;
    } else if (t === "pload") {
      html += `<div class="pgroup"><h3>New point load</h3>` +
        row("P (+down)", num("df-p-p", d.pload.P, 1), "kN") +
        row("Case", sel("df-p-case", caseOpts(), d.pload.caseId)) +
        `</div>`;
    }
    return html;
  }

  // ---- selected object form ----
  function objectForm(s) {
    const p = APP.proj;
    if (s.kind === "column") {
      const c = p.columns.find(o => o.id === s.id); if (!c) return "";
      return `<div class="pgroup"><h3>Column ${esc(c.label) || "C" + c.id}</h3>` +
        row("Label", `<input id="o-label" value="${esc(c.label)}">`) +
        row("x", num("o-x", c.x, 0.05), "m") + row("y", num("o-y", c.y, 0.05), "m") +
        row("Shape", sel("o-shape", [{ v: "rect", t: "Rectangular" }, { v: "circle", t: "Circular" }], c.shape)) +
        row("bx (X / Ø)", num("o-bx", c.bx, 0.05), "m") +
        row("by (Y)", num("o-by", c.by, 0.05), "m") +
        row("Storey height", num("o-lc", c.Lc, 0.1), "m") +
        row("Support", sel("o-sup", [
          { v: "roller", t: "Roller (w=0)" },
          { v: "hinged", t: "Hinged (w=0, θx=0)" },
          { v: "column", t: "Column below (springs)" },
          { v: "pinned", t: "Pinned (w=0)" },
          { v: "fixed", t: "Fixed (w=θ=0)" }], c.supportType)) +
        row("Concrete", sel("o-mat", matOpts(), c.matId ?? matOpts()[1]?.v)) +
        `<button class="pbtn" id="o-apply">Apply</button></div>`;
    }
    if (s.kind === "beam") {
      const b = p.beams.find(o => o.id === s.id); if (!b) return "";
      const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
      let loadsHtml = b.lineLoads.map((ll, i) =>
        `<tr><td>${esc(ll.caseId)}</td><td>${ll.w}</td>
         <td><button data-dll="${i}" style="padding:1px 7px">✕</button></td></tr>`).join("");
      return `<div class="pgroup"><h3>Beam ${esc(b.label) || "B" + b.id} (L=${L.toFixed(2)} m)</h3>` +
        row("Label", `<input id="o-label" value="${esc(b.label)}">`) +
        row("x1,y1", `<input id="o-p1" value="${b.x1}, ${b.y1}">`, "m") +
        row("x2,y2", `<input id="o-p2" value="${b.x2}, ${b.y2}">`, "m") +
        row("Width b", num("o-b", b.b, 0.05), "m") +
        row("Depth h", num("o-h", b.h, 0.05), "m") +
        row("Concrete", sel("o-mat", matOpts(), b.matId ?? matOpts()[1]?.v)) +
        row("Rebar", sel("o-reb", rebOpts(), b.rebarId ?? rebOpts()[0]?.v)) +
        row("Stiffness mod.", num("o-smod", b.stiffMod, 0.05)) +
        row("Release start", sel("o-rels", [{ v: "0", t: "No (continuous)" }, { v: "1", t: "Yes (M,T=0)" }], b.releaseStart ? "1" : "0")) +
        row("Release end", sel("o-rele", [{ v: "0", t: "No (continuous)" }, { v: "1", t: "Yes (M,T=0)" }], b.releaseEnd ? "1" : "0")) +
        `<button class="pbtn" id="o-apply">Apply</button>
        <h3 style="margin-top:10px">Line loads (kN/m, +down)</h3>
        <table class="mini"><tr><th>Case</th><th>w</th><th></th></tr>${loadsHtml}</table>` +
        row("Case", sel("o-ll-case", caseOpts(), "DL")) +
        row("w", num("o-ll-w", 10, 0.5), "kN/m") +
        `<button class="pbtn" id="o-ll-add">+ Add line load</button></div>`;
    }
    if (s.kind === "slab") {
      const sl = p.slabs.find(o => o.id === s.id); if (!sl) return "";
      const area = CORE.G.polygonArea(sl.poly);
      let loadsHtml = sl.areaLoads.map((al, i) =>
        `<tr><td>${esc(al.caseId)}</td><td>${al.q}</td>
         <td><button data-dal="${i}" style="padding:1px 7px">✕</button></td></tr>`).join("");
      let ribHtml = "";
      if (sl.slabType === "ribbed") {
        ribHtml =
          row("Topping tf", num("o-rib-tf", sl.rib.tf, 0.01), "m") +
          row("Rib width bw", num("o-rib-bw", sl.rib.bw, 0.01), "m") +
          row("Rib spacing", num("o-rib-s", sl.rib.s, 0.01), "m") +
          row("Two-way ribs", sel("o-rib-2w", [{ v: "1", t: "Yes" }, { v: "0", t: "No (one-way X)" }], sl.rib.twoWay ? "1" : "0")) +
          row("Block weight", num("o-rib-blk", sl.rib.blockWeight, 0.1), "kN/m²");
      }
      return `<div class="pgroup"><h3>Slab ${esc(sl.label) || "S" + sl.id} (A=${area.toFixed(1)} m²)</h3>` +
        row("Label", `<input id="o-label" value="${esc(sl.label)}">`) +
        row("Type", sel("o-stype", [
          { v: "solid", t: "Solid (slab-beam)" }, { v: "flat", t: "Flat slab" },
          { v: "ribbed", t: "Hollow block / ribbed" }], sl.slabType)) +
        row("Thickness t", num("o-t", sl.t, 0.01), "m") +
        row("Cover", num("o-cov", sl.cover, 0.005), "m") +
        row("Concrete", sel("o-mat", matOpts(), sl.matId ?? matOpts()[1]?.v)) +
        row("Rebar", sel("o-reb", rebOpts(), sl.rebarId ?? rebOpts()[0]?.v)) +
        ribHtml +
        `<button class="pbtn" id="o-apply">Apply</button>
        <h3 style="margin-top:10px">Area loads (kN/m², +down)</h3>
        <table class="mini"><tr><th>Case</th><th>q</th><th></th></tr>${loadsHtml}</table>` +
        row("Case", sel("o-al-case", caseOpts(), "DL")) +
        row("q", num("o-al-q", 2, 0.25), "kN/m²") +
        `<button class="pbtn" id="o-al-add">+ Add area load</button>
        <div class="note">Self-weight is added automatically to the Dead case.</div></div>`;
    }
    if (s.kind === "pload") {
      const pl = p.pointLoads.find(o => o.id === s.id); if (!pl) return "";
      return `<div class="pgroup"><h3>Point load</h3>` +
        row("x", num("o-x", pl.x, 0.05), "m") + row("y", num("o-y", pl.y, 0.05), "m") +
        row("P (+down)", num("o-P", pl.P, 1), "kN") +
        row("Case", sel("o-case", caseOpts(), pl.caseId)) +
        `<button class="pbtn" id="o-apply">Apply</button></div>`;
    }
    if (s.kind === "opening") {
      return `<div class="pgroup"><h3>Opening</h3>
        <div class="note">Rectangular opening. Delete and redraw to change.</div></div>`;
    }
    return "";
  }

  // ---- bindings ----
  function bindProps() {
    const p = APP.proj;
    const V = (id) => { const el = $(id); return el ? parseFloat(el.value) : NaN; };
    const S = (id) => { const el = $(id); return el ? el.value : null; };

    $("pj-name")?.addEventListener("change", () => { p.meta.name = S("pj-name"); });
    $("pj-eng")?.addEventListener("change", () => { p.meta.engineer = S("pj-eng"); });
    $("pj-mesh")?.addEventListener("change", () => {
      p.meshSettings.maxSize = Math.max(0.05, V("pj-mesh")); APP.invalidate();
    });

    // defaults
    const d = APP.defaults;
    $("df-c-shape")?.addEventListener("change", () => d.column.shape = S("df-c-shape"));
    $("df-c-bx")?.addEventListener("change", () => d.column.bx = V("df-c-bx"));
    $("df-c-by")?.addEventListener("change", () => d.column.by = V("df-c-by"));
    $("df-c-lc")?.addEventListener("change", () => d.column.Lc = V("df-c-lc"));
    $("df-c-sup")?.addEventListener("change", () => d.column.supportType = S("df-c-sup"));
    $("df-b-b")?.addEventListener("change", () => d.beam.b = V("df-b-b"));
    $("df-b-h")?.addEventListener("change", () => d.beam.h = V("df-b-h"));
    $("df-s-type")?.addEventListener("change", () => d.slab.slabType = S("df-s-type"));
    $("df-s-t")?.addEventListener("change", () => d.slab.t = V("df-s-t"));
    $("df-p-p")?.addEventListener("change", () => d.pload.P = V("df-p-p"));
    $("df-p-case")?.addEventListener("change", () => d.pload.caseId = S("df-p-case"));

    // apply selected object
    $("o-apply")?.addEventListener("click", () => {
      const s = APP.selection; if (!s) return;
      if (s.kind === "column") {
        const c = p.columns.find(o => o.id === s.id);
        Object.assign(c, {
          label: S("o-label"), x: V("o-x"), y: V("o-y"), shape: S("o-shape"),
          bx: V("o-bx"), by: V("o-by"), Lc: V("o-lc"),
          supportType: S("o-sup"), matId: parseInt(S("o-mat"))
        });
      } else if (s.kind === "beam") {
        const b = p.beams.find(o => o.id === s.id);
        const p1 = S("o-p1").split(",").map(Number), p2 = S("o-p2").split(",").map(Number);
        Object.assign(b, {
          label: S("o-label"), b: V("o-b"), h: V("o-h"),
          x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
          matId: parseInt(S("o-mat")), rebarId: parseInt(S("o-reb")),
          stiffMod: V("o-smod") || 1,
          releaseStart: S("o-rels") === "1", releaseEnd: S("o-rele") === "1"
        });
      } else if (s.kind === "slab") {
        const sl = p.slabs.find(o => o.id === s.id);
        Object.assign(sl, {
          label: S("o-label"), slabType: S("o-stype"), t: V("o-t"),
          cover: V("o-cov"), matId: parseInt(S("o-mat")), rebarId: parseInt(S("o-reb"))
        });
        if (sl.slabType === "ribbed" && $("o-rib-tf")) {
          sl.rib = {
            tf: V("o-rib-tf"), bw: V("o-rib-bw"), s: V("o-rib-s"),
            twoWay: S("o-rib-2w") === "1", blockWeight: V("o-rib-blk")
          };
        }
      } else if (s.kind === "pload") {
        const pl = p.pointLoads.find(o => o.id === s.id);
        Object.assign(pl, { x: V("o-x"), y: V("o-y"), P: V("o-P"), caseId: S("o-case") });
      }
      APP.invalidate(); CANVAS.draw(); refresh();
    });

    // add/remove loads
    $("o-ll-add")?.addEventListener("click", () => {
      const b = p.beams.find(o => o.id === APP.selection.id);
      b.lineLoads.push({ caseId: S("o-ll-case"), w: V("o-ll-w") });
      APP.invalidate(); refresh(); CANVAS.draw();
    });
    $("o-al-add")?.addEventListener("click", () => {
      const sl = p.slabs.find(o => o.id === APP.selection.id);
      sl.areaLoads.push({ caseId: S("o-al-case"), q: V("o-al-q") });
      APP.invalidate(); refresh(); CANVAS.draw();
    });
    document.querySelectorAll("[data-dll]").forEach(btn =>
      btn.addEventListener("click", () => {
        const b = p.beams.find(o => o.id === APP.selection.id);
        b.lineLoads.splice(parseInt(btn.dataset.dll), 1);
        APP.invalidate(); refresh(); CANVAS.draw();
      }));
    document.querySelectorAll("[data-dal]").forEach(btn =>
      btn.addEventListener("click", () => {
        const sl = p.slabs.find(o => o.id === APP.selection.id);
        sl.areaLoads.splice(parseInt(btn.dataset.dal), 1);
        APP.invalidate(); refresh(); CANVAS.draw();
      }));
  }

  // ==================================================================
  function renderLoads() {
    const box = $("tab-loads");
    const p = APP.proj;
    let html = `<div class="pgroup"><h3>Load cases</h3><table class="mini">
      <tr><th>Case</th><th>Type</th><th>Self-wt</th></tr>` +
      p.loadCases.map(c =>
        `<tr><td>${esc(c.name)}</td><td>${c.type}</td><td>${c.selfWeight ? "auto" : "—"}</td></tr>`).join("") +
      `</table></div>`;
    html += `<div class="pgroup"><h3>Combinations</h3><table class="mini">
      <tr><th>Combo</th><th>Type</th></tr>` +
      p.combos.map(c => `<tr><td>${esc(c.name)}</td><td>${c.type}</td></tr>`).join("") +
      `</table>
      <div class="note">Strength combos (ACI 5.3.1) govern the design envelope;
      the service combo D+L is used for deflections.</div></div>`;
    // assigned loads overview
    let rows = "";
    p.slabs.forEach(s => s.areaLoads.forEach(al =>
      rows += `<tr><td>${esc(s.label) || "S" + s.id}</td><td>area</td><td>${esc(al.caseId)}</td><td>${al.q} kN/m²</td></tr>`));
    p.beams.forEach(b => b.lineLoads.forEach(ll =>
      rows += `<tr><td>${esc(b.label) || "B" + b.id}</td><td>line</td><td>${esc(ll.caseId)}</td><td>${ll.w} kN/m</td></tr>`));
    p.pointLoads.forEach(pl =>
      rows += `<tr><td>(${pl.x},${pl.y})</td><td>point</td><td>${esc(pl.caseId)}</td><td>${pl.P} kN</td></tr>`);
    html += `<div class="pgroup"><h3>Assigned loads</h3><table class="mini">
      <tr><th>Object</th><th>Kind</th><th>Case</th><th>Value</th></tr>${rows ||
      "<tr><td colspan=4>none — select a slab or beam to assign loads</td></tr>"}</table></div>`;
    box.innerHTML = html;
  }

  return { refresh };
})();
