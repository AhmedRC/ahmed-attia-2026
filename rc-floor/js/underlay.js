/* =========================================================================
 * RC-Floor-FEA — underlay.js
 * Architectural underlay import: PDF (via pdf.js), raster images, DXF
 * (LINE / LWPOLYLINE / CIRCLE entities), plus 2-point scale calibration.
 * ========================================================================= */
"use strict";

const UNDERLAY = (() => {

  async function importFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return importPDF(file);
    if (name.endsWith(".dxf")) return importDXF(file);
    return importImage(file);
  }

  // ---------------- PDF (first page rendered to image) ----------------
  async function importPDF(file) {
    if (typeof pdfjsLib === "undefined")
      throw new Error("pdf.js not loaded (internet connection required for PDF import).");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const vpt = page.getViewport({ scale: 2.5 });
    const c = document.createElement("canvas");
    c.width = vpt.width; c.height = vpt.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vpt }).promise;
    setImageUnderlay(c.toDataURL("image/png"), vpt.width, vpt.height);
    APP.log(`PDF underlay imported (page 1, ${vpt.width}×${vpt.height}px). ` +
            `Use the Scale button to calibrate real-world dimensions.`);
  }

  // ---------------- raster image ----------------
  async function importImage(file) {
    const url = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = url; });
    setImageUnderlay(url, img.width, img.height);
    APP.log(`Image underlay imported (${img.width}×${img.height}px). Calibrate with Scale.`);
  }

  function setImageUnderlay(dataUrl, pw, ph) {
    const img = new Image();
    img.onload = () => CANVAS.draw();
    img.src = dataUrl;
    // initial guess: 100 px = 1 m
    const s = 1 / 100;
    APP.proj.underlay = {
      kind: "image", imgDataUrl: dataUrl, img,
      pxW: pw, pxH: ph,
      x: 0, y: 0, wm: pw * s, hm: ph * s,
      opacity: 0.45, visible: true
    };
    CANVAS.zoomFit();
  }

  // ---------------- DXF (minimal entity parser) ----------------
  async function importDXF(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const segs = [];
    let i = 0;
    const rd = () => ({ code: lines[i++]?.trim(), val: lines[i++]?.trim() });
    // scan for ENTITIES section
    while (i < lines.length) {
      const { code, val } = rd();
      if (code === "2" && val === "ENTITIES") break;
    }
    let ent = null, data = {}, plPts = [];
    const flush = () => {
      if (!ent) return;
      if (ent === "LINE" && data.x10 !== undefined)
        segs.push({ x1: +data.x10, y1: +data.y20, x2: +data.x11, y2: +data.y21 });
      if (ent === "LWPOLYLINE" && plPts.length > 1) {
        for (let k = 0; k < plPts.length - 1; k++)
          segs.push({ x1: plPts[k].x, y1: plPts[k].y, x2: plPts[k + 1].x, y2: plPts[k + 1].y });
        if (data.closed) segs.push({
          x1: plPts[plPts.length - 1].x, y1: plPts[plPts.length - 1].y,
          x2: plPts[0].x, y2: plPts[0].y
        });
      }
      if (ent === "CIRCLE" && data.x10 !== undefined) {
        const cx = +data.x10, cy = +data.y20, r = +data.r40 || 1;
        for (let a = 0; a < 24; a++) {
          const t1 = a / 24 * 2 * Math.PI, t2 = (a + 1) / 24 * 2 * Math.PI;
          segs.push({ x1: cx + r * Math.cos(t1), y1: cy + r * Math.sin(t1),
                      x2: cx + r * Math.cos(t2), y2: cy + r * Math.sin(t2) });
        }
      }
      data = {}; plPts = [];
    };
    while (i < lines.length - 1) {
      const { code, val } = rd();
      if (code === "0") {
        flush();
        ent = val;
        if (val === "ENDSEC" || val === "EOF") break;
        continue;
      }
      if (ent === "LWPOLYLINE") {
        if (code === "10") plPts.push({ x: +val, y: 0 });
        else if (code === "20" && plPts.length) plPts[plPts.length - 1].y = +val;
        else if (code === "70") data.closed = (+val & 1) === 1;
      } else {
        if (code === "10") data.x10 = val;
        else if (code === "20") data.y20 = val;
        else if (code === "11") data.x11 = val;
        else if (code === "21") data.y21 = val;
        else if (code === "40") data.r40 = val;
      }
    }
    flush();
    if (!segs.length) throw new Error("No LINE/LWPOLYLINE/CIRCLE entities found in DXF.");
    APP.proj.underlay = {
      kind: "dxf", vectors: segs, vScale: 1,   // DXF often already in meters — calibrate if not
      x: 0, y: 0, opacity: 0.6, visible: true
    };
    APP.log(`DXF underlay imported: ${segs.length} segments. ` +
            `If drawn in mm, use Scale to calibrate.`);
    CANVAS.zoomFit();
  }

  // ---------------- calibration ----------------
  // user picks two points on the underlay, then enters the true distance
  function startCalibration() {
    if (!APP.proj.underlay) { alert("Import an underlay first."); return; }
    APP.setTool("calib");
    APP.drawing.points = [];
    APP.log("Scale calibration: click two points with a known distance…");
  }

  function finishCalibration() {
    const [a, b] = APP.drawing.points;
    APP.drawing.points = [];
    const dCur = CORE.G.dist(a, b);
    const dReal = parseFloat(prompt(`Measured ${dCur.toFixed(3)} m on screen.\n` +
      `Enter the TRUE distance between the two points (m):`, "5"));
    APP.setTool("select");
    if (!dReal || dReal <= 0 || dCur < 1e-9) return;
    const f = dReal / dCur;
    const u = APP.proj.underlay;
    if (u.kind === "image") { u.wm *= f; u.hm *= f; u.x *= f; u.y *= f; }
    else u.vScale *= f;
    APP.log(`Underlay scaled by factor ${f.toFixed(4)}.`);
    CANVAS.zoomFit();
  }

  return { importFile, startCalibration, finishCalibration };
})();
