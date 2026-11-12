/* Soil packing calculator — UI */
(function () {
  'use strict';

  var C = window.SoilCalc;
  var form = document.getElementById('form');
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'soilPackingCalculator.v2';
  var EXTRA_SOIL = 0.10; // extra soil to prepare for losses while sieving and mixing

  var FIELDS = ['shape', 'cylD', 'cylH', 'boxL', 'boxW', 'boxH', 'densities', 'mtype', 'levels', 'w0', 'layers', 'reps'];
  var DEFAULTS = { shape: 'cylinder', cylD: '', cylH: '', boxL: '', boxW: '', boxH: '', densities: '', mtype: 'vol', levels: '', w0: '', layers: '3', reps: '1' };
  var TIPS = [
    '<b>If the mix turns sticky or muddy</b> (common in all but sandy soils), stop adding water while it is still crumbly. ' +
      'Weigh all the mix you made and split it into equal parts, one per layer (the table masses assume all the water is in). ' +
      'After packing, pour the leftover water slowly over the surface.',
    'Weigh water on the scale: 1 g = 1 mL.',
    'Keep soil covered so it does not dry out.',
    'Label every container with its ID.'
  ];
  var EXAMPLE = { shape: 'cylinder', cylD: '10', cylH: '12', boxL: '', boxW: '', boxH: '', densities: '1.30', mtype: 'vol', levels: '0.10, 0.20, 0.30', w0: '0.02', layers: '3', reps: '1' };

  /* ---------- Helpers ---------- */

  function fmt(x, d) {
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtRead(x) { return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); }
  // CSV uses the same rounding as the screen and PDF, without thousands separators
  function csv1(x) { return (Math.abs(x) < 0.05 ? 0 : x).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }); }
  function g1(x) { return fmt(Math.abs(x) < 0.05 ? 0 : x, 1); }
  function kgOrG(x) { return x >= 1000 ? fmt(x / 1000, 2) + ' kg' : fmt(x, 0) + ' g'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function localDate() {
    var d = new Date();
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function num(v) { return v === '' || v == null ? NaN : Number(v); }

  function readForm() {
    var s = {};
    FIELDS.forEach(function (k) { var el = form.elements[k]; s[k] = el ? String(el.value).trim() : ''; });
    return s;
  }
  function writeForm(s) {
    FIELDS.forEach(function (k) {
      var el = form.elements[k];
      if (!el) return;
      var v = s[k] != null ? s[k] : DEFAULTS[k];
      if (el instanceof RadioNodeList) Array.prototype.forEach.call(el, function (r) { r.checked = r.value === v; });
      else el.value = v;
    });
    syncForm();
  }
  function save(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }

  /* ---------- Live form behavior (no results until Calculate) ---------- */

  function geometryFromForm(s) {
    var layers = Math.max(1, Math.round(num(s.layers) || 1));
    var geo = s.shape === 'box'
      ? C.geometry({ shape: 'box', length: num(s.boxL), width: num(s.boxW), height: num(s.boxH) }, layers)
      : C.geometry({ shape: 'cylinder', diameter: num(s.cylD), height: num(s.cylH) }, layers);
    return { geo: geo, layers: layers };
  }

  function syncForm() {
    var s = readForm();
    document.querySelectorAll('[data-shape]').forEach(function (el) { el.hidden = el.dataset.shape !== s.shape; });
    $('levelsUnit').textContent = s.mtype === 'grav' ? 'g/g' : 'cm³/cm³';
    var g = geometryFromForm(s);
    var hint = 'Layers 3–5 cm thick work best.';
    if (g.geo.fillHeight) {
      var t = g.geo.fillHeight / g.layers;
      hint = 'Volume ' + fmt(g.geo.volume, 0) + ' cm³ · each layer ' + fmt(t, 1) + ' cm thick' +
        (t > 5.5 ? ' (too thick: use more layers)' : ' (3–5 cm works best)') + '.';
    }
    $('layerHint').textContent = hint;
    return s;
  }

  var hasResults = false;
  function onEdit() {
    save(syncForm());
    if (hasResults) setStale(true);
  }
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  /* ---------- Calculate ---------- */

  var last = null;

  function calculate() {
    var s = syncForm();
    save(s);
    var g = geometryFromForm(s);
    var errors = g.geo.errors.slice();

    var dens = C.parseList(s.densities);
    var lev = C.parseList(s.levels);
    var densities = dens.values.filter(function (v) { return v !== 'AD'; });
    if (dens.invalid.length) errors.push('Could not read bulk density "' + dens.invalid.join(', ') + '".');
    if (lev.invalid.length) errors.push('Could not read water content "' + lev.invalid.join(', ') + '".');
    var reps = Math.max(1, Math.round(num(s.reps) || 1));

    // Run the plan even with a missing container so every missing input is listed at once
    var p = C.plan({
      V: g.geo.errors.length ? 1 : g.geo.volume, layerFractions: g.geo.layerFractions, replicates: reps,
      densities: densities, levels: lev.values, moistureType: s.mtype, unit: 'frac',
      soilState: 'air', w0: num(s.w0), workflow: 'separate', thetaMix: null, margin: EXTRA_SOIL, rhoS: 2.65
    });
    errors = errors.concat(p.errors);

    // Any error: show it next to the form and produce no table, totals, or exports
    if (errors.length || !p.groups.length) {
      $('formErrors').innerHTML = errors.map(function (e) { return '<div class="alert alert-error" role="alert">' + esc(e) + '</div>'; }).join('');
      $('results').hidden = true;
      $('printSheet').innerHTML = '';
      hasResults = false;
      last = null;
      return;
    }

    $('formErrors').innerHTML = '';
    var ctx = {
      s: s, geo: g.geo, layers: g.layers, reps: reps, plan: p, densities: densities,
      dryLabel: num(s.w0) > 0 ? 'Air-dry soil' : 'Oven-dry soil'
    };
    last = ctx;
    $('alerts').innerHTML = p.warnings.map(function (w) { return '<div class="alert alert-warn">' + esc(w) + '</div>'; }).join('');
    renderSummary(ctx);
    renderStats(ctx);
    renderTable(ctx);
    $('protocol').innerHTML = renderSteps(ctx).map(function (h) { return '<li><span>' + h + '</span></li>'; }).join('');
    buildPrintSheet(ctx); // so the browser's own Print also gives the current sheet

    $('results').hidden = false;
    setStale(false);
    hasResults = true;
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Results no longer match the inputs: say so and block exports until Calculate is pressed again
  function setStale(stale) {
    $('staleNote').hidden = !stale;
    $('csvBtn').disabled = stale;
    $('pdfBtn').disabled = stale;
    $('results').classList.toggle('is-stale', stale);
    if (stale) $('printSheet').innerHTML = '';
  }

  /* ---------- Rendering ---------- */

  function renderSummary(ctx) {
    var s = ctx.s;
    var shape = s.shape === 'box'
      ? 'Box ' + s.boxL + ' × ' + s.boxW + ' cm, filled to ' + s.boxH + ' cm'
      : 'Cylinder ' + s.cylD + ' cm wide, filled to ' + s.cylH + ' cm';
    // Echo the values as the calculator read them (catches e.g. "1,3" typed for 1.3)
    var levels = ctx.plan.groups[0].items.map(function (c) {
      if (c.isAirDry) return 'AD';
      return fmtRead(s.mtype === 'grav' ? c.w : c.theta);
    });
    $('summaryLine').textContent = [
      shape + ' (' + fmt(ctx.geo.volume, 0) + ' cm³)',
      'bulk density ' + ctx.densities.map(fmtRead).join(', ') + ' g/cm³',
      (s.mtype === 'grav' ? 'gravimetric ' : 'volumetric ') + levels.join(', ') + (s.mtype === 'grav' ? ' g/g' : ' cm³/cm³'),
      ctx.layers + ' layer' + (ctx.layers > 1 ? 's' : ''),
      'dry soil water content ' + fmt(ctx.plan.w0, 3) + ' g/g'
    ].join(' · ');
  }

  function stat(label, value, note) {
    return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div>' +
      (note ? '<div class="stat-note">' + note + '</div>' : '') + '</div>';
  }

  function renderStats(ctx) {
    var t = ctx.plan.totals;
    $('stats').innerHTML =
      stat('Containers', String(t.containers), t.treatments + ' treatment' + (t.treatments > 1 ? 's' : '') + ' × ' + ctx.reps + ' replicate' + (ctx.reps > 1 ? 's' : '')) +
      stat(ctx.dryLabel + ' needed', kgOrG(t.soil), 'prepare about ' + kgOrG(t.soilWithMargin) + ' (10% extra)') +
      stat('Water needed', kgOrG(t.water), '1 g = 1 mL');
  }

  // Plain wording: "g × 3" reads like an instruction to multiply
  function layerUnit(n) { return n > 1 ? 'g, add ' + n + ' times' : 'g'; }

  function renderTable(ctx) {
    var rows = '';
    var id = 0;
    ctx.plan.groups.forEach(function (g) {
      g.items.forEach(function (c) {
        id++;
        c.id = 'T' + id;
        var bad = c.belowAirDry || c.saturation > 1.0001;
        rows += '<tr' + (bad ? ' class="bad"' : '') + '>' +
          '<td class="key">' + c.id + '</td>' +
          '<td>' + fmt(c.rhoB, 2) + '</td>' +
          '<td>' + fmt(c.theta, 3) + (c.isAirDry ? '<span class="tag">AD</span>' : '') + '</td>' +
          '<td>' + fmt(c.w, 3) + '</td>' +
          '<td class="key em">' + g1(c.soil) + '</td>' +
          '<td class="key em">' + g1(c.water) + '</td>' +
          '<td>' + g1(c.mix) + '</td>' +
          '<td class="key">' + g1(c.layers[0]) + '</td></tr>';
      });
    });
    $('tables').innerHTML =
      '<p class="table-title">Per container</p>' +
      '<div class="table-wrap"><table class="results-table"><thead><tr>' +
      '<th>ID</th>' +
      '<th>Bulk density<small>g/cm³</small></th>' +
      '<th>Volumetric<small>cm³/cm³</small></th>' +
      '<th>Gravimetric<small>g/g</small></th>' +
      '<th class="em">' + ctx.dryLabel + '<small>g</small></th>' +
      '<th class="em">Water<small>g</small></th>' +
      '<th>Soil + water<small>g</small></th>' +
      '<th>Each layer<small>' + layerUnit(ctx.layers) + '</small></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderSteps(ctx) {
    var geo = ctx.geo;
    var soilWord = ctx.plan.w0 > 0 ? 'air-dry soil' : 'oven-dry soil';
    var prep = '<span class="num">' + kgOrG(ctx.plan.totals.soilWithMargin) + '</span>';
    var steps = [];
    steps.push('<strong>Get the soil ready.</strong> Sieve about ' + prep + ' of ' + soilWord + ' through a 2-mm sieve.');

    // The number of containers is stated once, here
    var n = ctx.plan.totals.containers;
    var count = ctx.reps > 1
      ? 'Get <span class="num">' + n + '</span> containers (' + ctx.reps + ' per ID) and label each with its ID. '
      : 'Get <span class="num">' + n + '</span> container' + (n > 1 ? 's' : '') + ' and label each with its ID. ';
    var lines = ctx.layers > 1
      ? 'Draw lines inside at <span class="num">' + geo.marks.map(function (m) { return fmt(m, 1); }).join(', ') + ' cm</span> from the bottom.'
      : 'Draw a line inside at <span class="num">' + fmt(geo.fillHeight, 1) + ' cm</span> from the bottom.';
    steps.push('<strong>Mark the containers.</strong> ' + count + lines);

    steps.push('<strong>Weigh and mix.</strong> For each container, weigh the soil and water from the table into a bin with a lid. ' +
      'Add the water a little at a time and mix until the color is even, with no dry spots or clumps. ' +
      'A covered mix can wait until the next day.');

    if (ctx.layers > 1) {
      steps.push('<strong>Pack in layers.</strong> Add the mass for one layer, level it, and press it down to the next line. ' +
        'Thin layers give better control of bulk density than filling the container all at once.');
    } else {
      steps.push('<strong>Pack.</strong> Add all the mix, level it, and press it down to the line. ' +
        'For containers taller than 5 cm, use layers: they give better control of bulk density.');
    }

    steps.push('<strong>Cover and wait overnight</strong> so the water spreads evenly before you measure or plant.');
    steps.push('<strong>Check at the end.</strong> Oven-dry the soil to measure the actual bulk density and water content. ' +
      '<button type="button" class="link-btn inline" data-open-check>How to do it</button>');
    return steps;
  }

  /* ---------- Final check (oven-dry method) ---------- */

  function checkSteps(last6) {
    return [
      'Remove sensors, plants, and as many roots as you can.',
      'Weigh an empty oven-safe tray (aluminum pan). Do not tare the scale.',
      'Empty all the soil from the container into the tray. Scrape the walls and bottom.',
      'Weigh the tray with the moist soil.',
      'Dry at 105 °C for at least 48 h (until the mass stops changing), then weigh the tray with the dry soil. Follow your lab’s oven rules.',
      last6
    ];
  }

  function checkFormulas(V) {
    return '<ul class="formulas">' +
      '<li>Dry soil = (tray + dry soil) − empty tray</li>' +
      '<li>Gravimetric water content, <i>w</i> = [(tray + moist soil) − (tray + dry soil)] ÷ dry soil</li>' +
      '<li>Bulk density, ρ<sub>b</sub> = dry soil ÷ ' + fmt(V, 0) + ' cm³ (container volume)</li>' +
      '<li>Volumetric water content, θ = <i>w</i> × ρ<sub>b</sub></li></ul>';
  }

  function openCheck() {
    if (!last) return;
    $('checkSteps').innerHTML = checkSteps('Enter the masses in the calculator below, or use the PDF record sheet.').map(function (t) { return '<li>' + t + '</li>'; }).join('');
    $('checkVolume').textContent = '(container volume ' + fmt(last.geo.volume, 0) + ' cm³)';
    $('checkFormulas').innerHTML = checkFormulas(last.geo.volume);
    updateCheck();
    var d = $('checkDialog');
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }

  function updateCheck() {
    var get = function (k) { return num($('checkDialog').querySelector('[data-c="' + k + '"]').value); };
    var tray = get('tray'), wet = get('wet'), dry = get('dry');
    var out = $('checkOut');
    if (![tray, wet, dry].every(Number.isFinite)) { out.textContent = 'Enter the three masses.'; return; }
    var soil = dry - tray;
    if (!(soil > 0) || wet < dry) { out.textContent = 'Check the masses: tray + moist ≥ tray + dry > tray.'; return; }
    var w = (wet - dry) / soil;
    var rhoB = soil / last.geo.volume;
    out.innerHTML = 'Dry soil <b>' + fmt(soil, 1) + ' g</b> · <i>w</i> <b>' + fmt(w, 3) + ' g/g</b> · ρ<sub>b</sub> <b>' +
      fmt(rhoB, 2) + ' g/cm³</b> · θ <b>' + fmt(w * rhoB, 3) + ' cm³/cm³</b>';
  }

  /* ---------- Printable sheet / PDF ---------- */

  function buildPrintSheet(ctx) {
    var t = ctx.plan.totals;
    var today = localDate();
    var h = '';
    h += '<h1>Soil packing plan</h1>';
    h += '<p class="ps-fill">Name: <span></span> Experiment: <span></span> Date: <b>' + today + '</b></p>';
    h += '<p>' + esc($('summaryLine').textContent) + '</p>';
    h += '<p>' + t.containers + ' containers · ' + ctx.dryLabel.toLowerCase() + ' ' + kgOrG(t.soil) +
      ' (prepare about ' + kgOrG(t.soilWithMargin) + ') · water ' + kgOrG(t.water) + '</p>';

    // Packing table with a check-off column
    h += '<h2>What to weigh, per container</h2>';
    h += '<table class="ps-table"><thead><tr><th>ID</th><th>Bulk density<br>g/cm³</th><th>Volumetric<br>cm³/cm³</th><th>Gravimetric<br>g/g</th>' +
      '<th>' + ctx.dryLabel + '<br>g</th><th>Water<br>g</th><th>Soil + water<br>g</th><th>Each layer<br>' + layerUnit(ctx.layers) + '</th><th class="ps-check">Check if done</th></tr></thead><tbody>';
    ctx.plan.groups.forEach(function (g) {
      g.items.forEach(function (c) {
        h += '<tr><td>' + c.id + '</td><td>' + fmt(c.rhoB, 2) + '</td><td>' + fmt(c.theta, 3) + '</td><td>' + fmt(c.w, 3) + '</td>' +
          '<td><b>' + g1(c.soil) + '</b></td><td><b>' + g1(c.water) + '</b></td><td>' + g1(c.mix) + '</td><td>' + g1(c.layers[0]) + '</td><td class="ps-blank"></td></tr>';
      });
    });
    h += '</tbody></table>';

    h += '<h2>Steps</h2><ol>' + renderSteps(ctx).map(function (s) {
      return '<li>' + s.replace(/<button[^>]*>.*?<\/button>/, 'See the final check sheet.') + '</li>';
    }).join('') + '</ol>';
    h += '<h2>Tips</h2><ul>' + TIPS.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';

    // Final check record sheet
    h += '<section class="ps-page"><h1>Final check: oven-dry method</h1>';
    h += '<p>Container volume <b>' + fmt(ctx.geo.volume, 0) + ' cm³</b>. All masses in grams.</p>';
    h += '<ol>' + checkSteps('Record the masses in the table and calculate with the formulas below it.').map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>';
    h += '<table class="ps-table ps-record"><thead><tr><th>ID</th><th>Rep</th><th>Target bulk density<br>g/cm³</th><th>Target volumetric water<br>cm³/cm³</th>' +
      '<th>Empty tray<br>g</th><th>Tray + moist soil<br>g</th><th>Tray + dry soil<br>g</th><th>Dry soil<br>g</th>' +
      '<th>Gravimetric water <i>w</i><br>g/g</th><th>Bulk density ρ<sub>b</sub><br>g/cm³</th><th>Volumetric water θ<br>cm³/cm³</th></tr></thead><tbody>';
    ctx.plan.groups.forEach(function (g) {
      g.items.forEach(function (c) {
        for (var r = 1; r <= ctx.reps; r++) {
          h += '<tr><td>' + c.id + '</td><td>' + r + '</td><td>' + fmt(c.rhoB, 2) + '</td><td>' + fmt(c.theta, 3) + '</td>' +
            '<td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
        }
      });
    });
    h += '</tbody></table>';
    h += '<h2>Formulas</h2>' + checkFormulas(ctx.geo.volume) + '</section>';
    $('printSheet').innerHTML = h;
  }

  function downloadPDF() {
    if (!last || $('pdfBtn').disabled) return;
    buildPrintSheet(last);
    var title = document.title;
    document.title = 'soil-packing-plan-' + localDate(); // default PDF file name
    window.addEventListener('afterprint', function restore() {
      document.title = title;
      window.removeEventListener('afterprint', restore);
    });
    window.print();
  }

  /* ---------- CSV ---------- */

  function downloadCSV() {
    if (!last || $('csvBtn').disabled) return;
    var soilCol = last.plan.w0 > 0 ? 'air_dry_soil_g' : 'oven_dry_soil_g';
    var rows = [
      ['# container_volume_cm3', last.geo.volume.toFixed(1)],
      ['# layers', last.layers],
      ['# replicates', last.reps],
      ['# soil_water_content_g_g', last.plan.w0],
      [],
      ['id', 'bulk_density_g_cm3', 'vwc_cm3_cm3', 'gwc_g_g', soilCol, 'water_g', 'soil_plus_water_g', 'each_layer_g']
    ];
    last.plan.groups.forEach(function (g) {
      g.items.forEach(function (c) {
        rows.push([c.id, g.rhoB, c.theta.toFixed(4), c.w.toFixed(4), csv1(c.soil), csv1(c.water), csv1(c.mix), csv1(c.layers[0])]);
      });
    });
    var blob = new Blob([rows.map(function (r) { return r.join(','); }).join('\r\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'soil-packing-plan.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ---------- Air-dry water content modal ---------- */

  var dialog = $('w0Dialog');
  var helperMean = null;

  function updateHelper() {
    var samples = [];
    dialog.querySelectorAll('.w0-row[role="row"]:not(.w0-head)').forEach(function (row) {
      var get = function (k) { return num(row.querySelector('[data-k="' + k + '"]').value); };
      var smp = { can: get('can'), wet: get('wet'), dry: get('dry') };
      var r = C.airDryWaterContent([smp]);
      var started = [smp.can, smp.wet, smp.dry].some(Number.isFinite);
      var out = row.querySelector('output');
      // A row that was filled in but cannot be used is flagged instead of silently skipped
      out.textContent = r ? fmt(r.mean, 4) : (started && [smp.can, smp.wet, smp.dry].every(Number.isFinite) ? 'check' : '');
      out.title = out.textContent === 'check' ? 'Masses should increase: empty can < can + oven-dry ≤ can + air-dry' : '';
      out.classList.toggle('bad-cell', out.textContent === 'check');
      samples.push(smp);
    });
    var res = C.airDryWaterContent(samples);
    helperMean = res ? res.mean : null;
    var txt = res ? 'Average: ' + fmt(res.mean, 4) + ' g/g (' + res.n + ' can' + (res.n > 1 ? 's' : '') + ')' : 'Average: —';
    if (res && res.n > 1 && res.range > 0.005) txt += '. Cans differ a lot; mix the soil and repeat.';
    $('w0Mean').textContent = txt;
    $('useW0').disabled = !res;
  }

  $('openW0').addEventListener('click', function () {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  dialog.addEventListener('input', updateHelper);
  dialog.addEventListener('close', function () {
    if (dialog.returnValue === 'use' && helperMean != null) {
      form.elements.w0.value = helperMean.toFixed(4);
      form.dispatchEvent(new Event('input'));
    }
  });
  // Enter inside the table should not close the dialog
  dialog.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });

  /* ---------- Buttons ---------- */

  form.addEventListener('submit', function (e) { e.preventDefault(); calculate(); });
  $('exampleBtn').addEventListener('click', function () {
    writeForm(EXAMPLE); save(readForm());
    $('formErrors').innerHTML = '';
    if (hasResults) setStale(true);
  });
  $('resetBtn').addEventListener('click', function () {
    writeForm(DEFAULTS); save(readForm());
    $('formErrors').innerHTML = '';
    $('results').hidden = true;
    $('printSheet').innerHTML = '';
    hasResults = false;
    last = null;
  });
  $('csvBtn').addEventListener('click', downloadCSV);
  $('pdfBtn').addEventListener('click', downloadPDF);
  $('checkPdfBtn').addEventListener('click', function () { $('checkDialog').close(); downloadPDF(); });
  $('protocol').addEventListener('click', function (e) { if (e.target.closest('[data-open-check]')) openCheck(); });
  $('checkDialog').addEventListener('input', updateCheck);
  $('checkDialog').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });

  /* ---------- Init ---------- */
  $('tipsList').innerHTML = TIPS.map(function (t) { return '<li>' + t + '</li>'; }).join('');
  writeForm(load() || DEFAULTS);
})();
