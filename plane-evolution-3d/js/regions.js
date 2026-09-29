'use strict';
/* ==========================================================================
   Regions: the 50 places a flight can pass through, and the per-flight map.

   Every flight deals a new map: region 1 is always a Common region, and each
   later region is drawn (without repeats) with odds that shift toward rarer
   tiers as the plane's core power grows. Region k is 400 * 1.25^k metres long,
   so each new area takes longer to reach than the last.

   A region is built from presets: a height style (h + hp), a ground paint (p +
   pal), vegetation and props (veg, forest), sky and weather (the same fields the
   2D BIOMES used), light, and extras: water, sky objects, lightning.
   No DOM and no three.js here, so Node can load it for tests.
   ========================================================================== */

const TIERS = [
  { name: 'Common', low: 60, high: 14 },     // % odds for a weak plane and for a maxed one
  { name: 'Uncommon', low: 25, high: 22 },
  { name: 'Rare', low: 10, high: 26 },
  { name: 'Epic', low: 4, high: 22 },
  { name: 'Legendary', low: 1, high: 16 },
];
const REGION_FIRST_LEN = 400, REGION_GROWTH = 1.25;

// light presets: sun colour/intensity, sky-fill colours and intensity, sun elevation, haze (1 = clear)
const LIGHTS = {
  day:      { sun: '#fff1d6', sunI: 2.3, sky: '#bcdcff', gnd: '#5a7a3a', hemI: 1.0,  elev: 0.62, haze: 1.0 },
  golden:   { sun: '#ffd49a', sunI: 2.2, sky: '#ffd8b0', gnd: '#6a5a3a', hemI: 0.95, elev: 0.35, haze: 0.9 },
  overcast: { sun: '#e6ebf0', sunI: 0.9, sky: '#c9d1db', gnd: '#6a6a48', hemI: 1.6,  elev: 0.9,  haze: 0.5 },
  mist:     { sun: '#e8ecee', sunI: 1.0, sky: '#d0d8dc', gnd: '#6a7060', hemI: 1.5,  elev: 0.7,  haze: 0.38 },
  hot:      { sun: '#ffe0ae', sunI: 2.6, sky: '#ffd6a0', gnd: '#b08850', hemI: 0.9,  elev: 0.42, haze: 0.95 },
  night:    { sun: '#c4d4ff', sunI: 1.5, sky: '#7890cc', gnd: '#a0acc8', hemI: 1.3,  elev: 0.5,  haze: 0.9 },
  dusk:     { sun: '#ff9a6a', sunI: 1.4, sky: '#8a6aa8', gnd: '#4a3a4a', hemI: 1.1,  elev: 0.18, haze: 0.8 },
  city:     { sun: '#9ab0ff', sunI: 0.9, sky: '#4a4a8a', gnd: '#2a2a3a', hemI: 1.2,  elev: 0.5,  haze: 0.75 },
  red:      { sun: '#ff8a50', sunI: 1.4, sky: '#9a3a20', gnd: '#3a1a10', hemI: 0.95, elev: 0.3,  haze: 0.55 },
  alien:    { sun: '#c8a8ff', sunI: 1.1, sky: '#6a48b0', gnd: '#3a2870', hemI: 1.05, elev: 0.45, haze: 0.8 },
  toxic:    { sun: '#d8ff8a', sunI: 1.2, sky: '#6a8a3a', gnd: '#2a3a1a', hemI: 1.1,  elev: 0.5,  haze: 0.45 },
  space:    { sun: '#ffffff', sunI: 2.8, sky: '#30305a', gnd: '#202028', hemI: 0.6,  elev: 0.4,  haze: 1.6 },
  mars:     { sun: '#ffe6d0', sunI: 2.2, sky: '#d09070', gnd: '#6a3020', hemI: 0.9,  elev: 0.45, haze: 1.1 },
  void:     { sun: '#b890ff', sunI: 1.0, sky: '#302050', gnd: '#100818', hemI: 0.8,  elev: 0.5,  haze: 1.3 },
};

// A few shared bases; each region below copies one and overrides what differs.
const SUN = { c: '#fff6c8', r: 34 }, HOTSUN = { c: '#fffbe8', r: 50 }, MOON = { c: '#eef3ff', r: 22 };
const BASES = {
  grass: { h: 'rolling', hp: { amp: 75, far: 1100, snow: 620 }, p: 'grass', pal: { g1: '#5c9c3c', g2: '#86bd5c', forest: '#2e5a26', rock: '#7f776b', path: '#8d7250' },
    veg: { oak: 0.03, bush: 0.07, flowers: 0.2, rock: 0.015 }, forest: { type: 'oak', dens: 0.55 },
    skyTop: '#3d8fe0', skyBot: '#c4e8ff', ground: '#6cc24a', dirt: '#4a8a32', cloud: '#ffffff', cover: 0.22, stars: 0, sun: SUN, weather: 'clear', light: 'day' },
  fields: { h: 'fields', hp: { amp: 22, back: 420 }, p: 'fields', pal: { crops: ['#c8ae4c', '#8ea53d', '#6d5838', '#d8c34a', '#a0ad4b', '#b8984a', '#7d9a3a', '#c9b86a'], hedge: '#4b6a2c', verge: '#8a9a42' },
    veg: { hay: 0.035, poplar: 0.01, windmill: 0.002, barn: 0.0015, fence: 0.08, bush: 0.01 },
    skyTop: '#62758f', skyBot: '#cfd6de', ground: '#b3bd4a', dirt: '#857f33', cloud: '#8a94a3', cover: 0.5, stars: 0, sun: null, weather: 'rain', light: 'overcast' },
  desert: { h: 'dunes', hp: { amp: 30, mesa: 1 }, p: 'sand', pal: { g1: '#edc978', g2: '#dcae68', strata: ['#b3683b', '#c98a4f', '#9c5634'] },
    veg: { cactus: 0.045, rock: 0.065, tumbleweed: 0.012 }, rockTint: '#b5824a',
    skyTop: '#e38f45', skyBot: '#ffe4ae', ground: '#edc978', dirt: '#c49a4e', cloud: '#fff0da', cover: 0.07, stars: 0, sun: HOTSUN, weather: 'dust', light: 'hot' },
  snow: { h: 'jagged', hp: { mt: 1500, drift: 28 }, p: 'snow', pal: { g1: '#e9f1f6', g2: '#cfdde8', rock: '#4e5967', ice: '#a9cde0' },
    veg: { pine: 0.025, icerock: 0.045, rock: 0.01 }, forest: { type: 'pine', dens: 0.45 }, rockTint: '#6f7c8c',
    skyTop: '#0f1a3e', skyBot: '#6d84b2', ground: '#eef5f8', dirt: '#b3c6d3', cloud: '#c3cfe3', cover: 0.28, stars: 0.85, aurora: true, moon: MOON, weather: 'snow', light: 'night' },
  volcano: { h: 'volcanic', hp: { mt: 420, cones: 1 }, p: 'lava', pal: { g1: '#4b3b38', g2: '#5a4a44', rock: '#221917', lava: [1.6, 0.42, 0.07], field: 0.45 },
    veg: { deadtree: 0.04, lavarock: 0.06, rock: 0.02 }, rockTint: '#3a2c29',
    skyTop: '#1d0a0c', skyBot: '#9a391f', ground: '#4b3b38', dirt: '#2a201e', cloud: '#4a3230', cover: 0.35, stars: 0.3, sun: { c: '#ff7a3a', r: 30 }, weather: 'ash', lightning: true, light: 'red' },
  city: { h: 'flat', hp: { amp: 2 }, p: 'asphalt', pal: { g1: '#5a5d62', g2: '#6a6d72', line: '#d8d0a0', lot: '#4a6a3a' },
    veg: { tower: 0.55, lamp: 0.06, bush: 0.02 }, windows: '#2a3440',
    skyTop: '#4a8ad0', skyBot: '#d0e0f0', ground: '#6a6d72', dirt: '#4a4d52', cloud: '#ffffff', cover: 0.3, stars: 0, sun: SUN, weather: 'clear', light: 'day' },
  town: { h: 'rolling', hp: { amp: 30, far: 700, snow: 9999 }, p: 'grass', pal: { g1: '#6a9a48', g2: '#8ab060', forest: '#3a6a30', rock: '#7f776b', path: '#8a7a62' },
    veg: { house: 0.4, oak: 0.03, bush: 0.05, lamp: 0.02, fence: 0.02 }, windows: '#2a3440',
    skyTop: '#3d8fe0', skyBot: '#c4e8ff', ground: '#6cc24a', dirt: '#4a8a32', cloud: '#ffffff', cover: 0.3, stars: 0, sun: SUN, weather: 'clear', light: 'day' },
  gorge: { h: 'gorge', hp: { mt: 900 }, p: 'rock', pal: { g1: '#6a6258', g2: '#7a7266', rock: '#4a443e', moss: '#4a6a3a' },
    veg: { rock: 0.06, pine: 0.01 }, rockTint: '#6a6258',
    skyTop: '#5a7aa0', skyBot: '#b8c8d8', ground: '#6a6258', dirt: '#4a443e', cloud: '#d0d8e0', cover: 0.35, stars: 0, sun: SUN, weather: 'clear', light: 'mist' },
  alien: { h: 'spires', hp: {}, p: 'veins', pal: { g1: '#7e5bc0', g2: '#5c3f9e', rock: '#2d1d5c', top: '#c9a8ff', veinA: [1.3, 0.3, 1.1], veinB: [0.2, 1.2, 0.9] },
    veg: { crystal: 0.045, mushroom: 0.04, glowplant: 0.095, spire: 0.012 },
    skyTop: '#0e0826', skyBot: '#5f3a9a', ground: '#7e5bc0', dirt: '#4a3383', cloud: '#9a7ad0', cover: 0.2, stars: 1, planet: true, weather: 'spores', light: 'alien' },
  moon: { h: 'craters', hp: { amp: 40 }, p: 'regolith', pal: { g1: '#8a8a8e', g2: '#6a6a70', rock: '#4a4a50', rim: '#a8a8ac' },
    veg: { rock: 0.05 }, rockTint: '#5a5a60',
    skyTop: '#000004', skyBot: '#0a0a14', ground: '#8a8a8e', dirt: '#5a5a60', cloud: '#303040', cover: 0, stars: 1, sun: { c: '#ffffff', r: 26 }, weather: 'none', light: 'space' },
};
const R = (key, name, tier, base, o = {}) => {
  const b = BASES[base], r = Object.assign({}, b, o, { key, name, tier, base });
  r.hp = Object.assign({}, b.hp, o.hp); r.pal = Object.assign({}, b.pal, o.pal);
  if (o.veg) r.veg = o.veg;
  r.light = LIGHTS[o.light || b.light];
  r.style = r.h; // the 2D field name, kept for anything that reads it
  return r;
};
const DUSK_SKY = { skyTop: '#2a2a6a', skyBot: '#f0906a' }, NIGHT_SKY = { skyTop: '#060818', skyBot: '#20284a', stars: 0.9 };
const REGIONS = [
  // ---- Common
  R('meadow', 'Verdant Meadow', 0, 'grass'),
  R('farm', 'Amber Farmlands', 0, 'fields'),
  R('vineyard', 'Rolling Vineyards', 0, 'fields', { pal: { crops: ['#5a7a32', '#6a8a3a', '#7a6a3a'], verge: '#8aa048' }, veg: { vine: 0.5, poplar: 0.015, house: 0.004 },
    skyTop: '#4a90d8', skyBot: '#e8f0ff', cloud: '#ffffff', cover: 0.18, sun: SUN, weather: 'clear', light: 'golden' }),
  R('birch', 'Birch Forest', 0, 'grass', { forest: { type: 'birch', dens: 0.7 }, veg: { birch: 0.06, bush: 0.08, flowers: 0.12 }, pal: { g1: '#86a848', g2: '#a8c062', forest: '#5a8a3a' }, ground: '#9ac058', skyBot: '#e8f4f0' }),
  R('moor', 'Misty Moorland', 0, 'grass', { hp: { amp: 45, far: 500, snow: 9999 }, pal: { g1: '#6a6a48', g2: '#7a5a6a', forest: '#5a4a5a' }, forest: null,
    veg: { bush: 0.12, rock: 0.04, flowers: 0.05 }, skyTop: '#7a8a9a', skyBot: '#c8d0d4', cloud: '#a8b0b8', cover: 0.55, sun: null, weather: 'rain', light: 'mist' }),
  R('coast', 'Coastal Cliffs', 0, 'grass', { h: 'coast', hp: { amp: 90 }, water: '#2a6a9a', veg: { bush: 0.08, flowers: 0.1, rock: 0.03 }, forest: null, cover: 0.3 }),
  R('lavender', 'Lavender Fields', 0, 'fields', { pal: { crops: ['#8a6ac8', '#9a7ad8', '#7a5ab8', '#a88ad0'], verge: '#7a9a48', hedge: '#4b6a2c' }, veg: { lavender: 0.35, house: 0.003, oak: 0.004 },
    skyTop: '#5a9ae0', skyBot: '#f0e8f8', cloud: '#ffffff', cover: 0.15, sun: SUN, weather: 'petals', light: 'golden' }),
  R('autumn', 'Autumn Woods', 0, 'grass', { forest: { type: 'autumn', dens: 0.65 }, veg: { autumn: 0.05, bush: 0.05, rock: 0.02 }, pal: { g1: '#8a8a3a', g2: '#a89a4a', forest: '#8a4a1a' },
    skyBot: '#f0e0c8', weather: 'leaves', light: 'golden' }),
  R('river', 'Riverside Plains', 0, 'grass', { h: 'river', hp: { amp: 40, far: 900, snow: 700 }, water: '#3a7aa8', veg: { oak: 0.02, bush: 0.06, flowers: 0.15, poplar: 0.01 } }),
  R('sunflower', 'Sunflower Country', 0, 'fields', { pal: { crops: ['#e8c030', '#d8b028', '#6a8a30', '#f0cc40'] }, veg: { sunflower: 0.4, barn: 0.002, windmill: 0.002 },
    skyTop: '#3a88e0', skyBot: '#d8ecff', cloud: '#ffffff', cover: 0.2, sun: HOTSUN, weather: 'clear', light: 'day' }),
  R('rice', 'Rice Terraces', 0, 'fields', { h: 'terraces', hp: { amp: 60 }, p: 'terraces', water: '#6a9a8a', pal: { g1: '#6aa040', g2: '#8ac058' }, veg: { bamboo: 0.02, bush: 0.03, house: 0.003 },
    skyTop: '#6a9ac8', skyBot: '#e0ecf0', cloud: '#ffffff', cover: 0.35, sun: SUN, weather: 'clear', light: 'mist' }),
  R('orchard', 'Spring Orchards', 0, 'grass', { hp: { amp: 35, far: 800, snow: 620 }, veg: { blossom: 0.06, flowers: 0.15, bush: 0.02 }, forest: { type: 'blossom', dens: 0.4 }, weather: 'petals' }),
  // ---- Uncommon
  R('desert', 'Sunscorch Desert', 1, 'desert'),
  R('canyon', 'Red Rock Canyon', 1, 'desert', { h: 'canyon', hp: { amp: 260 }, p: 'canyon', pal: { g1: '#c8784a', g2: '#b8683a', strata: ['#a84a2a', '#c86a3a', '#8a3a22'] },
    veg: { cactus: 0.02, rock: 0.07 }, rockTint: '#a85a32', skyTop: '#3a7ad0', skyBot: '#f8d8b8', weather: 'clear' }),
  R('tundra', 'Frostveil Tundra', 1, 'snow'),
  R('highlands', 'Pine Highlands', 1, 'grass', { hp: { amp: 160, far: 1600, snow: 420 }, forest: { type: 'fir', dens: 0.7 }, veg: { fir: 0.05, rock: 0.03, bush: 0.02 },
    pal: { g1: '#4a7a3a', g2: '#6a8a4a', forest: '#1e3a22' }, skyTop: '#4a7ab0', skyBot: '#d0dde8', cover: 0.35, weather: 'clear', light: 'mist' }),
  R('twilight', 'Twilight Valley', 1, 'grass', Object.assign({ forest: { type: 'fir', dens: 0.5 }, veg: { fir: 0.03, bush: 0.05, glowplant: 0.02, lamp: 0.004 },
    pal: { g1: '#3a5a4a', g2: '#4a6a5a', forest: '#1a2a2a' }, sun: null, moon: MOON, stars: 0.6, cloud: '#6a5a8a', cover: 0.3, weather: 'clear', light: 'dusk' }, DUSK_SKY)),
  R('rainforest', 'Rainforest Canopy', 1, 'grass', { hp: { amp: 110, far: 900, snow: 9999 }, forest: { type: 'jungle', dens: 0.85 }, veg: { jungle: 0.08, bush: 0.1, flowers: 0.05 },
    water: '#3a6a5a', pal: { g1: '#2a7a2a', g2: '#3a8a3a', forest: '#14401a' }, skyTop: '#5a8ab0', skyBot: '#d8e8e0', cloud: '#e8eef0', cover: 0.5, sun: null, weather: 'rain', light: 'mist' }),
  R('saltflats', 'Salt Flats', 1, 'desert', { h: 'flat', hp: { amp: 1.5 }, p: 'salt', pal: { g1: '#f2f0ea', g2: '#e0dcd0', crack: '#c8c0b0' }, veg: { rock: 0.004 }, rockTint: '#b0a898',
    skyTop: '#3a8ae8', skyBot: '#e8f4ff', ground: '#f2f0ea', cover: 0.05, weather: 'clear', light: 'hot' }),
  R('city', 'Daytime Cityscape', 1, 'city'),
  R('harbour', 'Harbour Town', 1, 'town', { h: 'coast', hp: { amp: 40 }, water: '#2a5a8a', veg: { house: 0.35, boat: 0.02, lamp: 0.03 }, cover: 0.3, cloud: '#ffffff' }),
  R('abandoned', 'Abandoned Town', 1, 'town', { veg: { ruin: 0.35, deadtree: 0.03, bush: 0.06, rock: 0.02 }, windows: '#1a1a1a', pal: { g1: '#7a7a4a', g2: '#8a8a5a', path: '#6a6050' },
    skyTop: '#7a8a9a', skyBot: '#d0d0c8', cloud: '#b0b0b0', cover: 0.45, sun: null, weather: 'clear', light: 'overcast' }),
  R('steppe', 'Stormy Steppe', 1, 'grass', { hp: { amp: 20, far: 600, snow: 9999 }, pal: { g1: '#a08a4a', g2: '#b8a060', forest: '#6a6a3a' }, ground: '#a89050', forest: null, veg: { bush: 0.03, rock: 0.02, tumbleweed: 0.004 },
    skyTop: '#3a4050', skyBot: '#8a9098', cloud: '#50565e', cover: 0.7, sun: null, weather: 'rain', lightning: true, light: 'overcast' }),
  R('bamboo', 'Bamboo Hills', 1, 'grass', { hp: { amp: 90, far: 900, snow: 9999 }, forest: { type: 'bamboo', dens: 0.8 }, veg: { bamboo: 0.08, bush: 0.04, rock: 0.02 },
    pal: { g1: '#6a9a3a', g2: '#8ab04a', forest: '#3a6a22' }, skyTop: '#7aa0c0', skyBot: '#e8f0e8', cover: 0.35, weather: 'clear', light: 'mist' }),
  // ---- Rare
  R('neon', 'Neon City at Night', 2, 'city', Object.assign({ veg: { tower: 0.6, lamp: 0.08 }, windows: 'neon', pal: { g1: '#2a2a34', g2: '#34343e', line: '#ff4fd8' },
    sun: null, moon: MOON, cloud: '#3a3050', cover: 0.3, weather: 'rain', light: 'city' }, NIGHT_SKY)),
  R('caverns', 'Deep Caverns', 2, 'gorge'),
  R('tunnels', 'Underground Tunnels', 2, 'gorge', { pal: { g1: '#7a6a58', g2: '#8a7a66', rock: '#5a4a3a' }, rockTint: '#7a6a58', skyTop: '#7a8aa0', skyBot: '#d0c8b8', light: 'golden' }),
  R('fjords', 'Glacier Fjords', 2, 'snow', { h: 'fjord', water: '#1a4a6a', sun: SUN, moon: null, aurora: false, stars: 0, skyTop: '#4a7ab8', skyBot: '#d8e8f4', weather: 'clear', light: 'day' }),
  R('southpole', 'South Pole Auroras', 2, 'snow', { h: 'flat', hp: { amp: 6 }, veg: { icerock: 0.03 }, forest: null, stars: 1, weather: 'snow' }),
  R('caldera', 'Ashen Caldera', 2, 'volcano'),
  R('swamp', 'Mushroom Swamp', 2, 'alien', { h: 'swamp', water: '#2a4a3a', p: 'swamp', pal: { g1: '#3a5a3a', g2: '#4a6a3a', rock: '#2a3a2a', veinA: [0.2, 1.1, 0.6], veinB: [0.9, 0.9, 0.2] },
    veg: { mushroom: 0.06, glowplant: 0.08, deadtree: 0.02 }, planet: false, stars: 0.4, skyTop: '#1a2a2a', skyBot: '#5a7a5a', cloud: '#4a5a4a', cover: 0.4, weather: 'spores', light: 'toxic' }),
  R('crystal', 'Crystal Caves', 2, 'gorge', { pal: { g1: '#5a5a7a', g2: '#6a6a8a', rock: '#3a3a5a' }, rockTint: '#5a5a7a', veg: { crystal: 0.06, rock: 0.04 },
    skyTop: '#3a3a7a', skyBot: '#b0b0e0', light: 'alien' }),
  R('ghosttown', 'Ghost Town at Dusk', 2, 'town', Object.assign({ veg: { ruin: 0.3, house: 0.08, deadtree: 0.05, lamp: 0.02 }, windows: '#ffb040', pal: { g1: '#4a4a3a', g2: '#5a5a48', path: '#5a5040' },
    sun: null, moon: MOON, stars: 0.5, cloud: '#5a4a6a', cover: 0.35, weather: 'clear', light: 'dusk' }, DUSK_SKY)),
  R('floating', 'Floating Islands', 2, 'grass', { hp: { amp: 60, far: 900, snow: 9999 }, veg: { island: 0.03, oak: 0.03, bush: 0.05, flowers: 0.15 }, skyTop: '#2a7ae8', skyBot: '#d8f0ff', cover: 0.45 }),
  R('ruins', 'Sandstorm Ruins', 2, 'desert', { veg: { column: 0.03, ruin: 0.02, rock: 0.05, cactus: 0.01 }, windows: '#1a1a1a', skyTop: '#c88a50', skyBot: '#e8c890', cover: 0.02, sun: { c: '#fff0d0', r: 40 }, weather: 'dust', light: 'hot' }),
  R('coral', 'Dry Coral Seabed', 2, 'desert', { h: 'dunes', p: 'sand', pal: { g1: '#e8dcc0', g2: '#d8ccb0' }, veg: { coral: 0.07, rock: 0.03 }, rockTint: '#c8b8a0',
    skyTop: '#3a9ad0', skyBot: '#c8f0f8', cloud: '#ffffff', cover: 0.2, weather: 'clear', light: 'day' }),
  // ---- Epic
  R('eruption', 'Volcanic Eruption', 3, 'volcano', { hp: { mt: 600, cones: 1 }, pal: { field: 0.8 }, erupting: true, skyTop: '#2a0806', skyBot: '#c8401a' }),
  R('alien', 'The Alien Expanse', 3, 'alien'),
  R('lunar', 'Lunar Surface', 3, 'moon', { objs: { earth: 1 } }),
  R('mars', 'Mars Plains', 3, 'moon', { hp: { amp: 80 }, pal: { g1: '#b8603a', g2: '#a0502e', rock: '#6a3020', rim: '#c8784a' }, rockTint: '#8a4028', skyTop: '#6a4a3a', skyBot: '#e0a078',
    stars: 0.2, cover: 0.05, cloud: '#e0b090', weather: 'dust', light: 'mars', sun: { c: '#fff4e8', r: 22 } }),
  R('europa', 'Frozen Moon', 3, 'moon', { p: 'ice', pal: { g1: '#d8e8f0', g2: '#b8d0e0', rock: '#8aa0b8', crack: '#c86a3a' }, rockTint: '#9ab0c8', objs: { gasgiant: 1 }, veg: { icerock: 0.04 } }),
  R('ringworld', 'Ringworld Arc', 3, 'grass', { hp: { amp: 50, far: 900, snow: 9999 }, objs: { ringarc: 1 }, skyTop: '#1a3a8a', skyBot: '#c0d8f0', stars: 0.3 }),
  R('asteroids', 'Asteroid Belt', 3, 'moon', { veg: { asteroid: 0.05, rock: 0.04 }, objs: { gasgiant: 1 }, stars: 1 }),
  R('toxic', 'Toxic Wasteland', 3, 'volcano', { h: 'craters', hp: { amp: 30 }, p: 'swamp', water: '#6a9a2a', pal: { g1: '#4a4a32', g2: '#5a5a3a', rock: '#2a2a1a', veinA: [0.5, 1.4, 0.1], veinB: [0.8, 1.2, 0.1] },
    veg: { barrel: 0.03, deadtree: 0.04, rock: 0.02 }, skyTop: '#2a3a1a', skyBot: '#8aa050', cloud: '#5a6a3a', cover: 0.5, sun: { c: '#e0ff80', r: 30 }, weather: 'ash', lightning: false, light: 'toxic' }),
  R('bloodmoon', 'Blood Moon Wastes', 3, 'desert', { h: 'dunes', pal: { g1: '#6a3a3a', g2: '#5a2e2e', strata: ['#4a2020', '#6a2a2a', '#3a1818'] }, veg: { deadtree: 0.03, rock: 0.05, column: 0.004 }, rockTint: '#4a2a2a',
    objs: { bloodmoon: 1 }, sun: null, skyTop: '#140406', skyBot: '#6a1a1a', stars: 0.6, cloud: '#3a1a1a', cover: 0.2, weather: 'ash', lightning: true, light: 'red' }),
  // ---- Legendary
  R('orbit', 'Outer Space (Orbit)', 4, 'moon', { h: 'flat', hp: { amp: 3 }, p: 'deck', pal: { g1: '#9aa0aa', g2: '#7a808a', line: '#40d0ff' }, veg: { dish: 0.004, lamp: 0.02 }, objs: { earth: 1 } }),
  R('nebula', 'Nebula Drift', 4, 'moon', { pal: { g1: '#5a4a7a', g2: '#4a3a6a', rock: '#2a1a4a', rim: '#8a6ac0' }, rockTint: '#5a3a8a', veg: { crystal: 0.03, asteroid: 0.015 }, objs: { nebula: 1 }, light: 'alien' }),
  R('blackhole', 'Event Horizon', 4, 'moon', { p: 'glass', pal: { g1: '#1a1418', g2: '#241a1e', rock: '#0a0808', lava: [1.8, 0.6, 0.15] }, veg: { asteroid: 0.02 }, objs: { blackhole: 1 }, light: 'void', sun: null }),
  R('quasar', 'Quasar Field', 4, 'moon', { pal: { g1: '#3a4a6a', g2: '#2a3a5a', rock: '#1a2a4a', rim: '#6a8ac0' }, rockTint: '#3a4a7a', veg: { crystal: 0.04 }, objs: { quasar: 1, nebula: 1 }, light: 'space' }),
  R('void', 'The Void Beyond', 4, 'moon', { p: 'glass', pal: { g1: '#0c0814', g2: '#140c20', rock: '#040208', lava: [0.9, 0.3, 1.6] }, veg: { spire: 0.01, crystal: 0.02 }, objs: { nebula: 0.4 }, stars: 0.5, light: 'void', sun: null, weather: 'spores' }),
];
const REGION = Object.fromEntries(REGIONS.map(r => [r.key, r]));

// Odds for each tier at a given core power (0..50): shifts from the "low" to the "high" column.
function tierOdds(corePower) {
  const p = clamp(corePower / 50, 0, 1), w = TIERS.map(t => lerp(t.low, t.high, p)), s = w.reduce((a, b) => a + b, 0);
  return w.map(v => v / s);
}
// Deal one flight's map. Returns placed copies of the regions with `at` set.
function dealMap(seed, corePower) {
  const r = rng(seed), odds = tierOdds(corePower), pool = REGIONS.slice(), out = [];
  const count = t => pool.filter(x => x.tier === t).length || 1;
  const pick = (first) => {
    const prev = out[out.length - 1];
    for (let attempt = 0; attempt < 4; attempt++) { // re-roll so two regions of the same kind rarely meet
      const cand = pool.filter(x => !first || x.tier === 0);
      let tot = 0; const w = cand.map(x => { const v = first ? 1 : odds[x.tier] / count(x.tier); tot += v; return v; });
      let u = r() * tot, i = 0; while (i < cand.length - 1 && u > w[i]) u -= w[i++];
      const c = cand[i];
      if (!prev || c.base !== prev.base || attempt === 3) return c;
    }
  };
  let at = 0;
  for (let k = 0; k < REGIONS.length; k++) {
    const c = pick(k === 0); pool.splice(pool.indexOf(c), 1);
    out.push(Object.assign({}, c, { at, len: REGION_FIRST_LEN * Math.pow(REGION_GROWTH, k) }));
    at += REGION_FIRST_LEN * Math.pow(REGION_GROWTH, k);
  }
  return out;
}
// Make a dealt map the current one: everything that reads BIOMES, biomeIndex and envAt follows it.
function useMap(map) { BIOMES = map; }

if (typeof module !== 'undefined') module.exports = { TIERS, REGIONS, REGION, LIGHTS, tierOdds, dealMap, useMap, REGION_FIRST_LEN, REGION_GROWTH };
