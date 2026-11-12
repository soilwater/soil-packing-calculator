/*
 * Soil packing calculator — pure calculation functions (no DOM).
 * Works in the browser (window.SoilCalc) and in Node (module.exports) for testing.
 *
 * Conventions
 *   V      soil volume to be packed (cm3)
 *   rhoB   target dry bulk density (g cm-3)
 *   theta  volumetric water content (cm3 cm-3)
 *   w      gravimetric water content (g g-1), mass of water per mass of oven-dry soil
 *   w0     water content of the air-dry soil (g g-1); 0 for oven-dry soil
 *   Ms     oven-dry soil mass (g) = rhoB * V
 *   theta  = w * rhoB / rhoW, with rhoW = 1 g cm-3
 */
(function (root) {
  'use strict';

  var RHO_W = 1.0; // g cm-3

  /* ---------- Parsing ---------- */

  // Parse "0.1, 0.2; 0.3" into numbers. Tokens "AD"/"air-dry" are returned as the string 'AD'.
  function parseList(str) {
    var tokens = String(str || '').split(/[\s,;]+/).filter(Boolean);
    var values = [];
    var invalid = [];
    tokens.forEach(function (t) {
      var low = t.toLowerCase();
      if (low === 'ad' || low === 'air-dry' || low === 'airdry' || low === 'air') {
        if (values.indexOf('AD') === -1) values.push('AD');
        return;
      }
      var x = Number(t);
      if (Number.isFinite(x)) {
        if (values.indexOf(x) === -1) values.push(x);
      } else {
        invalid.push(t);
      }
    });
    return { values: values, invalid: invalid };
  }

  /* ---------- Geometry ---------- */

  function frustumVolume(r1, r2, h) {
    return Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2) / 3;
  }

  /*
   * geometry(g, nLayers) -> { volume, fillHeight, layerFractions[], marks[] }
   *   g.shape: 'volume' | 'cylinder' | 'cone' | 'box'
   *   volume:   g.volume
   *   cylinder: g.diameter, g.height (fill height)
   *   cone:     g.dBottom, g.dTop, g.height (container height), g.fill (fill height, optional)
   *   box:      g.length, g.width, g.height (fill height)
   * Layers have equal thickness. For a truncated cone they therefore hold different volumes,
   * so each layer gets its own fraction of the total mass.
   */
  function geometry(g, nLayers) {
    var n = Math.max(1, Math.round(nLayers || 1));
    var out = { volume: NaN, fillHeight: null, layerFractions: [], marks: [], errors: [] };
    var i;

    function equalLayers(h) {
      for (i = 1; i <= n; i++) {
        out.layerFractions.push(1 / n);
        if (h) out.marks.push(h * i / n);
      }
    }

    function pos(x) { return Number.isFinite(x) && x > 0; }

    switch (g.shape) {
      case 'volume':
        if (!pos(g.volume)) { out.errors.push('Enter the soil volume of the container.'); return out; }
        out.volume = g.volume;
        equalLayers(null);
        break;

      case 'cylinder':
        if (!pos(g.diameter) || !pos(g.height)) { out.errors.push('Enter the inner diameter and fill height.'); return out; }
        out.volume = Math.PI * Math.pow(g.diameter / 2, 2) * g.height;
        out.fillHeight = g.height;
        equalLayers(g.height);
        break;

      case 'box':
        if (!pos(g.length) || !pos(g.width) || !pos(g.height)) { out.errors.push('Enter the inner length, width, and fill height.'); return out; }
        out.volume = g.length * g.width * g.height;
        out.fillHeight = g.height;
        equalLayers(g.height);
        break;

      case 'cone': {
        if (!pos(g.dBottom) || !pos(g.dTop) || !pos(g.height)) { out.errors.push('Enter the bottom diameter, top diameter, and container height.'); return out; }
        var H = g.height;
        var hf = pos(g.fill) ? g.fill : H;
        if (hf > H) { out.errors.push('Fill height cannot exceed the container height.'); return out; }
        var r1 = g.dBottom / 2;
        var r2 = g.dTop / 2;
        var rAt = function (z) { return r1 + (r2 - r1) * z / H; };
        out.volume = frustumVolume(r1, rAt(hf), hf);
        out.fillHeight = hf;
        out.topDiameterAtFill = 2 * rAt(hf);
        var prev = 0;
        for (i = 1; i <= n; i++) {
          var z = hf * i / n;
          var vz = frustumVolume(r1, rAt(z), z);
          out.layerFractions.push((vz - prev) / out.volume);
          out.marks.push(z);
          prev = vz;
        }
        break;
      }

      default:
        out.errors.push('Unknown container shape.');
    }
    return out;
  }

  /* ---------- Air-dry water content (thermogravimetric) ---------- */

  // samples: [{ can, wet, dry }] masses in g (wet = can + air-dry soil, dry = can + oven-dry soil)
  function airDryWaterContent(samples) {
    var ws = [];
    samples.forEach(function (s) {
      if ([s.can, s.wet, s.dry].every(Number.isFinite) && s.dry > s.can && s.wet >= s.dry) {
        ws.push((s.wet - s.dry) / (s.dry - s.can));
      }
    });
    if (!ws.length) return null;
    var mean = ws.reduce(function (a, b) { return a + b; }, 0) / ws.length;
    var range = Math.max.apply(null, ws) - Math.min.apply(null, ws);
    return { values: ws, mean: mean, range: range, n: ws.length };
  }

  /* ---------- Treatments ---------- */

  /*
   * One container packed at one bulk density and one water content.
   *   p: { V, rhoB, theta, w0, thetaMix (null = mix all water), rhoS }
   */
  function container(p) {
    var Ms = p.rhoB * p.V;
    var w = p.theta * RHO_W / p.rhoB;
    var porosity = 1 - p.rhoB / p.rhoS;
    var r = {
      rhoB: p.rhoB,
      theta: p.theta,
      w: w,
      porosity: porosity,
      saturation: porosity > 0 ? p.theta / porosity : Infinity,
      dry: Ms,                      // oven-dry soil equivalent (g)
      soil: Ms * (1 + p.w0),        // mass of soil to weigh as is (air-dry or oven-dry)
      water: Ms * (w - p.w0),       // total water to add (g = mL)
      waterMix: Ms * (w - p.w0),    // water mixed into the soil before packing
      waterTop: 0,                  // water applied on the surface after packing
      wMix: w
    };
    if (p.thetaMix != null && p.theta > p.thetaMix) {
      r.wMix = Math.max(p.thetaMix * RHO_W / p.rhoB, p.w0);
      r.waterMix = Ms * (r.wMix - p.w0);
      r.waterTop = Ms * (w - r.wMix);
    }
    r.mix = Ms * (1 + r.wMix);      // moist mixture to pack (g)
    r.final = Ms * (1 + w);         // soil + water in the container at the end (g)
    return r;
  }

  /*
   * plan(input) -> full plan for all treatments.
   *   input: {
   *     V, layerFractions[], replicates,
   *     densities[], levels[] (numbers or 'AD'), moistureType 'vol'|'grav', unit 'frac'|'pct',
   *     soilState 'oven'|'air', w0, workflow 'separate'|'stepwise',
   *     thetaMix (null or vol fraction), margin (fraction), rhoS
   *   }
   */
  function plan(input) {
    var errors = [];
    var warnings = [];
    var w0 = input.soilState === 'air' ? input.w0 : 0;
    var scale = input.unit === 'pct' ? 0.01 : 1;
    var stepwise = input.workflow === 'stepwise';
    var thetaMix = stepwise ? null : input.thetaMix;
    var reps = Math.max(1, Math.round(input.replicates || 1));

    if (!(input.V > 0)) errors.push('Container volume is missing.');
    if (input.soilState === 'air') {
      if (!Number.isFinite(input.w0)) errors.push('Enter the water content of your dry soil (g/g). Use 0 for oven-dry soil, or press "Measure it".');
      else if (input.w0 < 0) errors.push('Air-dry water content cannot be negative.');
      else if (input.w0 > 0.5) errors.push('Air-dry water content of ' + input.w0 + ' g/g is not realistic. Enter it as g/g, not % (e.g., 2.5% = 0.025).');
    }
    if (!input.densities.length) errors.push('Enter at least one bulk density.');
    if (!input.levels.length) errors.push('Enter at least one water content level.');
    input.densities.forEach(function (d) {
      if (!(d > 0)) errors.push('Bulk density must be positive (' + d + ').');
      else if (d >= input.rhoS) errors.push('Bulk density ' + d + ' g/cm³ is not possible with a particle density of ' + input.rhoS + ' g/cm³.');
      else if (d > 1.8) warnings.push('Bulk density ' + d + ' g/cm³ is unusually high (most packed soils are 0.8–1.8). Check the value; if it is right, use thinner layers.');
      else if (d < 0.8) warnings.push('Bulk density ' + d + ' g/cm³ is unusually low (most packed soils are 0.8–1.8). Check the value; if it is right, level the layers without pressing.');
    });
    if (input.unit === 'frac' && input.levels.some(function (x) { return typeof x === 'number' && x > 1; })) {
      errors.push('Enter water contents as fractions, not % (e.g., 20% = 0.20).');
    }
    if (input.levels.some(function (x) { return typeof x === 'number' && x < 0; })) {
      errors.push('Water contents cannot be negative.');
    }
    if (input.levels.indexOf('AD') !== -1 && input.soilState !== 'air') {
      warnings.push('"AD" (air-dry level) only applies to air-dry soil. With oven-dry soil it equals 0.');
    }
    if (errors.length) return { errors: errors, warnings: warnings, groups: [] };

    var groups = [];
    var tooLow = [];
    var overSat = [];
    var veryWet = [];

    input.densities.forEach(function (rhoB) {
      // Convert every level to volumetric water content at this bulk density
      var rows = input.levels.map(function (lv) {
        var theta, label;
        if (lv === 'AD') {
          theta = w0 * rhoB / RHO_W;
          label = 'AD';
        } else if (input.moistureType === 'grav') {
          theta = lv * scale * rhoB / RHO_W;
        } else {
          theta = lv * scale;
        }
        return { level: lv, label: label, theta: theta };
      });
      rows.sort(function (a, b) { return a.theta - b.theta; });

      var items = rows.map(function (row) {
        var c = container({ V: input.V, rhoB: rhoB, theta: row.theta, w0: w0, thetaMix: thetaMix, rhoS: input.rhoS });
        c.level = row.level;
        c.isAirDry = row.level === 'AD';
        if (c.water < -1e-9) { c.belowAirDry = true; tooLow.push(c); }
        if (c.saturation > 1.0001) overSat.push(c);
        else if (c.theta > 0.6) veryWet.push(c);
        c.layers = input.layerFractions.map(function (f) { return f * c.mix; });
        return c;
      });

      if (stepwise) {
        var prevW = w0;
        items.forEach(function (c) {
          c.stepWater = c.dry * (c.w - prevW);
          prevW = c.w;
        });
      }
      groups.push({ rhoB: rhoB, items: items });
    });

    if (tooLow.length) errors.push('Target' + (tooLow.length > 1 ? 's ' : ' ') + tooLow.map(function (c) { return 'θ ' + c.theta.toFixed(3) + ' (w ' + c.w.toFixed(3) + ')'; }).join(', ') + ' ' + (tooLow.length > 1 ? 'are' : 'is') + ' drier than your soil already is (' + w0.toFixed(3) + ' g/g). Use oven-dry soil for those levels. To include the air-dry soil itself as a level, type AD.');
    if (overSat.length) {
      errors.push('Some targets hold more water than the soil can (above saturation): ' + overSat.map(function (c) {
        return 'θ ' + c.theta.toFixed(3) + ' at ρb ' + c.rhoB + ' (porosity ' + c.porosity.toFixed(3) + ')';
      }).join('; ') + '.');
    }
    if (veryWet.length) {
      warnings.push('Volumetric water content above 0.6 is unusual for mineral soils (' +
        veryWet.map(function (c) { return c.theta.toFixed(2); }).join(', ') + '). Check the values.');
    }

    // Totals
    var totalSoil = 0, totalWater = 0, nContainers = 0;
    groups.forEach(function (g) {
      if (stepwise) {
        var last = g.items[g.items.length - 1];
        totalSoil += g.items[0].soil * reps;
        totalWater += last.water * reps;
        nContainers += reps;
      } else {
        g.items.forEach(function (c) {
          totalSoil += c.soil * reps;
          totalWater += c.water * reps;
          nContainers += reps;
        });
      }
    });

    return {
      errors: errors,
      warnings: warnings,
      groups: groups,
      w0: w0,
      reps: reps,
      stepwise: stepwise,
      hasTopUp: groups.some(function (g) { return g.items.some(function (c) { return c.waterTop > 0; }); }),
      totals: {
        containers: nContainers,
        treatments: groups.reduce(function (a, g) { return a + g.items.length; }, 0),
        soil: totalSoil,
        soilWithMargin: totalSoil * (1 + (input.margin || 0)),
        water: totalWater
      }
    };
  }

  var api = {
    RHO_W: RHO_W,
    parseList: parseList,
    frustumVolume: frustumVolume,
    geometry: geometry,
    airDryWaterContent: airDryWaterContent,
    container: container,
    plan: plan
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SoilCalc = api;
})(typeof window !== 'undefined' ? window : this);
