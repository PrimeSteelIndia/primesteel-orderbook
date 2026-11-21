/* ============================================================================
   PRIME STEEL — "Suspended Steel" study 01
   A dependency-free WebGL2 raymarcher. A wound steel coil, a sheet and a pipe
   are held in equilibrium over a paper infinity cove. Studio softboxes are
   modelled as directional lobes in the environment, so the brushed metal
   picks up a warm paper bounce and one orange kicker.

   No libraries. No external assets. Falls back to CSS when WebGL is absent.
   ========================================================================== */

(function () {
  "use strict";

  var canvas = document.getElementById("scene");
  if (!canvas) return;

  var root = document.documentElement;
  var hero = document.getElementById("hero");
  var reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  var gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      desynchronized: true
    });
  } catch (err) {
    gl = null;
  }

  function fallback() {
    root.classList.add("no-webgl");
  }

  if (!gl) {
    fallback();
    return;
  }

  /* -- shaders ------------------------------------------------------------- */

  var VERT = [
    "#version 300 es",
    "const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));",
    "void main(){ gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "#version 300 es",
    "precision highp float;",
    "",
    "uniform vec2  uRes;",
    "uniform float uTime;",
    "uniform vec2  uPointer;",
    "uniform float uShift;",
    "",
    "out vec4 outColor;",
    "",
    "const vec3 PAPER = vec3(0.930, 0.917, 0.892);",
    "const vec3 KEY   = normalize(vec3(-0.52, 0.76, 0.46));",
    "",
    "mat2 r2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }",
    "",
    "float hash12(vec2 p){",
    "  vec3 p3 = fract(vec3(p.xyx) * 0.1031);",
    "  p3 += dot(p3, p3.yzx + 33.33);",
    "  return fract((p3.x + p3.y) * p3.z);",
    "}",
    "",
    "float sdRoundBox(vec3 p, vec3 b, float r){",
    "  vec3 q = abs(p) - b + r;",
    "  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;",
    "}",
    "float sdCyl(vec3 p, float h, float r){",
    "  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);",
    "  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));",
    "}",
    "float smin(float a, float b, float k){",
    "  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);",
    "  return mix(b, a, h) - k*h*(1.0 - h);",
    "}",
    "float smax(float a, float b, float k){ return -smin(-a, -b, k); }",
    "",
    "/* 1 coil · 2 pipe · 3 sheet */",
    "vec2 scene(vec3 p){",
    "  float t = uTime;",
    "  float bound = length(p - vec3(2.16, 0.16, 0.05)) - 2.30;",
    "  if (bound > 0.28) return vec2(bound, 0.0);",
    "",
    "  vec2 res = vec2(1e9, 0.0);",
    "  float narrowObj = smoothstep(1.22, 0.70, uRes.x / uRes.y);",
    "",
    "  // 01 — coil: a wound annular cylinder, faces turned to the viewer",
    "  vec3 q = p - vec3(2.62, 0.24 + 0.035*sin(t*0.40), -0.12);",
    "  q.xz = r2(0.10 + 0.055*sin(t*0.16)) * q.xz;",
    "  q.xy = r2(0.05*sin(t*0.23 + 1.0)) * q.xy;",
    "  q.yz = r2(-1.045 + 0.030*sin(t*0.19)) * q.yz;",
    "  float outer = sdCyl(q, 0.400, 1.000);",
    "  float bore  = sdCyl(q, 0.424, 0.400);",
    "  float d = smax(outer, -bore, 0.016) - 0.008;",
    "  float ang = atan(q.z, q.x);",
    "  d -= 0.0018 * sin(length(q.xz) * 92.0);   // wound layers",
    "  if (d < res.x) res = vec2(d, 1.0);",
    "",
    "  // 03 — sheet: a thin plate suspended below",
    "  if (narrowObj < 0.5) {",
    "  vec3 q3 = p - vec3(1.72, -0.760 + 0.032*sin(t*0.50 + 2.2), 0.42);",
    "  q3.xz = r2(-0.38 + 0.055*sin(t*0.19 + 0.4)) * q3.xz;",
    "  q3.yz = r2(0.14) * q3.yz;",
    "  q3.xy = r2(-0.05) * q3.xy;",
    "  vec3 sb = vec3(0.600, 0.017, 0.380);",
    "  d = sdRoundBox(q3, sb, 0.008);",
    "  d = min(d, sdRoundBox(q3 - vec3(0.016, 0.030, 0.010), sb, 0.008));",
    "  d = min(d, sdRoundBox(q3 - vec3(0.032, 0.060, 0.020), sb, 0.008));",
    "  if (d < res.x) res = vec2(d, 3.0);",
    "  }",
    "",
    "  // 02 — pipe: a tube crossing above the coil's shoulder",
    "  if (narrowObj < 0.5) {",
    "  vec3 q2 = p - vec3(2.86, 1.185 + 0.028*sin(t*0.31 + 4.1), -1.45);",
    "  q2.xz = r2(-0.16) * q2.xz;",
    "  q2.xy = r2(1.500 + 0.020*sin(t*0.17)) * q2.xy;",
    "  float shell  = sdCyl(q2, 1.640, 0.092);",
    "  float cavity = sdCyl(q2, 1.720, 0.076);",
    "  d = max(shell, -cavity) - 0.003;",
    "  if (d < res.x) res = vec2(d, 2.0);",
    "  }",
    "",
    "  return res;",
    "}",
    "",
    "float mapObjects(vec3 p){ return scene(p).x; }",
    "",
    "vec3 calcNormal(vec3 p, float e){",
    "  vec2 k = vec2(1.0, -1.0);",
    "  return normalize(",
    "    k.xyy * mapObjects(p + k.xyy*e) +",
    "    k.yyx * mapObjects(p + k.yyx*e) +",
    "    k.yxy * mapObjects(p + k.yxy*e) +",
    "    k.xxx * mapObjects(p + k.xxx*e)",
    "  );",
    "}",
    "",
    "/* A warm infinity cove with one broad keybox, one cool rim strip and a low",
    "   orange kicker. Reflections read as a product studio, not a chrome ball. */",
    "vec3 envMap(vec3 d){",
    "  float y = d.y;",
    "  vec3 col = mix(vec3(0.330, 0.320, 0.302), vec3(0.995, 0.978, 0.946), smoothstep(-0.34, 0.94, y));",
    "  col = mix(col, vec3(0.66, 0.638, 0.596), smoothstep(0.02, -0.58, y));",
    "",
    "  float k = smoothstep(0.795, 0.998, dot(d, normalize(vec3(-0.48, 0.74, 0.47))));",
    "  col += vec3(1.85, 1.78, 1.66) * k;",
    "",
    "  float r = smoothstep(0.900, 0.999, dot(d, normalize(vec3(0.92, 0.24, -0.30))));",
    "  col += vec3(0.82, 0.87, 0.94) * r * 0.9;",
    "",
    "  float o = smoothstep(0.860, 0.999, dot(d, normalize(vec3(0.52, -0.30, 0.58))));",
    "  col += vec3(1.00, 0.36, 0.11) * o * 0.80;",
    "",
    "  float f = smoothstep(0.900, 0.999, dot(d, normalize(vec3(-0.30, 0.22, 0.95))));",
    "  col += vec3(0.92, 0.900, 0.860) * f * 1.05;",
    "",
    "  float f2 = smoothstep(0.930, 0.999, dot(d, normalize(vec3(0.42, -0.08, 0.90))));",
    "  col += vec3(0.55, 0.545, 0.530) * f2 * 0.65;",
    "",
    "  return col;",
    "}",
    "",
    "float softShadow(vec3 ro, vec3 rd){",
    "  float res = 1.0;",
    "  float t = 0.03;",
    "  for (int i = 0; i < 24; i++){",
    "    float h = mapObjects(ro + rd * t);",
    "    res = min(res, 9.0 * h / t);",
    "    t += clamp(h, 0.03, 0.32);",
    "    if (res < 0.004 || t > 4.5) break;",
    "  }",
    "  return clamp(res, 0.0, 1.0);",
    "}",
    "",
    "float ambientOcclusion(vec3 p, vec3 n){",
    "  float occ = 0.0;",
    "  float sca = 1.0;",
    "  for (int i = 0; i < 5; i++){",
    "    float h = 0.030 + 0.105 * float(i);",
    "    occ += (h - mapObjects(p + n * h)) * sca;",
    "    sca *= 0.72;",
    "  }",
    "  return clamp(1.0 - 1.42 * occ, 0.0, 1.0);",
    "}",
    "",
    "vec3 steel(vec3 p, vec3 n, vec3 rd, float id, float rough){",
    "  // anisotropic brushing, aligned per object",
    "  float a = id * 2.37 + 0.4;",
    "  vec3 tang = normalize(cross(n, normalize(vec3(cos(a), 0.42, sin(a)))));",
    "  float brush = (hash12(p.xz * 190.0) - 0.5) * 0.020",
    "              + sin(dot(p, tang) * 620.0) * 0.0075",
    "              + sin(dot(p, tang) * 131.0) * 0.0030;",
    "  n = normalize(n + tang * brush * (0.55 + 0.85 * rough));",
    "",
    "  vec3 refl = reflect(rd, n);",
    "  vec3 env = envMap(refl);",
    "  vec3 soft = envMap(normalize(mix(refl, n, 0.45 + rough * 0.55)));",
    "  env = mix(env, soft, 0.30 + rough * 0.62);",
    "",
    "  float ndv  = clamp(dot(-rd, n), 0.0, 1.0);",
    "  float fres = pow(1.0 - ndv, 4.0);",
    "",
    "  vec3 base = vec3(0.505, 0.512, 0.522);",
    "  vec3 col  = base * (0.145 + 0.320 * max(dot(n, KEY), 0.0));",
    "  col += env * (0.335 + 0.330 * fres);",
    "",
    "  vec3 h = normalize(KEY - rd);",
    "  col += vec3(1.0, 0.985, 0.95) * pow(max(dot(n, h), 0.0), 190.0) * (1.05 - rough * 0.6);",
    "",
    "  float occ = ambientOcclusion(p, n);",
    "  float sh  = softShadow(p + n * 0.006, KEY);",
    "  col *= mix(0.60, 1.0, clamp(occ * sh, 0.0, 1.0));",
    "",
    "  // warm paper bounce on the undersides",
    "  col += vec3(0.115, 0.096, 0.072) * clamp(0.42 - n.y * 0.62, 0.0, 1.0);",
    "",
    "  return col;",
    "}",
    "",
    "vec3 background(vec3 rd, vec2 uv){",
    "  vec3 c = PAPER * (0.972 + 0.028 * smoothstep(-0.60, 0.50, uv.y));",
    "  c += vec3(0.008, 0.010, 0.014) * smoothstep(0.9, 0.1, length(uv - vec2(0.30, 0.04)));",
    "  return c;",
    "}",
    "",
    "/* a soft pool of shadow on the cove, painted in screen space so the paper",
    "   never shows a horizon line */",
    "vec3 shadowPool(vec3 col, vec2 uv, float narrow){",
    "  float amt = 1.0 - narrow;",
    "  vec2 c = vec2(mix(0.315, 0.010, narrow), mix(-0.285, -0.300, narrow));",
    "  vec2 r = vec2(mix(0.400, 0.220, narrow), mix(0.095, 0.062, narrow));",
    "  float e = length((uv - c) / r);",
    "  col *= 1.0 - 0.155 * amt * exp(-e * e * 1.35);",
    "  float core = exp(-pow(length((uv - c - vec2(0.02, 0.02)) / (r * 0.52)), 2.0) * 1.6);",
    "  col *= 1.0 - 0.070 * amt * core;",
    "  return col;",
    "}",
    "",
    "vec2 march(vec3 ro, vec3 rd){",
    "  float t = 0.03;",
    "  float id = 0.0;",
    "  for (int i = 0; i < 110; i++){",
    "    vec3 p = ro + rd * t;",
    "    vec2 h = scene(p);",
    "    if (h.x < 0.00065 * t + 0.0005){ id = h.y; break; }",
    "    t += h.x;",
    "    if (t > 16.0) break;",
    "  }",
    "  return vec2(t, id);",
    "}",
    "",
    "vec3 finish(vec3 c, vec2 uv){",
    "  c = max(c, 0.0);",
    "  c = c / (1.0 + max(c - 1.0, 0.0) * 0.55);",
    "  float lum = dot(c, vec3(0.299, 0.587, 0.114));",
    "  c = mix(vec3(lum), c, 1.035);",
    "  c *= 1.0 - 0.075 * smoothstep(0.60, 1.35, length(uv * vec2(0.82, 0.70)));",
    "  c += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.018;",
    "  return c;",
    "}",
    "",
    "void main(){",
    "  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;",
    "  float aspect = uRes.x / uRes.y;",
    "  float narrow = smoothstep(1.22, 0.70, aspect);",
    "",
    "  vec3 ro = vec3(",
    "    mix(0.00, 2.62, narrow) + uPointer.x * 0.30,",
    "    0.42 + uPointer.y * 0.16 - uShift * 0.06,",
    "    mix(6.35, 11.20, narrow) + uShift * 0.55",
    "  );",
    "  vec3 ta = vec3(",
    "    mix(1.30, 2.62, narrow),",
    "    mix(0.04, -1.55, narrow) - uShift * 0.12,",
    "    0.0",
    "  );",
    "",
    "  vec3 fw = normalize(ta - ro);",
    "  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));",
    "  vec3 up = cross(rt, fw);",
    "  vec3 rd = normalize(fw * 1.62 + rt * uv.x + up * uv.y);",
    "",
    "  vec3 bg = background(rd, uv);",
    "  bg = shadowPool(bg, uv, narrow);",
    "",
    "  vec2 hit = march(ro, rd);",
    "  vec3 col = bg;",
    "",
    "  if (hit.y > 0.5 && hit.x < 15.0){",
    "    vec3 p = ro + rd * hit.x;",
    "    float e = 0.0016 + hit.x * 0.00055;",
    "    vec3 n = calcNormal(p, e);",
    "    float rough = hit.y < 1.5 ? 0.30 : (hit.y < 2.5 ? 0.28 : 0.37);",
    "    col = steel(p, n, rd, hit.y, rough);",
    "    float fog = 1.0 - exp(-0.020 * hit.x * hit.x);",
    "    col = mix(col, bg, fog * 0.22);",
    "  }",
    "",
    "  outColor = vec4(finish(col, uv), 1.0);",
    "}"
  ].join("\n");

  function compile(type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("[scene] shader compile failed:\n" + gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    fallback();
    return;
  }

  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[scene] program link failed:\n" + gl.getProgramInfoLog(program));
    fallback();
    return;
  }
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());

  var uRes = gl.getUniformLocation(program, "uRes");
  var uTime = gl.getUniformLocation(program, "uTime");
  var uPointer = gl.getUniformLocation(program, "uPointer");
  var uShift = gl.getUniformLocation(program, "uShift");

  /* -- state --------------------------------------------------------------- */

  var pointer = { x: 0, y: 0 };
  var pointerTarget = { x: 0, y: 0 };
  var shift = 0;
  var quality = 1;
  var running = false;
  var visible = true;
  var raf = 0;
  var lastFrame = 0;
  var samples = [];
  var cooldown = 0;
  var start = performance.now() / 1000;

  var coarse = window.matchMedia("(pointer: coarse)").matches;
  var pixelBudget = coarse ? 1_150_000 : 2_150_000;
  var maxScale = coarse ? 1.15 : 1.5;

  function viewport() {
    var w = canvas.clientWidth || 1;
    var h = canvas.clientHeight || 1;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var base = Math.min(dpr, Math.sqrt(pixelBudget / (w * h)));
    var target = Math.max(0.45, Math.min(base * quality, maxScale));
    var bw = Math.max(1, Math.round(w * target));
    var bh = Math.max(1, Math.round(h * target));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      gl.viewport(0, 0, bw, bh);
    }
  }

  function draw(now) {
    var t = (now / 1000) - start;

    pointer.x += (pointerTarget.x - pointer.x) * 0.045;
    pointer.y += (pointerTarget.y - pointer.y) * 0.045;

    var h = hero ? hero.offsetHeight : 1;
    var scroll = window.scrollY || window.pageYOffset || 0;
    var targetShift = Math.max(0, Math.min(1, scroll / Math.max(1, h * 0.85)));
    shift += (targetShift - shift) * 0.08;

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uPointer, pointer.x, pointer.y);
    gl.uniform1f(uShift, shift);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;

    var dt = lastFrame ? now - lastFrame : 16.7;
    lastFrame = now;

    draw(now);

    // adaptive resolution: hold the frame under ~26ms without visible pumping
    if (cooldown > 0) {
      cooldown -= dt;
    } else if (now > 900) {
      samples.push(dt);
      if (samples.length >= 36) {
        var avg = 0;
        for (var i = 0; i < samples.length; i++) avg += samples[i];
        avg /= samples.length;
        samples.length = 0;
        var next = quality;
        if (avg > 26 && quality > 0.52) next = quality * 0.86;
        else if (avg < 13 && quality < 1) next = quality * 1.08;
        if (Math.abs(next - quality) > 0.02) {
          quality = Math.max(0.5, Math.min(1, next));
          viewport();
          cooldown = 900;
        }
      }
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastFrame = 0;
    samples.length = 0;
    raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* -- events -------------------------------------------------------------- */

  window.addEventListener(
    "pointermove",
    function (e) {
      if (coarse || reduceQuery.matches) return;
      pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
    },
    { passive: true }
  );

  window.addEventListener("resize", function () {
    viewport();
    if (reduceQuery.matches) draw(performance.now());
  });

  if ("ResizeObserver" in window) {
    new ResizeObserver(function () {
      viewport();
      if (reduceQuery.matches) draw(performance.now());
    }).observe(canvas);
  }

  if ("IntersectionObserver" in window && hero) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible = entry.isIntersecting;
      });
      if (visible && !reduceQuery.matches) startLoop();
      else if (!visible) stopLoop();
    }, { rootMargin: "140px 0px" }).observe(hero);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopLoop();
    } else if (!reduceQuery.matches && visible) {
      startLoop();
    }
  });

  reduceQuery.addEventListener("change", function () {
    if (reduceQuery.matches) {
      stopLoop();
      viewport();
      pointerTarget.x = 0;
      pointerTarget.y = 0;
      pointer.x = 0;
      pointer.y = 0;
      draw(performance.now());
    } else {
      startLoop();
    }
  });

  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    stopLoop();
    fallback();
  });

  /* -- boot ---------------------------------------------------------------- */

  viewport();
  gl.clearColor(0.93, 0.917, 0.892, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  draw(performance.now());

  if (reduceQuery.matches) {
    draw(7800);
  } else {
    startLoop();
  }
})();
