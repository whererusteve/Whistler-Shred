# Peak Rush

A snowboarding game on real mountains, in the spirit of the 3D stages in Sonic 3:
fast, behind-the-back, collect stars and hit jumps. It covers all of **Whistler Mountain**
(about 9 × 9.6 km): Creekside and the Village up to the Peak, Harmony, Symphony and Flute.

Three ways to ride (pick on the start screen):

- **Free ride** (default): drop in at Whistler Peak, the Roundhouse, Harmony Ridge, Symphony
  (Piccolo), Olympic, Creekside or the Village and ride anywhere. Stars and jumps are spread over
  the real open snow. A minimap shows where you are.
- **Peak to Creek**: the real run, traced from OpenStreetMap ski-run data (© OpenStreetMap
  contributors) shown on CalTopo: 5.6 km, 1,508 m vertical. `#peak-to-creek`
- **Peak to Village**: a line found along the real cleared runs (see Forest below): 6.4 km. `#whistler`

**Rider & board** (start screen): pick jacket or hoodie, pants, helmet or beanie, goggle lens, a face
mask (neck gaiter or balaclava), an avalanche airbag pack, stance, board colours and one of four boards. Each board changes the riding a little
(numbers in `BOARDS` in `js/outfit.js`):

| Board | Feel |
|---|---|
| All-mountain | the baseline |
| Park twin | quicker edge to edge, +30% spin speed, +15% pop, 15% less edge grip |
| Powder swallowtail | about 7% less drag (faster), a little more grip, slower edge to edge and spins |
| Carving board | 40% more edge grip (tighter turns at speed), slow spins |

Choices are saved on your device.

**Lifts**: 12 real lifts with towers, cables and moving chairs or gondola cabins: Whistler
Village Gondola (via Olympic), Fitzsimmons, Olympic Chair, Garbanzo, Emerald 6, Creekside
Gondola, Big Red, Kadenwood Gondola, Peak Express, Harmony 6, Symphony, and Peak 2 Peak (towards
Blackcomb). Stop near a bottom station and press **L** (or tap the red button) to ride to the top
(sped up to 25 m/s; Space or the Skip button jumps ahead). On chairs you sit facing up the line
with the board hanging off your front foot; on gondolas you stand in a glass cabin. Lift tops are also drop-in spots in free ride. Lift lines come from
CalTopo screenshots of OpenStreetMap data (`tools/traces/lifts.json`); station heights match
published values within about 20 m (Roundhouse 1,845 m, Peak 2,178 m, Piccolo 2,008 m, Olympic 1,028 m).

**Gnar points**: clean landings score for airtime (from 0.6 s: 1 s = 60, 2 s = 182, 3 s = 349)
and spins (180 = 150, 360 = 400, 540 = 750, 720 = 1,200, 900 = 1,800, 1080 = 2,500). Hold tuck in
the air for at least 0.4 s to grab the board (an Indy) for another 120. Land tricks
within 4 seconds of each other for a combo multiplier (×1.5, ×2 … up to ×4); a wipeout loses the
trick and the combo. Your best score per run is saved on your device. The numbers are in `GNAR`
at the top of the scoring section in `js/main.js`.

**Main menu**: the ☰ button (or Esc) pauses and opens the menu: resume, restart, change run or rider.


## Playing

**Play it:** https://whererusteve.github.io/Whistler-Shred/

Or run it locally with any static web server from this folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

| Keys | Touch | What it does |
|---|---|---|
| ← → or A D | ◀ ▶ | Tip the board onto an edge and carve; in the air, spin |
| Space | Jump | Hold to charge a bigger pop, release to jump |
| ↑ or W | Tuck | Less drag at speed; skate-push on flats; in the air, grab the board |
| ↓ or S | Brake | Hockey stop: swing the board across the hill and scrape off speed (← → picks the side) |
| R | ↺ | Restart from the top |

## Where the mountain comes from

`tools/build_course.py` builds everything from free, open data:

- **Elevation**: Mapzen "Terrarium" tiles on AWS Open Data (SRTM, Canadian CDEM and others),
  about 6 m per pixel here, smoothed slightly onto a 12.3 m game grid (`data/whistler.png`).
- **Forest**: two cloud-free Copernicus Sentinel-2 satellite images at 10 m detail: a sunny
  late-April image (trees hide the snow, so forest is dark and every run is a white line) and an
  August image (forest is green, roads/roofs/lakes aren't). Forest = dark in winter **and** green
  in summer, thinned out between 1,650 and 1,900 m (the real treeline). Saved as
  `data/whistler-forest.png`. This is what makes the real runs appear as clearings in the trees.
- **Peak to Creek line and Creekside buildings**: traced from CalTopo screenshots of OpenStreetMap
  data, aligned to the elevation data by matching contour lines (`tools/traces/`). The traced run
  sits in the satellite's clearing to within about 12 m.

- **Topo map lock**: the contour lines of the BC government 1:20,000 topo sheet 092J006 (20 m
  contours, a GeoPDF that says exactly where it sits on the ground) are read by
  `tools/topo_contours.py` into `tools/traces/whistler-contours.png`. The build then makes the
  terrain pass through every contour, filling in smoothly between them, and skips the extra
  smoothing it used before. Result: the terrain matches the map's contours to 1.5 m on average
  (worst 1%: 4.6 m; before: 3.1 m and 9.3 m), with sharper ridges and gullies. The sheet's south
  edge is at 50.112°N, so the strip north of that (the Village) keeps the plain elevation data.
  The topo sheet has no forest cover over the ski area (a private parcel), so the satellite
  images are used for the forest.

To rebuild: `python3 tools/build_course.py` (needs numpy and Pillow; the forest step also
needs `rasterio`). Add a course to `COURSES` with a start and finish (the line is computed),
a `trace` file of real lat/lon points, or `"mode": "free"` with drop-in spots.

## How it looks

All of this lives in `js/gfx.js`:

- **Sun and shadows**: the sun sits in the south-east, like a winter mid-morning (`SUN`). When the
  mountain loads, the game works out for every 6 m patch of ground whether a ridge or the forest
  blocks the sun there, so bowls, gullies and tree-lined runs get real shadows at no cost while
  you ride. Close to the rider (95 m, or 60 m on phones) a live shadow map adds crisp shadows
  for the rider, trees, lift towers and buildings.
- **Snow**: fine grain and wind drifts up close, a soft sheen and sparkles towards the sun, blue
  shadows, bare rock on steep faces. Your board leaves a track.
- **Distance**: you can see across the whole map (14 km; 6 km on phones) through thin blue haze,
  under a sky with a sun, high cloud and far ranges.
- **Trees**: tiered conifers with snow on the boughs, each a slightly different green.

Phones get a lighter version automatically. Add `?gfx=low` or `?gfx=high` to the address to choose.

## Performance

Only the trees within about 390 m of you are 3D (rebuilt as you move); further away the forest is
painted on the ground. Only stars within 450 m are drawn. Terrain is drawn at full detail up
to 450 m, then half, quarter and eighth detail further out.

## Files

```
index.html          page, HUD, touch buttons
css/game.css        look of the HUD and menus
js/main.js          scene, camera, controls, game loop
js/terrain.js       height lookups and the terrain mesh
js/gfx.js           sun, shadows, sky, snow surface, spray and board track
js/course.js        stars, jumps, trees, gates (LAYOUT numbers at the top)
js/buildings.js     Creekside and Kadenwood buildings from real footprints
js/trees.js         the forest near the rider, from the satellite forest map (trees 16-33 m tall, like the real coastal forest)
js/outfit.js        clothes, boards (shapes and handling) and the jointed rider figure
js/lifts.js         lifts: towers, cables, chairs and cabins, riding
js/rider.js         snowboard physics (PHYSICS numbers at the top) and how the rider's body moves
js/audio.js         synthesized sounds (no audio files)
tools/build_course.py   real elevation data → course files
tools/topo_contours.py  topo-map contours → tools/traces/whistler-contours.png
vendor/             three.js r170 (MIT licence)
```

## How the riding works (short version)

The numbers are in `PHYSICS` at the top of `js/rider.js`.

- Gravity pulls you down the slope; the snow pushes back so you stay on the surface.
- Steering tips the board onto an edge (about a fifth of a second from flat). An edged board
  follows its sidecut: the further it is tipped, the tighter the arc.
- An edge only holds so much. A clean carve grips up to about 1.3 times your weight, so the
  faster you go the wider the tightest turn gets: about 5 m across at 30 km/h, 30 m at
  70 km/h. To turn tighter than that you have to slow down first, as on a real hill.
- Hold a hard turn too long and the edge lets go. A sliding board has less than half the grip,
  so you wash out wide and lose speed until it bites again. Short, linked turns stay clean.
- Brake is a hockey stop: the board swings across your direction of travel and scrapes speed off.
  Let go and the nose swings back downhill.
- Toeside holds slightly better than heelside. The slope's own sideways pull counts too: turning
  up the hill is easier than turning down it.
- In the air a spin takes a moment to wind up and a moment to stop, and the board lands pointing
  wherever you left it. Land off-line and you skid; more than about 63° sideways, or harder than
  about a 7 m drop to flat, is a wipeout. Land backwards and you ride away switch.
- Friction and air drag slow you down; drag grows with speed squared, which sets top speed.

The rider is a jointed figure (`buildRiderModel` in `js/outfit.js`, moved by `updateModel` in
`js/rider.js`): knees and hips drop over the working edge, shoulders and head turn to look down
the hill, arms balance, legs soak up landings.

## Ideas for later

- More tricks for gnar points: more grabs, flips, buttering
- Lodges (Roundhouse, Rendezvous) and the Village buildings
- Run names on the HUD from traced run lines
- Village buildings (only Creekside and Kadenwood are traced so far)
