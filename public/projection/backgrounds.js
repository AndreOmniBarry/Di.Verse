// Di.Verse caption backgrounds: still colours/gradients, and live effects
// drawn on the graphics card (WebGL). Live effects are slow and soft on
// purpose, sit under a darkening layer so text stays readable, render at
// reduced resolution and 30 fps, and stop when nothing is on screen, so a
// laptop can run them through a long service.
(function () {
  // ── Still backgrounds (CSS) ──
  var STILL = [
    // Solids
    { id: 'navy', name: 'Midnight Navy', css: 'rgba(8,8,25,0.92)' },
    { id: 'black', name: 'Pure Black', css: 'rgba(0,0,0,0.92)' },
    { id: 'charcoal', name: 'Charcoal', css: 'rgba(28,28,32,0.92)' },
    { id: 'slate', name: 'Slate Blue', css: 'rgba(30,41,59,0.92)' },
    { id: 'royal', name: 'Royal Blue', css: 'rgba(23,37,84,0.93)' },
    { id: 'teal', name: 'Deep Teal', css: 'rgba(4,47,46,0.93)' },
    { id: 'forest', name: 'Forest', css: 'rgba(5,46,22,0.93)' },
    { id: 'burgundy', name: 'Burgundy', css: 'rgba(69,10,10,0.93)' },
    { id: 'plum', name: 'Plum', css: 'rgba(59,7,100,0.92)' },
    { id: 'espresso', name: 'Espresso', css: 'rgba(41,24,12,0.93)' },
    { id: 'white', name: 'Church White', css: 'rgba(255,255,255,0.94)', light: true },
    { id: 'ivory', name: 'Ivory', css: 'rgba(250,246,233,0.95)', light: true },
    // Gradients
    { id: 'ocean-g', name: 'Ocean Depth', css: 'linear-gradient(100deg, rgba(2,24,48,0.95), rgba(3,105,161,0.9))' },
    { id: 'lagoon-g', name: 'Lagoon', css: 'linear-gradient(100deg, rgba(6,78,59,0.95), rgba(8,145,178,0.9))' },
    { id: 'sunset-g', name: 'Sunset', css: 'linear-gradient(100deg, rgba(76,5,25,0.95), rgba(194,65,12,0.9))' },
    { id: 'sunrise-g', name: 'Sunrise', css: 'linear-gradient(100deg, rgba(49,46,129,0.95), rgba(219,39,119,0.85), rgba(251,146,60,0.85))' },
    { id: 'royal-g', name: 'Royal Purple', css: 'linear-gradient(100deg, rgba(30,27,75,0.95), rgba(109,40,217,0.9))' },
    { id: 'gold-g', name: 'Gold Leaf', css: 'linear-gradient(100deg, rgba(28,20,4,0.95), rgba(161,98,7,0.9))' },
    { id: 'emerald-g', name: 'Emerald', css: 'linear-gradient(100deg, rgba(2,44,34,0.95), rgba(16,185,129,0.85))' },
    { id: 'wine-g', name: 'Wine', css: 'linear-gradient(100deg, rgba(40,4,20,0.95), rgba(157,23,77,0.88))' },
    { id: 'steel-g', name: 'Steel', css: 'linear-gradient(100deg, rgba(15,23,42,0.95), rgba(71,85,105,0.9))' },
    { id: 'night-g', name: 'Night Sky', css: 'linear-gradient(180deg, rgba(2,6,23,0.96), rgba(30,58,138,0.9))' },
    { id: 'aurora-g', name: 'Aurora', css: 'linear-gradient(100deg, rgba(4,30,40,0.95), rgba(13,148,136,0.85), rgba(124,58,237,0.85))' },
    { id: 'rose-g', name: 'Rose Gold', css: 'linear-gradient(100deg, rgba(60,20,30,0.95), rgba(190,120,110,0.88))' },
    { id: 'olive-g', name: 'Olive Grove', css: 'linear-gradient(100deg, rgba(26,32,10,0.95), rgba(101,118,40,0.88))' },
    { id: 'ember-g', name: 'Ember', css: 'linear-gradient(100deg, rgba(20,4,4,0.96), rgba(153,27,27,0.9), rgba(234,88,12,0.8))' },
    { id: 'ice-g', name: 'Glacier', css: 'linear-gradient(100deg, rgba(8,47,73,0.95), rgba(125,211,252,0.75))' },
    { id: 'mono-g', name: 'Fade to Black', css: 'linear-gradient(0deg, rgba(0,0,0,0.95), rgba(0,0,0,0.55))' },
    { id: 'radial-ocean', name: 'Ocean Glow', css: 'radial-gradient(120% 160% at 20% 100%, rgba(14,165,233,0.85), rgba(2,24,48,0.96) 60%)' },
    { id: 'radial-gold', name: 'Golden Glow', css: 'radial-gradient(120% 160% at 15% 100%, rgba(234,179,8,0.7), rgba(20,14,2,0.96) 60%)' },
    { id: 'radial-purple', name: 'Violet Glow', css: 'radial-gradient(120% 160% at 85% 100%, rgba(168,85,247,0.75), rgba(17,8,40,0.96) 60%)' },
    { id: 'crystal-glass', name: 'Crystal Glass (see-through, best over camera)', css: 'linear-gradient(180deg, rgba(30,40,70,0.50), rgba(8,12,28,0.70))', glass: true },
    { id: 'ocean-glass', name: 'Ocean Glass (see-through)', css: 'linear-gradient(180deg, rgba(14,90,140,0.50), rgba(2,24,48,0.74))', glass: true },
    { id: 'royal-glass', name: 'Royal Glass (see-through)', css: 'linear-gradient(180deg, rgba(76,50,160,0.48), rgba(18,10,48,0.74))', glass: true },
    { id: 'gold-glass', name: 'Gold Glass (see-through)', css: 'linear-gradient(180deg, rgba(150,110,30,0.45), rgba(28,20,4,0.75))', glass: true },
    { id: 'emerald-glass', name: 'Emerald Glass (see-through)', css: 'linear-gradient(180deg, rgba(16,120,90,0.45), rgba(2,36,26,0.75))', glass: true },
    { id: 'frost', name: 'Frosted Glass', css: 'rgba(255,255,255,0.14)', glass: true },
    { id: 'smoke', name: 'Smoked Glass', css: 'rgba(0,0,0,0.38)', glass: true },
    { id: 'clear', name: 'No Background (text only)', css: 'transparent', clear: true },
  ];

  // ── Live effects: a shader + a colour palette (deep, mid, light) ──
  var P = {
    ocean: [[0.01, 0.10, 0.20], [0.02, 0.45, 0.62], [0.75, 0.95, 1.0]],
    lagoon: [[0.00, 0.16, 0.15], [0.02, 0.55, 0.52], [0.80, 1.0, 0.92]],
    glacier: [[0.02, 0.12, 0.22], [0.30, 0.62, 0.80], [0.92, 0.98, 1.0]],
    reef: [[0.00, 0.08, 0.14], [0.00, 0.35, 0.48], [0.55, 0.95, 0.85]],
    royal: [[0.05, 0.03, 0.18], [0.30, 0.16, 0.72], [0.85, 0.75, 1.0]],
    gold: [[0.08, 0.05, 0.01], [0.55, 0.36, 0.05], [1.0, 0.86, 0.45]],
    emerald: [[0.01, 0.10, 0.06], [0.04, 0.50, 0.32], [0.70, 1.0, 0.80]],
    wine: [[0.12, 0.01, 0.05], [0.55, 0.06, 0.25], [1.0, 0.65, 0.78]],
    sunrise: [[0.12, 0.04, 0.18], [0.80, 0.25, 0.35], [1.0, 0.75, 0.45]],
    midnight: [[0.01, 0.01, 0.05], [0.10, 0.16, 0.40], [0.65, 0.75, 1.0]],
    ember: [[0.08, 0.01, 0.01], [0.60, 0.12, 0.04], [1.0, 0.62, 0.25]],
    pearl: [[0.10, 0.11, 0.14], [0.45, 0.50, 0.58], [0.95, 0.97, 1.0]],
  };
  var LIVE = [
    // Clear water / ocean
    { id: 'crystal-ocean', name: 'Crystal Ocean (sunlit caustics)', fx: 'caustics', pal: 'ocean' },
    { id: 'lagoon-shallows', name: 'Lagoon Shallows', fx: 'caustics', pal: 'lagoon' },
    { id: 'glacier-water', name: 'Glacier Water', fx: 'caustics', pal: 'glacier' },
    { id: 'deep-reef', name: 'Deep Reef', fx: 'caustics', pal: 'reef' },
    { id: 'clear-stream', name: 'Clear Stream (flowing)', fx: 'stream', pal: 'lagoon' },
    { id: 'mountain-stream', name: 'Mountain Stream', fx: 'stream', pal: 'glacier' },
    { id: 'ocean-swell', name: 'Ocean Swell', fx: 'waves', pal: 'ocean' },
    { id: 'moonlit-tide', name: 'Moonlit Tide', fx: 'waves', pal: 'midnight' },
    { id: 'still-waters', name: 'Still Waters (ripples)', fx: 'ripple', pal: 'ocean' },
    { id: 'pool-ripples', name: 'Pool Ripples', fx: 'ripple', pal: 'lagoon' },
    // Liquid glass / silk
    { id: 'liquid-glass', name: 'Liquid Glass', fx: 'liquid', pal: 'pearl' },
    { id: 'liquid-ocean', name: 'Liquid Ocean Glass', fx: 'liquid', pal: 'ocean' },
    { id: 'liquid-gold', name: 'Liquid Gold', fx: 'liquid', pal: 'gold' },
    { id: 'liquid-royal', name: 'Liquid Royal', fx: 'liquid', pal: 'royal' },
    { id: 'silk-wine', name: 'Wine Silk', fx: 'silk', pal: 'wine' },
    { id: 'silk-emerald', name: 'Emerald Silk', fx: 'silk', pal: 'emerald' },
    { id: 'silk-midnight', name: 'Midnight Silk', fx: 'silk', pal: 'midnight' },
    // Light & sky
    { id: 'aurora-borealis', name: 'Aurora Borealis', fx: 'aurora', pal: 'emerald' },
    { id: 'aurora-royal', name: 'Royal Aurora', fx: 'aurora', pal: 'royal' },
    { id: 'heaven-rays', name: 'Heavenly Rays', fx: 'rays', pal: 'gold' },
    { id: 'dawn-rays', name: 'Dawn Rays', fx: 'rays', pal: 'sunrise' },
    { id: 'starfield', name: 'Quiet Starfield', fx: 'stars', pal: 'midnight' },
    { id: 'golden-stars', name: 'Golden Stars', fx: 'stars', pal: 'gold' },
    { id: 'soft-clouds', name: 'Soft Clouds', fx: 'clouds', pal: 'pearl' },
    { id: 'sunset-clouds', name: 'Sunset Clouds', fx: 'clouds', pal: 'sunrise' },
    // Bokeh & glow
    { id: 'bokeh-gold', name: 'Golden Bokeh', fx: 'bokeh', pal: 'gold' },
    { id: 'bokeh-ocean', name: 'Ocean Bokeh', fx: 'bokeh', pal: 'ocean' },
    { id: 'bokeh-royal', name: 'Royal Bokeh', fx: 'bokeh', pal: 'royal' },
    { id: 'ember-glow', name: 'Ember Glow', fx: 'bokeh', pal: 'ember' },
    // Mesh gradients
    { id: 'mesh-ocean', name: 'Ocean Mesh Gradient', fx: 'mesh', pal: 'ocean' },
    { id: 'mesh-sunrise', name: 'Sunrise Mesh Gradient', fx: 'mesh', pal: 'sunrise' },
    { id: 'mesh-royal', name: 'Royal Mesh Gradient', fx: 'mesh', pal: 'royal' },
    { id: 'mesh-emerald', name: 'Emerald Mesh Gradient', fx: 'mesh', pal: 'emerald' },
    { id: 'mesh-wine', name: 'Wine Mesh Gradient', fx: 'mesh', pal: 'wine' },
  ];

  // ── Shaders (GLSL ES 1.0) ──
  var COMMON = [
    'precision mediump float;',
    'uniform vec2 R; uniform float T; uniform vec3 C1, C2, C3;',
    'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p + n)); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }',
    // Distance to the nearest edge between moving cells: bright thin lines like sunlight on a pool floor
    'float cellEdge(vec2 p, float t){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;',
    '  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x), float(y));',
    '    vec2 o = 0.5 + 0.45 * sin(t + 6.2831 * h22(i + g)); float d = length(g + o - f);',
    '    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d; }',
    '  return d2 - d1; }',
  ].join('\n');

  var FX = {
    caustics: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / R.y * 3.2;',
      '  float t = T * 0.35;',
      '  vec2 w = vec2(fbm(p * 0.6 + t * 0.2), fbm(p * 0.6 - t * 0.15)) * 0.8;',
      '  float e1 = cellEdge(p + w, t), e2 = cellEdge(p * 1.6 - w + 3.1, t * 1.3);',
      '  float c = pow(1.0 - smoothstep(0.0, 0.24, e1), 2.5) * 0.6 + pow(1.0 - smoothstep(0.0, 0.18, e2), 2.5) * 0.35;',
      '  vec3 water = mix(C1, C2, uv.y * 0.8 + 0.15 * fbm(p * 0.5 + t * 0.1));',
      '  vec3 col = water + C3 * c * 0.38;',
      '  col += C3 * 0.08 * pow(uv.y, 3.0);',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    stream: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / R.y * 2.5;',
      '  float t = T * 0.5; p.x -= t * 0.6;',
      '  vec2 w = vec2(fbm(p + vec2(0.0, t * 0.1)), fbm(p * 1.3 + 5.0)) ;',
      '  float flow = fbm(p * vec2(0.6, 2.2) + w * 1.2);',
      '  float e = cellEdge(p * vec2(1.0, 1.8) + w, T * 0.6);',
      '  float glint = pow(1.0 - smoothstep(0.0, 0.1, e), 4.0);',
      '  vec3 col = mix(C1, C2, flow * 0.9 + uv.y * 0.25) + C3 * glint * 0.22 + C3 * 0.10 * smoothstep(0.55, 0.9, flow);',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    waves: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; float t = T * 0.25; vec3 col = C1;',
      '  for (int i = 0; i < 5; i++){ float fi = float(i);',
      '    float y = 0.25 + fi * 0.14 + 0.05 * sin(uv.x * (3.0 + fi) + t * (1.0 + fi * 0.3) + fi) + 0.03 * sin(uv.x * 9.0 - t * 1.7 + fi * 2.0);',
      '    float band = smoothstep(y + 0.02, y - 0.06, uv.y);',
      '    col = mix(col, mix(C2, C3, fi / 6.0), band * 0.22); }',
      '  col += C3 * 0.06 * vnoise(uv * vec2(40.0, 6.0) + vec2(t * 2.0, 0.0));',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    ripple: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = (gl_FragCoord.xy - 0.5 * R) / R.y; float t = T * 0.6; float h = 0.0;',
      '  for (int i = 0; i < 3; i++){ float fi = float(i);',
      '    vec2 c = vec2(sin(fi * 2.1 + floor((t + fi * 3.0) / 9.0) * 1.7) * 0.9, cos(fi * 1.3 + floor((t + fi * 3.0) / 9.0) * 2.3) * 0.25);',
      '    float age = mod(t + fi * 3.0, 9.0); float d = length(p - c);',
      '    h += sin(d * 28.0 - age * 4.0) * exp(-d * 3.0) * smoothstep(age * 0.25 + 0.15, age * 0.25, d) * (1.0 - age / 9.0); }',
      '  vec3 col = mix(C1, C2, uv.y * 0.7 + 0.15 * fbm(p * 2.0 + t * 0.05));',
      '  col += C3 * max(h, 0.0) * 0.35;',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    liquid: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / R.y * 0.9; float t = T * 0.1;',
      '  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));',
      '  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.7), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.5));',
      '  float f = fbm(p + 3.0 * r);',
      '  vec3 col = mix(C1, C2, clamp(f * 1.4, 0.0, 1.0));',
      '  col = mix(col, C3, pow(clamp(length(q) * 0.9 - 0.25, 0.0, 1.0), 3.0) * 0.6);',
      '  float spec = pow(clamp(1.0 - abs(f - 0.62) * 9.0, 0.0, 1.0), 6.0);',
      '  col += C3 * spec * 0.1;',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    silk: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / R.y; float t = T * 0.15;',
      '  float f = fbm(p * 1.2 + vec2(t, -t * 0.5));',
      '  float folds = sin((p.x * 2.2 + p.y * 1.4 + f * 3.5 + t) * 3.1415);',
      '  float shade = 0.5 + 0.5 * folds;',
      '  vec3 col = mix(C1, C2, shade * 0.8 + uv.y * 0.15);',
      '  col += C3 * pow(shade, 12.0) * 0.25;',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    aurora: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; float t = T * 0.1; vec3 col = C1;',
      '  for (int i = 0; i < 3; i++){ float fi = float(i);',
      '    float x = uv.x * (1.5 + fi * 0.5) + t * (0.6 + fi * 0.2);',
      '    float curtain = fbm(vec2(x, fi * 3.0 + t * 0.3));',
      '    float y0 = 0.35 + curtain * 0.4;',
      '    float glow = exp(-pow((uv.y - y0) * 5.0, 2.0)) * smoothstep(0.2, 0.8, fbm(vec2(x * 4.0, t + fi)));',
      '    col += mix(C2, C3, fi / 3.0) * glow * 0.45; }',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    rays: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 o = vec2(0.25, 1.4); vec2 d = uv - o; float t = T * 0.12;',
      '  float a = atan(d.x, -d.y);',
      '  float r = 0.5 + 0.5 * sin(a * 18.0 + fbm(vec2(a * 6.0, t)) * 4.0);',
      '  r *= smoothstep(1.8, 0.2, length(d));',
      '  vec3 col = mix(C1, C2, uv.y * 0.6) + C3 * r * 0.22;',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    stars: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / 9.0; vec2 i = floor(p), f = fract(p);',
      '  float n = h21(i); float star = step(0.985, n) * (0.5 + 0.5 * sin(T * (0.6 + n * 2.0) + n * 60.0));',
      '  star *= smoothstep(0.35, 0.0, length(f - 0.5));',
      '  vec3 col = mix(C1, C2 * 0.6, uv.y * 0.5 + 0.2 * fbm(uv * 3.0 + T * 0.02)) + C3 * star;',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    clouds: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / R.y * 2.0; float t = T * 0.04;',
      '  float c = fbm(p + vec2(t, 0.0)) * 0.6 + fbm(p * 2.0 - vec2(t * 1.5, 0.0)) * 0.4;',
      '  vec3 col = mix(C1, C2, uv.y * 0.6) ; col = mix(col, C3, smoothstep(0.45, 0.85, c) * 0.35);',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    bokeh: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; vec2 p = gl_FragCoord.xy / R.y; vec3 col = mix(C1, C2 * 0.5, uv.y * 0.5); float t = T * 0.05;',
      '  for (int i = 0; i < 14; i++){ float fi = float(i);',
      '    vec2 c = vec2(fract(h21(vec2(fi, 1.0)) + t * (0.2 + h21(vec2(fi, 2.0)) * 0.3)) * (R.x / R.y), h21(vec2(fi, 3.0)) + 0.05 * sin(T * 0.3 + fi));',
      '    float r = 0.05 + 0.12 * h21(vec2(fi, 4.0)); float d = length(p - c);',
      '    col += mix(C2, C3, h21(vec2(fi, 5.0))) * smoothstep(r, r * 0.6, d) * 0.12; }',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
    mesh: [
      'void main(){ vec2 uv = gl_FragCoord.xy / R; float t = T * 0.08;',
      '  vec2 a = vec2(0.2 + 0.15 * sin(t), 0.3 + 0.2 * cos(t * 1.3)), b = vec2(0.8 + 0.1 * cos(t * 0.9), 0.7 + 0.2 * sin(t * 1.1)), c = vec2(0.5 + 0.3 * sin(t * 0.7), 0.1 + 0.15 * cos(t));',
      '  float wa = 1.0 / (0.02 + dot(uv - a, uv - a)), wb = 1.0 / (0.02 + dot(uv - b, uv - b)), wc = 1.0 / (0.02 + dot(uv - c, uv - c));',
      '  vec3 col = (C1 * wa + C2 * wb + mix(C2, C3, 0.5) * wc * 0.6) / (wa + wb + wc * 0.6);',
      '  col += (h21(gl_FragCoord.xy + T) - 0.5) * 0.015;',
      '  gl_FragColor = vec4(col, 1.0); }',
    ],
  };

  var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

  // One renderer per box (lower third / full screen)
  function Renderer(canvas, scale) {
    this.canvas = canvas;
    this.scale = scale;
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    this.programs = {};
    this.effect = null;
    this.running = false;
    this.last = 0;
    if (!this.gl) return;
    var gl = this.gl;
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var self = this;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.programs = {}; });
    canvas.addEventListener('webglcontextrestored', function () { Renderer.call(self, canvas, scale); if (self.effect) self.start(self.effect); });
  }

  Renderer.prototype.program = function (fx) {
    var gl = this.gl;
    if (this.programs[fx]) return this.programs[fx];
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[Backgrounds] ' + fx + ': ' + gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, COMMON + '\n' + FX[fx].join('\n'));
    if (!v || !f) return null;
    var p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[Backgrounds] link ' + fx); return null; }
    var prog = { p: p, a: gl.getAttribLocation(p, 'a'), R: gl.getUniformLocation(p, 'R'), T: gl.getUniformLocation(p, 'T'),
      C1: gl.getUniformLocation(p, 'C1'), C2: gl.getUniformLocation(p, 'C2'), C3: gl.getUniformLocation(p, 'C3') };
    this.programs[fx] = prog;
    return prog;
  };

  Renderer.prototype.start = function (effect) {
    this.effect = effect;
    if (!this.gl || !this.program(effect.fx)) return false;
    if (!this.running) { this.running = true; this.loop(); }
    return true;
  };

  Renderer.prototype.stop = function () { this.running = false; };

  Renderer.prototype.loop = function () {
    var self = this;
    if (!this.running) return;
    requestAnimationFrame(function (now) {
      if (!self.running) return;
      // 30 fps is plenty for slow motion and halves the work
      if (now - self.last >= 33) { self.last = now; self.draw(now / 1000); }
      self.loop();
    });
  };

  Renderer.prototype.draw = function (t) {
    var gl = this.gl, c = this.canvas, e = this.effect, prog = this.program(e.fx);
    if (!prog) return;
    var w = Math.max(2, Math.round(c.clientWidth * this.scale)), h = Math.max(2, Math.round(c.clientHeight * this.scale));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.enableVertexAttribArray(prog.a);
    gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0);
    var pal = P[e.pal];
    gl.uniform2f(prog.R, w, h);
    gl.uniform1f(prog.T, t);
    gl.uniform3fv(prog.C1, pal[0]); gl.uniform3fv(prog.C2, pal[1]); gl.uniform3fv(prog.C3, pal[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  function rgb(c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; }

  window.DiVerseBackgrounds = {
    STILL: STILL,
    LIVE: LIVE,
    find: function (id) {
      for (var i = 0; i < STILL.length; i++) if (STILL[i].id === id) return { kind: 'still', bg: STILL[i] };
      for (var j = 0; j < LIVE.length; j++) if (LIVE[j].id === id) return { kind: 'live', bg: LIVE[j] };
      return null;
    },
    // CSS stand-in for a live effect (shown if WebGL is unavailable)
    fallbackCss: function (live) { var p = P[live.pal]; return 'linear-gradient(100deg, ' + rgb(p[0]) + ', ' + rgb(p[1]) + ')'; },
    // Slowly drifting CSS version of a live effect (vMix: no WebGL needed)
    driftCss: function (live, seeThrough) {
      // a little darker than the palette, so white scripture stays crisp
      var p = P[live.pal], k = seeThrough ? 0.86 : 1;
      var c = function (v, d) { return 'rgba(' + v.map(function (x) { return Math.round(x * 255 * d); }).join(',') + ',' + k + ')'; };
      return 'linear-gradient(100deg, ' + c(p[0], 1) + ', ' + c(p[1], 0.8) + ' 35%, ' + c(p[0], 0.9) + ' 55%, ' + c(p[1], 0.8) + ' 75%, ' + c(p[0], 1) + ')';
    },
    Renderer: Renderer,
    _fx: FX,
  };
})();
