// 墨线后期与法线缓冲的全部 GLSL —— 唯一来源（single source of truth）。
//
// 三段：合成分片（把颜色/深度/法线合成纸墨画面）、法线顶点、法线片元。
// 只有 `moebius-pipeline.js` 装材质，本文件不含任何装配逻辑与数值。
//
// 编译期分叉：调用方传 `defines: { LAB: 1 }` 就打开诊断分支
// （uDebug / uGrain / uOutlineAmt / uHatchAmt / uHatchFade），便于逐层开关与看掩码。
// 不传时这些分支根本不进编译，运行时零开销、零 uniform 负担。
//
// 改这里之前先读 render-params.js：所有可调数值都从那里来，本文件只放结构。

/** 后期合成：全 3×3 Sobel 描边 + 手绘抖动 + 程序化排线 + 纸纹。 */
export const moebiusFragmentShader = /* glsl */`
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform sampler2D tPaper;
  uniform vec2 uResolution;
  uniform vec2 uNormalTexel;
  uniform float uPixelRatio;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform vec3 uInkColor;
  uniform float uCockpit;
  uniform mat3 uNormalToWorld;
  uniform float uShadowType;
  uniform float uOutlineThickness;
  uniform float uDepthWeight;
  uniform float uNormalWeight;
  uniform float uOutlineFadeNear;
  uniform float uOutlineFadeFar;
  uniform float uWiggleFrequency;
  uniform float uWiggleAmplitude;
  uniform float uHatchSpacing;
  // CSS px；旧调用未提供此 uniform 时值为 0，在 main 中回退到墨线宽度。
  uniform float uHatchThickness;
  // 排线分档阈值，单位是"受光程度"：0 = 背光或落在投影里，1 = 正对太阳。
  // 三个值递增；越暗，叠的线越多。
  uniform float uHatchSun1;
  uniform float uHatchSun2;
  uniform float uHatchSun3;
  uniform float uHatchFadeNear;
  uniform float uHatchFadeFar;
  uniform float uPaperStrength;
  // Optional staged speed-edge input. Missing legacy uniforms resolve to zero,
  // which keeps the original game and LookDev output pixel-for-pixel unchanged.
  uniform float uSpeed;
  uniform float uAcceleration;
  uniform float uBoostStage;
  uniform float uBraking;
  uniform float uReducedMotion;
  uniform float uTime;
  uniform float uSpeedEdgeMaxSpeed;
  uniform float uSpeedEdgeClearRadius;
  uniform float uSpeedEdgeDensity;
  uniform float uSpeedEdgeOpacity;
  uniform float uSpeedEdgeThickness;
  uniform float uSpeedEdgeFlowSpeed;
  uniform float uSpeedEdgeAcceleration;
  uniform float uSpeedEdgeStage2Gain;
  uniform float uSpeedEdgePulseGain;
  uniform float uSpeedEdgeCoastGain;
  uniform float uSpeedEdgeBrakeSuppression;
  #ifdef LAB
    // 仅诊断变体（defines.LAB）：逐因素开关与掩码通道。
    uniform float uGrain;
    uniform float uOutlineAmt;
    uniform float uHatchAmt;
    uniform float uHatchFade;
    uniform float uDebug;
  #endif
  varying vec2 vUv;

  float readDepth(vec2 coord) {
    float fragCoordZ = texture2D(tDepth, coord).x;
    return -perspectiveDepthToViewZ(fragCoordZ, uCameraNear, uCameraFar);
  }
  float readDepth01(vec2 coord) {
    float fragCoordZ = texture2D(tDepth, coord).x;
    float viewZ = perspectiveDepthToViewZ(fragCoordZ, uCameraNear, uCameraFar);
    return viewZToOrthographicDepth(viewZ, uCameraNear, uCameraFar);
  }
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  // Periodic, derivative-antialiased ink stroke. The phase comes from mod(), so
  // its derivative spikes at the wrap; substitute the ordinary CSS-pixel footprint
  // there instead of blurring a whole period at every stripe boundary.
  float hatchStrokeAA(float phase, float thickness) {
    float period = max(uHatchSpacing, 0.0001);
    if (thickness <= 0.0) return 0.0;
    float footprint = fwidth(phase);
    if (footprint > period * 0.5) footprint = 1.0 / max(uPixelRatio, 0.0001);
    float halfWidth = 0.5 * min(thickness, period);
    // Distance to the nearest repeated stroke centre, including the next period.
    // This makes the two sides of mod()'s wrap join without a one-pixel crack.
    float centreDistance = min(
      abs(phase - halfWidth),
      abs(phase - halfWidth - period)
    );
    float aa = max(0.0001, footprint * 0.5);
    return 1.0 - smoothstep(
      max(0.0, halfWidth - aa),
      halfWidth + aa,
      centreDistance
    );
  }

  // Narrow radial ink strokes, not blur or a full-screen wash. Speed owns the
  // steady length/density; acceleration, stage II, release and brake are separate.
  float speedEdgeMask() {
    float speed01 = clamp(uSpeed / max(1.0, uSpeedEdgeMaxSpeed), 0.0, 1.0);
    float boostActive = smoothstep(0.0, 1.0, uBoostStage);
    float stage2 = smoothstep(1.0, 2.0, uBoostStage);
    float accelerationReference = max(2.0, uSpeedEdgeAcceleration);
    float launch = smoothstep(1.0, accelerationReference, uAcceleration);
    float ignition = boostActive * launch * uSpeedEdgePulseGain;
    float release = 1.0 - boostActive;
    float deceleration = smoothstep(1.0, accelerationReference, -uAcceleration);
    float coast = release * deceleration * speed01 * uSpeedEdgeCoastGain;
    float steady = smoothstep(0.16, 0.92, speed01);
    float energy = steady + ignition + stage2 * uSpeedEdgeStage2Gain + coast;
    float braking = clamp(uBraking, 0.0, 1.0);
    energy *= 1.0 - braking * clamp(uSpeedEdgeBrakeSuppression, 0.0, 1.0);
    if (energy < 0.0005 || uSpeedEdgeOpacity <= 0.0) return 0.0;

    vec2 centered = (vUv - vec2(0.5)) * 2.0;
    float radial = length(centered);
    float clearRadius = clamp(uSpeedEdgeClearRadius, 0.55, 0.60);
    float edgeMask = smoothstep(clearRadius, clearRadius + 0.18, radial);
    float outerFade = 1.0 - smoothstep(1.28, 1.48, radial);
    float angle = radial > 0.0001
      ? atan(centered.y, centered.x) / 6.28318530718 + 0.5
      : 0.5;
    float lanes = max(1.0, uSpeedEdgeDensity);
    float laneIndex = floor(angle * lanes);
    float laneRandom = hash(vec2(laneIndex, 19.31));
    float density = clamp(
      0.06 + speed01 * 0.46 + boostActive * 0.08 + stage2 * 0.18
        + ignition * 0.12 + coast * 0.10,
      0.0,
      0.94
    );
    float densityMask = step(laneRandom, density);

    float lineLength = clamp(
      0.08 + speed01 * 0.30 + stage2 * 0.11 + ignition * 0.09 + coast * 0.07,
      0.06,
      0.68
    );
    float reducedMotion = clamp(uReducedMotion, 0.0, 1.0);
    float flow = uTime * uSpeedEdgeFlowSpeed * mix(0.35, 1.35, speed01)
      * (1.0 - reducedMotion);
    float phase = fract(radial * 1.12 - flow + laneRandom * 1.73);
    float segment = smoothstep(0.0, 0.025, phase)
      * (1.0 - smoothstep(lineLength, lineLength + 0.045, phase));

    float laneCoord = fract(angle * lanes);
    float radiusPixels = radial * 0.5 * min(uResolution.x, uResolution.y) / max(1.0, uPixelRatio);
    float arcPixels = abs(laneCoord - 0.5) / lanes * 6.28318530718 * radiusPixels;
    float lineWidth = max(0.1, uSpeedEdgeThickness) * mix(0.76, 1.24, laneRandom);
    float stroke = 1.0 - smoothstep(lineWidth, lineWidth + 0.75, arcPixels);
    return edgeMask * outerFade * densityMask * segment * stroke * energy * uSpeedEdgeOpacity;
  }

  void main() {
    // Pattern coordinates are CSS pixels so density never changes with DPR.
    vec2 texel = uPixelRatio / uResolution;
    vec2 frag = vUv * uResolution / uPixelRatio;
    float outlineThickness = uOutlineThickness;
    float hatchThickness = uHatchThickness > 0.0 ? uHatchThickness : outlineThickness;
    // Hand-drawn wiggle: per-pixel hash modulating a low-frequency sinusoid.
    vec2 displacement = vec2(
      hash(frag) * sin(frag.y * uWiggleFrequency),
      hash(frag) * cos(frag.x * uWiggleFrequency)
    ) * uWiggleAmplitude * texel;
    #ifdef LAB
      displacement *= uGrain;
    #endif
    vec2 uv = vUv + displacement;
    vec2 kDepth = outlineThickness * texel;
    vec2 kNormal = outlineThickness * uNormalTexel;
    vec2 fragD = frag + displacement / texel;

    float d11 = readDepth(uv);
    vec4 normal = texture2D(tNormal, uv);
    vec3 n11 = normal.rgb;
    vec4 base = texture2D(tColor, vUv);

    float d00 = readDepth01(uv + kDepth * vec2(-1.0,  1.0));
    float d01 = readDepth01(uv + kDepth * vec2( 0.0,  1.0));
    float d02 = readDepth01(uv + kDepth * vec2( 1.0,  1.0));
    float d10 = readDepth01(uv + kDepth * vec2(-1.0,  0.0));
    float d12 = readDepth01(uv + kDepth * vec2( 1.0,  0.0));
    float d20 = readDepth01(uv + kDepth * vec2(-1.0, -1.0));
    float d21 = readDepth01(uv + kDepth * vec2( 0.0, -1.0));
    float d22 = readDepth01(uv + kDepth * vec2( 1.0, -1.0));
    float depthX = -d00 - 2.0 * d10 - d20 + d02 + 2.0 * d12 + d22;
    float depthY = -d00 - 2.0 * d01 - d02 + d20 + 2.0 * d21 + d22;
    float gradientDepth = length(vec2(depthX, depthY));

    float n00 = luma(texture2D(tNormal, uv + kNormal * vec2(-1.0,  1.0)).rgb);
    float n01 = luma(texture2D(tNormal, uv + kNormal * vec2( 0.0,  1.0)).rgb);
    float n02 = luma(texture2D(tNormal, uv + kNormal * vec2( 1.0,  1.0)).rgb);
    float n10 = luma(texture2D(tNormal, uv + kNormal * vec2(-1.0,  0.0)).rgb);
    float n12 = luma(texture2D(tNormal, uv + kNormal * vec2( 1.0,  0.0)).rgb);
    float n20 = luma(texture2D(tNormal, uv + kNormal * vec2(-1.0, -1.0)).rgb);
    float n21 = luma(texture2D(tNormal, uv + kNormal * vec2( 0.0, -1.0)).rgb);
    float n22 = luma(texture2D(tNormal, uv + kNormal * vec2( 1.0, -1.0)).rgb);
    float normalX = -n00 - 2.0 * n10 - n20 + n02 + 2.0 * n12 + n22;
    float normalY = -n00 - 2.0 * n01 - n02 + n20 + 2.0 * n21 + n22;
    float gradientNormal = length(vec2(normalX, normalY));

    // Depth carries the outer silhouette (x25), normals the inner structure.
    // The optional legacy specular mask remains separate from material colour.
    float outline = clamp(gradientDepth * uDepthWeight + gradientNormal * uNormalWeight, 0.0, 1.0);
    vec3 worldNormal = normalize(uNormalToWorld * (n11 * 2.0 - 1.0));
    float groundLike = smoothstep(0.72, 0.94, worldNormal.y);
    outline *= 1.0 - groundLike * smoothstep(28.0, 65.0, d11);
    outline *= 1.0 - smoothstep(uOutlineFadeNear, uOutlineFadeFar, d11);
    #ifdef LAB
      outline *= uOutlineAmt;
      // 诊断掩码需要"未被描边遮住"的原始 hatch 值，单独留一份。
      float debugHatch = 0.0;
    #endif

    vec3 color = mix(base.rgb, uInkColor, outline);

    // Shadow patterns. sunlit 来自法线 pass 的 max(0,N·L)×投影遮罩：
    // 用几何信号而不是屏幕亮度，雾、曝光、ACES 和 LDR 回退都影响不到分档。
    // 换成亮度信号时雾色会把远处所有表面拉成同一个值，档位随之退化成单一档。
    float sunlit = clamp(normal.a, 0.0, 1.0);
    float isScene = step(d11, uCameraFar - 2.0) * step(0.08, base.a);
    float hatch = 0.0;
    if (uShadowType < 1.5) {
      float tone = 1.0;
      if (sunlit <= uHatchSun3) tone = 0.7;
      if (sunlit <= uHatchSun2) tone = 0.5;
      if (sunlit <= (uHatchSun1 + uHatchSun2) * 0.5) tone = 0.25;
      if (sunlit <= uHatchSun1) tone = 0.0;
      color = mix(color, uInkColor, (1.0 - tone) * isScene);
      #ifdef LAB
        debugHatch = (1.0 - tone) * isScene * uHatchAmt;
      #endif
    } else if (uShadowType < 2.5) {
      float rasterSize = uHatchSpacing * 0.55;
      float raster = length(mod(fragD, vec2(rasterSize)) / rasterSize - vec2(0.5));
      hatch = step(sunlit, raster * 1.25) * isScene;
    } else {
      float modVal = uHatchSpacing;
      // Soft light bands keep a moving half-res normal buffer from flipping an
      // entire facet between two ink layers. The floor is a light-energy fraction,
      // not a scene-specific distance or a replacement for the authored thresholds.
      float sunSoftness = max(0.015, fwidth(sunlit) * 1.5);
      float band1 = 1.0 - smoothstep(
        uHatchSun1 - sunSoftness, uHatchSun1 + sunSoftness, sunlit
      );
      float band2 = 1.0 - smoothstep(
        uHatchSun2 - sunSoftness, uHatchSun2 + sunSoftness, sunlit
      );
      float band3 = 1.0 - smoothstep(
        uHatchSun3 - sunSoftness, uHatchSun3 + sunSoftness, sunlit
      );
      hatch = max(hatch, hatchStrokeAA(mod(fragD.y, modVal), hatchThickness) * band1);
      hatch = max(hatch, hatchStrokeAA(mod(fragD.x, modVal), hatchThickness) * band2);
      hatch = max(hatch, hatchStrokeAA(mod(fragD.x + fragD.y, modVal), hatchThickness) * band3);
      hatch *= isScene;
    }
    #ifdef LAB
      hatch *= 1.0 - uHatchFade * smoothstep(uHatchFadeNear, uHatchFadeFar, d11);
    #else
      hatch *= 1.0 - smoothstep(uHatchFadeNear, uHatchFadeFar, d11);
    #endif
    hatch *= mix(1.0, 0.35, uCockpit);
    hatch *= 1.0 - outline;
    #ifdef LAB
      hatch *= uHatchAmt;
      debugHatch = max(debugHatch, hatch);
    #endif
    color = mix(color, uInkColor, hatch);

    // A final ink layer in the same existing pass. It never distorts UVs,
    // samples extra color channels, or changes the established hatch roles.
    float speedEdge = speedEdgeMask();
    color = mix(color, uInkColor, clamp(speedEdge, 0.0, 0.58));

    float paperGrain = texture2D(tPaper, frag / 256.0).r;
    #ifdef LAB
      color *= mix(1.0, mix(1.0 - uPaperStrength, 1.0 + uPaperStrength, paperGrain), uGrain);
    #else
      color *= mix(1.0 - uPaperStrength, 1.0 + uPaperStrength, paperGrain);
    #endif

    // Legacy global white dots are opt-in through uSpecThreshold. The default
    // threshold is >1, keeping paper/sand/rock flat until enamel-only routing.
    float specular = step(0.999, n11.r) * step(0.999, n11.g) * step(0.999, n11.b);

    #ifdef LAB
      if (uDebug > 0.5) {
        vec3 dbg = vec3(0.0);
        if (uDebug < 1.5) dbg = vec3(outline);
        else if (uDebug < 2.5) dbg = vec3(debugHatch);
        else if (uDebug < 3.5) dbg = n11;
        // 深度归一化到可读灰阶：分母取一个大于任何可见距离的常数即可。
        else dbg = vec3(clamp(d11 / 245.0, 0.0, 1.0));
        gl_FragColor = vec4(dbg, 1.0);
        return;
      }
    #endif

    gl_FragColor = vec4(color, max(base.a, outline * 0.86));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), specular);
  }
`;

/**
 * 法线缓冲顶点着色器：输出视空间法线，并把 N·L 需要的世界法线留给片元。
 * 同时接上 three 的 shadowmap chunk，让片元能取到投影遮罩。
 */
export const moebiusNormalVertexShader = /* glsl */`
  #include <common>
  #include <shadowmap_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vEyeVector;
  void main() {
    vec4 localPosition = vec4(position, 1.0);
    vec3 localNormal = normal;
    #ifdef USE_INSTANCING
      localPosition = instanceMatrix * localPosition;
      localNormal = mat3(instanceMatrix) * localNormal;
    #endif
    vec4 worldPosition = modelMatrix * localPosition;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    vec3 transformedNormal = normalize(normalMatrix * localNormal);
    vNormal = transformedNormal;
    vEyeVector = normalize(worldPosition.xyz - cameraPosition);
    #include <shadowmap_vertex>
  }
`;

/**
 * 法线缓冲：视空间法线 + 可选旧式 Blinn-Phong 白点（默认阈值 >1 关闭），
 * 漫反射项存进 alpha，后期用它判断"这个像素被太阳照到多少"。后续若启用
 * 漆膜高光，必须先由调用方按材质放行，不能重新打开全场景白点。
 */
export const moebiusNormalFragmentShader = /* glsl */`
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  varying vec3 vNormal;
  varying vec3 vEyeVector;
  uniform vec3 lightPosition;
  uniform float uShininess;
  uniform float uSpecThreshold;
  vec2 phong() {
    vec3 normal = normalize(vNormal);
    vec3 lightDirection = normalize((viewMatrix * vec4(lightPosition, 0.0)).xyz);
    vec3 eyeDirection = normalize((viewMatrix * vec4(vEyeVector, 0.0)).xyz);
    vec3 halfVector = normalize(eyeDirection - lightDirection);
    float NdotL = dot(normal, lightDirection);
    float NdotH = dot(normal, halfVector);
    float NdotH2 = NdotH * NdotH;
    // 满量程写进 alpha：后期按"受光程度"分档，任何缩放都会让阈值失去物理含义
    // （缩一半 = 水平沙面从 0.595 掉到 0.30，直接跌进叠横线那一档）。
    float kDiffuse = max(0.0, NdotL);
    float kSpecular = pow(NdotH2, uShininess);
    return vec2(kSpecular, kDiffuse);
  }

  void main() {
    vec3 color = vNormal;
    vec2 phongLighting = phong();
    // Shadow-aware: cast-shadow regions must NOT receive the diffuse boost,
    // otherwise their luma rises above the hatch thresholds and ground
    // shadows lose all crosshatching (strong hemisphere fill makes this
    // visible even though the article's tiny ambient hid it).
    float shadowMask = getShadowMask();
    if (phongLighting.x >= uSpecThreshold && shadowMask > 0.5) color = vec3(1.0);
    gl_FragColor = vec4(color, phongLighting.y * shadowMask);
  }
`;