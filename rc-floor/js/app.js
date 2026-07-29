/* =========================================================================
 * RC-Floor-FEA — app.js
 * Application state machine and top-bar workflow: Mesh → Analyze → Design → Report.
 * ========================================================================= */
"use strict";

const APP = {
  proj: null,
  tool: "select",
  selection: null,
  drawing: { points: [], cursor: null },
  snap: true,
  resultType: "model",
  resultSet: null,
  defaults: {
    column: { bx: 0.4, by: 0.4, Lc: 3.0, shape: "rect", supportType: "roller" },
    beam: { b: 0.25, h: 0.6 },
    slab: { t: 0.2, slabType: "solid" },
    pload: { P: 20, caseId: "DL" }
  },

  log(msg) {
    const box = document.getElementById("logBox");
    box.textContent += msg + "\n";
    box.scrollTop = box.scrollHeight;
    console.log("[RC-FEA]", msg);
  },

  select(kind, id) {
    this.selection = kind ? { kind, id } : null;
    PANELS.refresh();
    CANVAS.draw();
  },

  setTool(t) {
    this.tool = t;
    this.drawing.points = [];
    document.querySelectorAll("#palette .tool").forEach(b =>
      b.classList.toggle("active", b.dataset.tool === t));
    const hints = {
      select: "Click an object to edit it. Del deletes, F zooms to fit.",
      column: "Click to place columns. Set defaults in the right panel.",
      beam: "Click start point, then end point.",
      slabRect: "Click two opposite corners of the slab.",
      slabPoly: "Click vertices; double-click to close the polygon.",
      opening: "Click two opposite corners of the opening.",
      pload: "Click to place a point load.",
      calib: "Click two points with a known distance."
    };
    document.getElementById("hint").textContent = hints[t] || "";
    PANELS.refresh();
  },

  // model changed → mesh/results stale
  invalidate() {
    this.proj.mesh = null;
    this.proj.results = null;
    this.proj.designResults = null;
    this.resultType = "model";
    document.getElementById("selResult").value = "model";
    document.getElementById("btnAnalyze").disabled = true;
    document.getElementById("btnDesign").disabled = true;
    document.getElementById("btnReport").disabled = true;
    document.getElementById("resultCtrls").style.display = "none";
    document.getElementById("meshInfo").textContent = "";
    RESULTS.hideLegend();
    PANELS.refresh();
  },

  // ---------------- workflow ----------------
  doMesh() {
    try {
      this.proj.mesh = MESHER.generate(this.proj);
      const s = this.proj.mesh.stats;
      this.log(`Mesh: ${s.nodes} nodes, ${s.plates} plate els, ${s.beamEls} beam els, ${s.supports} supports (${s.dofs} DOFs).`);
      this.proj.mesh.warnings.forEach(w => this.log("⚠ " + w));
      document.getElementById("meshInfo").textContent =
        `mesh: ${s.nodes} nodes / ${s.plates + s.beamEls} elements`;
      document.getElementById("btnAnalyze").disabled = false;
      document.getElementById("resultCtrls").style.display = "";
      this.resultType = "mesh";
      document.getElementById("selResult").value = "mesh";
      CANVAS.draw();
    } catch (e) {
      alert("Meshing failed: " + e.message);
      this.log("✗ " + e.message);
    }
  },

  doAnalyze() {
    if (!this.proj.mesh) return;
    this.log("— Analysis started —");
    try {
      const t0 = performance.now();
      this.proj.results = SOLVER.analyze(this.proj, m => this.log("  " + m));
      this.log(`— Analysis complete in ${(performance.now() - t0).toFixed(0)} ms —`);
      // populate set selector
      const selSet = document.getElementById("selSet");
      selSet.innerHTML = "";
      for (const id of this.proj.results.order) {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = this.proj.results.sets[id].name;
        selSet.appendChild(o);
      }
      const u2 = this.proj.results.order.find(id => id === "U2");
      this.resultSet = u2 || this.proj.results.order[0];
      selSet.value = this.resultSet;
      document.getElementById("btnDesign").disabled = false;
      this.resultType = "defl";
      document.getElementById("selResult").value = "defl";
      CANVAS.draw();
      // warn if equilibrium error significant
      for (const id of this.proj.results.order) {
        const s = this.proj.results.sets[id];
        if (s.eqErr > 0.01)
          this.log(`⚠ ${s.name}: equilibrium error ${(s.eqErr * 100).toFixed(1)}% — check model.`);
      }
    } catch (e) {
      alert("Analysis failed: " + e.message);
      this.log("✗ " + e.message);
      console.error(e);
    }
  },

  doDesign() {
    if (!this.proj.results) return;
    try {
      this.proj.designResults = DESIGN.run(this.proj, this.proj.results);
      const d = this.proj.designResults;
      this.log(`— ACI 318-19 design: ${d.beams.length} beams, ${d.slabs.length} slabs, ` +
               `${d.punching.length} punching checks, ${d.columns.length} columns —`);
      const bad = [
        ...d.beams.filter(x => !x.flexOK || !x.shearOK).map(x => "Beam " + x.label),
        ...d.punching.filter(x => !x.ok).map(x => "Punching at " + x.label),
        ...d.columns.filter(x => !x.ok).map(x => "Column " + x.label)
      ];
      if (bad.length) this.log("⚠ Design attention needed: " + bad.join(", "));
      else this.log("✓ All design checks satisfied.");
      document.getElementById("btnReport").disabled = false;
      this.showDesignSummary();
    } catch (e) {
      alert("Design failed: " + e.message);
      this.log("✗ " + e.message);
      console.error(e);
    }
  },

  showDesignSummary() {
    const d = this.proj.designResults;
    if (!d) return;
    const box = document.getElementById("tab-props");
    let h = `<div class="pgroup"><h3>Design summary (ACI 318-19)</h3>`;
    if (d.beams.length) {
      h += `<table class="mini"><tr><th>Beam</th><th>Bottom</th><th>Top</th><th>Stirrups</th></tr>`;
      for (const b of d.beams)
        h += `<tr><td>${b.label}</td><td>${b.barsBot}</td><td>${b.barsTop}</td><td>${b.stirrups}</td></tr>`;
      h += `</table>`;
    }
    h += `<table class="mini"><tr><th>Slab</th><th>Bot X</th><th>Bot Y</th><th>Top X</th><th>Top Y</th></tr>`;
    for (const s of d.slabs)
      h += `<tr><td>${s.label}</td><td>${s.botX.bars}</td><td>${s.botY.bars}</td><td>${s.topX.bars}</td><td>${s.topY.bars}</td></tr>`;
    h += `</table>`;
    if (d.punching.length) {
      h += `<table class="mini"><tr><th>Punching</th><th>Util.</th><th></th></tr>`;
      for (const pc of d.punching)
        h += `<tr><td>${pc.label} (${pc.kind})</td><td>${(pc.util * 100).toFixed(0)}%</td>
              <td class="${pc.ok ? "ok" : "bad"}">${pc.ok ? "OK" : "N.G."}</td></tr>`;
      h += `</table>`;
    }
    if (d.columns.length) {
      h += `<table class="mini"><tr><th>Column</th><th>Bars</th><th>Ties</th></tr>`;
      for (const c of d.columns)
        h += `<tr><td>${c.label}</td><td>${c.bars}</td><td>${c.ties}</td></tr>`;
      h += `</table>`;
    }
    h += `<div class="note">Full calculations with clause references are in the
      printable report (button 4).</div></div>`;
    box.innerHTML = h + box.innerHTML;
  },

  // ---------------- file ops ----------------
  saveFile() {
    const blob = new Blob([MODEL.save(this.proj)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (this.proj.meta.name || "floor").replace(/[^\w\- ]/g, "") + ".json";
    a.click();
  },

  openFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        this.proj = MODEL.load(r.result);
        // restore underlay image object
        const u = this.proj.underlay;
        if (u && u.imgDataUrl) {
          u.img = new Image();
          u.img.onload = () => CANVAS.draw();
          u.img.src = u.imgDataUrl;
        }
        this.invalidate();
        this.select(null);
        CANVAS.zoomFit();
        this.log(`Opened project "${this.proj.meta.name}".`);
      } catch (e) { alert("Could not open file: " + e.message); }
    };
    r.readAsText(file);
  }
};

// ======================= bootstrap =======================
window.addEventListener("DOMContentLoaded", () => {
  APP.proj = MODEL.newProject();

  CANVAS.init(document.getElementById("cv"));
  TOOLS.init(document.getElementById("cv"));

  // palette
  document.querySelectorAll("#palette .tool").forEach(b =>
    b.addEventListener("click", () => APP.setTool(b.dataset.tool)));
  document.getElementById("btnZoomFit").addEventListener("click", () => CANVAS.zoomFit());
  document.getElementById("btnGrid").addEventListener("click", (e) => {
    APP.snap = !APP.snap;
    e.currentTarget.classList.toggle("on", APP.snap);
  });
  document.getElementById("btnDelete").addEventListener("click", () => TOOLS.deleteSelection());

  // top bar
  document.getElementById("btnNew").addEventListener("click", () => {
    if (!confirm("Start a new project? Unsaved changes will be lost.")) return;
    APP.proj = MODEL.newProject();
    APP.invalidate(); APP.select(null); CANVAS.zoomFit();
  });
  document.getElementById("btnSave").addEventListener("click", () => APP.saveFile());
  document.getElementById("btnOpen").addEventListener("click", () =>
    document.getElementById("fileOpen").click());
  document.getElementById("fileOpen").addEventListener("change", (e) => {
    if (e.target.files[0]) APP.openFile(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btnExample").addEventListener("click", () => {
    APP.proj = EXAMPLE.build();
    APP.invalidate(); APP.select(null); CANVAS.zoomFit();
    APP.log("Example model loaded: combined slab-beam + ribbed + flat-slab floor, 3×3 columns. " +
            "Press 1 Mesh → 2 Analyze → 3 Design → 4 Report.");
  });

  document.getElementById("btnUnderlay").addEventListener("click", () =>
    document.getElementById("fileUnderlay").click());
  document.getElementById("fileUnderlay").addEventListener("change", async (e) => {
    if (e.target.files[0]) {
      try { await UNDERLAY.importFile(e.target.files[0]); }
      catch (err) { alert(err.message); }
    }
    e.target.value = "";
  });
  document.getElementById("btnCalib").addEventListener("click", () =>
    UNDERLAY.startCalibration());

  document.getElementById("btnMesh").addEventListener("click", () => APP.doMesh());
  document.getElementById("btnAnalyze").addEventListener("click", () => APP.doAnalyze());
  document.getElementById("btnDesign").addEventListener("click", () => APP.doDesign());
  document.getElementById("btnReport").addEventListener("click", () => REPORT.generate());

  // result controls
  document.getElementById("selSet").addEventListener("change", (e) => {
    APP.resultSet = e.target.value; CANVAS.draw();
  });
  document.getElementById("selResult").addEventListener("change", (e) => {
    APP.resultType = e.target.value;
    if (APP.resultType === "model" || APP.resultType === "mesh") RESULTS.hideLegend();
    CANVAS.draw();
  });

  // sidebar tabs
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tabpage").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
    }));

  PANELS.refresh();
  APP.setTool("select");
  APP.log("RC-Floor-FEA ready. Load the Example or draw a model. Internal units: kN, m.");
});
