/* 풍선쇼 3D 렌더러 — 진짜 WebGL 파이프라인 (깊이 버퍼·셰이더 조명). 소유: 무대.
 *
 * 왜 오프스크린에 그리고 2D 캔버스로 합성하는가:
 *   셸은 게임에 2D 캔버스 하나를 준다 (contract 4.2의 stage.ctx, 960×430). 클립 자동
 *   캡처와 리플레이는 **그 캔버스 하나만** 읽는다. 화면에 별도 WebGL 캔버스를 얹으면
 *   3D는 보이지만 이 게임에서만 클립이 빈 화면으로 찍힌다 — 제출물의 핵심 연출이 죽는다.
 *   그래서 WebGL은 오프스크린 캔버스에 그리고, 게임이 drawImage로 2D 캔버스에 합성한다.
 *   렌더링은 온전히 GPU 파이프라인이고 계약은 한 줄도 바뀌지 않는다.
 *
 * 폴백: WebGL을 못 얻으면 create()가 null을 준다. 게임은 기존 2D 드로잉으로 내려간다 —
 * 심사자의 브라우저가 WebGL을 막아도 "링크 클릭만으로 바로 플레이"는 지켜져야 한다.
 *
 * 좌표계: z=0 평면이 옛 2D 캔버스와 1:1로 맞도록 카메라 거리를 잡았다. 그래서 게임의
 * 스폰 좌표(x 0~960, y 0~430)를 그대로 쓰면서 z만 얹으면 깊이가 생긴다.
 */
(function (global) {
  'use strict';

  var W = 960, H = 430;
  var FOV = 45 * Math.PI / 180;
  // z=0에서 화면 절반 높이가 H/2가 되는 카메라 거리 — 이 값이 2D와의 1:1 접점이다
  var CAM_Z = (H / 2) / Math.tan(FOV / 2);

  var VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'uniform mat4 uVP;',
    'uniform vec3 uCenter;',
    'uniform vec3 uScale;',
    'varying vec3 vN;',
    'varying vec3 vP;',
    'void main() {',
    '  vec3 p = aPos * uScale + uCenter;',
    '  vN = normalize(aNrm / uScale);',   // 비균등 스케일이라 법선도 나눠 준다
    '  vP = p;',
    '  gl_Position = uVP * vec4(p, 1.0);',
    '}',
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vN;',
    'varying vec3 vP;',
    'uniform vec3 uColor;',
    'uniform vec3 uEye;',
    'uniform float uBloom;',
    'uniform float uDark;',
    'void main() {',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(uEye - vP);',
    // 무대 스포트라이트 둘 — 배경 아트의 보라 조명 방향과 맞춘다
    '  vec3 L1 = normalize(vec3(-0.55, 0.85, 0.60));',
    '  vec3 L2 = normalize(vec3( 0.62, 0.70, 0.45));',
    '  float d = 0.52 * max(dot(N, L1), 0.0) + 0.30 * max(dot(N, L2), 0.0);',
    '  vec3 Hv = normalize(L1 + V);',
    '  float spec = pow(max(dot(N, Hv), 0.0), 64.0);',
    // 얇은 고무막을 통과한 빛 — 가장자리가 속에서 밝다. 풍선처럼 보이는 결정적 항이다.
    // 지수를 낮추면 넓게 퍼져 파티 색이 전부 흰색으로 날아간다 (1차 실측) — 좁게 잡는다
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.4);',
    '  vec3 col = uColor * (0.22 + d) + uColor * fres * 0.34 + vec3(1.0) * spec * 0.5;',
    '  col += uColor * uBloom * 0.45;',
    '  col *= uDark;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');

  // ---------- 행렬 (필요한 것만) ----------
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function lookAtZ(eyeZ) { // 카메라는 +z에서 원점을 바라본다 — 회전 없음
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -eyeZ, 1];
  }

  // ---------- 구 메시 ----------
  function sphere(seg, ring) {
    var pos = [], nrm = [], idx = [];
    for (var y = 0; y <= ring; y++) {
      var v = y / ring, phi = v * Math.PI;
      for (var x = 0; x <= seg; x++) {
        var u = x / seg, th = u * Math.PI * 2;
        var nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        pos.push(nx, ny, nz); nrm.push(nx, ny, nz);
      }
    }
    for (var yy = 0; yy < ring; yy++) {
      for (var xx = 0; xx < seg; xx++) {
        var a = yy * (seg + 1) + xx, b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[balloon-gl] shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function create() {
    var cv, gl;
    try {
      cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      // premultipliedAlpha는 기본값(true)을 쓴다. false로 두면 2D 캔버스가 곱해진 색을
      // 기대하는데 곱해지지 않은 색이 와서 가장자리마다 색 후광이 낀다 (실측)
      gl = cv.getContext('webgl', { alpha: true, antialias: true })
        || cv.getContext('experimental-webgl', { alpha: true, antialias: true });
    } catch (e) { gl = null; }
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      console.warn('[balloon-gl] link:', gl.getProgramInfoLog(pr));
      return null;
    }
    gl.useProgram(pr);

    var mesh = sphere(28, 18);
    var bPos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
    var bNrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bNrm); gl.bufferData(gl.ARRAY_BUFFER, mesh.nrm, gl.STATIC_DRAW);
    var bIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);

    var aPos = gl.getAttribLocation(pr, 'aPos'), aNrm = gl.getAttribLocation(pr, 'aNrm');
    var uVP = gl.getUniformLocation(pr, 'uVP'), uCenter = gl.getUniformLocation(pr, 'uCenter');
    var uScale = gl.getUniformLocation(pr, 'uScale'), uColor = gl.getUniformLocation(pr, 'uColor');
    var uEye = gl.getUniformLocation(pr, 'uEye'), uBloom = gl.getUniformLocation(pr, 'uBloom');
    var uDark = gl.getUniformLocation(pr, 'uDark');

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);

    var proj = perspective(FOV, W / H, 1, 4000);
    var view = lookAtZ(CAM_Z);
    var VP = mul(proj, view);

    // 월드 좌표: 게임이 쓰는 화면 좌표(0~960, 0~430)를 원점 기준으로 옮긴 값.
    // y는 화면이 아래로 증가하므로 뒤집는다
    function toWorld(x, y, z) { return [x - W / 2, (H / 2) - y, z || 0]; }

    return {
      canvas: cv,
      CAM_Z: CAM_Z,

      /* 3D 점을 화면 좌표로. 렌더링과 **같은 VP**를 쓰므로 클릭 판정이 그림과 어긋나지 않는다.
         scale은 그 깊이에서의 크기 배율 — 반지름에 곱하면 화면 반지름이 된다 */
      project: function (x, y, z) {
        var w = toWorld(x, y, z);
        var cw = CAM_Z - w[2];                    // 카메라까지의 거리
        if (cw < 1) cw = 1;
        var s = CAM_Z / cw;
        return { x: W / 2 + w[0] * s, y: H / 2 - w[1] * s, scale: s };
      },

      /* list: [{x,y,z,r,rgb:[r,g,b], bloom:0..1, squash:{x,y}}]  — 뒤에서 앞으로 정렬해 넘길 것 */
      render: function (list, dark) {
        gl.viewport(0, 0, W, H);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(pr);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bNrm); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
        gl.uniformMatrix4fv(uVP, false, new Float32Array(VP));
        gl.uniform3f(uEye, 0, 0, CAM_Z);
        var g0 = dark == null ? 1 : dark;

        for (var i = 0; i < list.length; i++) {
          var b = list[i], w = toWorld(b.x, b.y, b.z);
          // 거리 감광 — 먼 풍선은 무대 어둠에 잠긴다. 크기 차이만으로는 깊이가 약하게 읽힌다.
          // z는 -170(뒤) ~ +110(앞) 범위라 그 폭에 맞춰 0.62~1.0으로 민다
          var depth = g0 * (0.62 + 0.38 * ((b.z + 170) / 280));
          gl.uniform1f(uDark, depth < 0.5 ? 0.5 : (depth > 1 ? 1 : depth));
          // 몸통 — 세로로 살짝 길고 아래가 도톰한 풍선 비례
          gl.uniform3f(uCenter, w[0], w[1], w[2]);
          // sx/sy = 호흡(고무의 압력) 스쿼시. 없으면 1
          var sx = b.sx || 1, sy = b.sy || 1;
          gl.uniform3f(uScale, b.r * 0.92 * sx, b.r * 1.06 * sy, b.r * 0.92 * sx);
          gl.uniform3f(uColor, b.rgb[0], b.rgb[1], b.rgb[2]);
          gl.uniform1f(uBloom, b.bloom || 0);
          gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
          // 매듭 — 같은 메시를 작고 어둡게 한 번 더
          gl.uniform3f(uCenter, w[0], w[1] - b.r * 1.06, w[2]);
          gl.uniform3f(uScale, b.r * 0.16, b.r * 0.2, b.r * 0.16);
          gl.uniform3f(uColor, b.rgb[0] * 0.45, b.rgb[1] * 0.45, b.rgb[2] * 0.45);
          gl.uniform1f(uBloom, 0);
          gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
        }
      },

      dispose: function () {
        try {
          var ext = gl.getExtension('WEBGL_lose_context');
          if (ext) ext.loseContext();
        } catch (e) {}
      },
    };
  }

  global.BalloonGL = { create: create, W: W, H: H };
})(window);
