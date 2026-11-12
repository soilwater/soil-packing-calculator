# soil-packing-calculator
A web app to help people working in soil physics labs to calculate the proportions of soil and water in packed soil columns.

## Use
Open `index.html` in any browser. No install, no internet connection, no build step (vanilla HTML, CSS, and JS).

1. **Container**: cylinder or box, inside dimensions and fill height (cm).
2. **Targets**: one or more bulk densities and one or more water content levels (volumetric or gravimetric, as fractions). Every density is combined with every level.
3. **Soil and packing**: water content of the dry soil (0 if oven-dried; a pop-up computes it from three oven-dried cans), number of layers, replicates.

Press **Calculate** to get the soil and water per container, the mass per layer, totals to prepare, six short steps, and a CSV export. Inputs are remembered in the browser.

`js/calc.js` also supports tapered pots, step-by-step wetting, and top-up water for very wet levels; these are not exposed in the interface yet.

## Equations
- Oven-dry soil: Ms = ρb · V
- w = θ · ρw / ρb
- Soil to weigh: Ms (1 + w₀); water to add: Ms (w − w₀); moist mix: Ms (1 + w)
- Saturation check: θ / (1 − ρb / ρs)
- Tapered pots: layers of equal thickness hold different volumes, so each layer gets its own mass.

## Files
- `index.html`: page
- `css/styles.css`: styles (light/dark, print)
- `js/calc.js`: calculations (no DOM; testable with Node)
- `js/app.js`: interface
