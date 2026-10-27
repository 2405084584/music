import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

// src/components/visualizer/konbini/fx/konbiniPostPasses.ts
// 雨町后处理的三道自定义 pass：
// - 氛围（KonbiniAtmospherePass）：深度拉普拉斯墨线；由深度还原世界坐标，画贴地的薄雾（随风漂的噪声，靠近店门和路灯时
//   被灯染暖，像光在雾里散开）；天空像素上画慢慢漂的云和闪电。
// - 光条（KonbiniStreakPass）：亮处在四分之一分辨率上只做横向模糊，叠回去成为横向的镜头光条（变形宽银幕镜头那种）。
// - 镜头（KonbiniLensPass）：按深度离焦的微缩景深（半分辨率模糊再混合）、边缘色差、暗角、胶片颗粒。
// 三道都只用全屏四边形，额外的贴图都在低分辨率上。

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NOISE_GLSL = /* glsl */ `
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float pFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * pNoise(p);
        p = p * 2.03 + vec2(17.1, 9.2);
        amplitude *= 0.5;
    }
    return value;
}
`;

/**
 * 场景画进的目标：在合成器自己来回交换的两张缓冲之外单独一张（带 MSAA 和深度贴图），后面的 pass 随时取它的深度，
 * 不会碰上“正在写的帧缓冲上挂着的贴图又被采样”的反馈环。
 */
export interface KonbiniSceneTarget {
    target: THREE.WebGLRenderTarget;
}

/** 全屏 pass 的材质：不做深度测试、不写深度。 */
const fullscreenMaterial = (parameters: THREE.ShaderMaterialParameters) => new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    depthTest: false,
    depthWrite: false,
    ...parameters,
});

const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uDepthRange;
uniform float uThreshold;
uniform vec3 uInk;
uniform float uInkStrength;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uTime;
uniform vec3 uMistColor;
uniform float uMistAmount;
uniform float uMistHeight;
uniform vec2 uWind;
uniform vec4 uGlowA;
uniform vec3 uGlowColorA;
uniform vec4 uGlowB;
uniform vec3 uGlowColorB;
uniform vec3 uCloudColor;
uniform float uLightning;
uniform vec3 uLightningColor;
uniform float uAspect;
varying vec2 vUv;
${NOISE_GLSL}
float depthAt(vec2 uv) { return texture2D(tDepth, uv).x * uDepthRange; }
void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float raw = texture2D(tDepth, vUv).x;
    float d = raw * uDepthRange;
    bool sky = raw > 0.9999;
    // 墨线：平面上深度的二阶差分为零，只有轮廓和折角不为零。
    float l = depthAt(vUv - vec2(uTexel.x, 0.0));
    float r = depthAt(vUv + vec2(uTexel.x, 0.0));
    float u = depthAt(vUv + vec2(0.0, uTexel.y));
    float b = depthAt(vUv - vec2(0.0, uTexel.y));
    float lu = depthAt(vUv + vec2(-uTexel.x, uTexel.y));
    float rb = depthAt(vUv + vec2(uTexel.x, -uTexel.y));
    float ru = depthAt(vUv + uTexel);
    float lb = depthAt(vUv - uTexel);
    float laplace = abs(l + r - 2.0 * d) + abs(u + b - 2.0 * d) + 0.5 * (abs(lu + rb - 2.0 * d) + abs(ru + lb - 2.0 * d));
    float line = smoothstep(uThreshold, uThreshold * 2.6, laplace) * (sky ? 0.0 : 1.0);
    vec3 rgb = mix(color.rgb, uInk, line * uInkStrength);

    if (sky) {
        // 天空：两层慢慢漂的云，闪电时从云里亮起来。
        vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.4 + vec2(uTime * 0.012, 0.0);
        float cloud = smoothstep(0.42, 0.85, pFbm(p)) * smoothstep(0.0, 0.55, vUv.y);
        float wisp = smoothstep(0.55, 0.9, pFbm(p * 2.3 + vec2(uTime * 0.02, 3.1)));
        rgb += uCloudColor * (cloud * 0.55 + wisp * 0.18);
        rgb += uLightningColor * uLightning * (0.18 + 1.1 * cloud + 0.4 * wisp);
    } else {
        // 还原世界坐标，画贴地的雾。
        vec4 ndc = vec4(vUv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0);
        vec4 view = uProjInv * ndc;
        view /= view.w;
        vec3 world = (uCamWorld * view).xyz;
        float height = max(world.y, 0.0);
        float drift = pFbm(world.xz * 0.32 + uWind * uTime) * 0.65 + pFbm(world.xz * 0.9 - uWind * uTime * 1.7) * 0.35;
        float density = uMistAmount * exp(-height / uMistHeight) * (0.35 + 0.9 * drift);
        // 灯在雾里散开：离店门、路灯越近，雾越亮越暖。
        vec2 da = world.xz - uGlowA.xz;
        vec2 db = world.xz - uGlowB.xz;
        vec3 lit = uMistColor
            + uGlowColorA * exp(-dot(da, da) / (uGlowA.w * uGlowA.w)) * exp(-height / 2.2)
            + uGlowColorB * exp(-dot(db, db) / (uGlowB.w * uGlowB.w)) * exp(-height / 3.0);
        rgb = mix(rgb, lit, clamp(density, 0.0, 0.85));
        rgb += rgb * uLightning * 0.18;
    }
    gl_FragColor = vec4(rgb, color.a);
}
`;

export class KonbiniAtmospherePass extends Pass {
    readonly material: THREE.ShaderMaterial;
    private readonly quad: FullScreenQuad;

    constructor(private readonly scene: KonbiniSceneTarget) {
        super();
        this.material = fullscreenMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                uTexel: { value: new THREE.Vector2() },
                uDepthRange: { value: 100 },
                uThreshold: { value: 0.05 },
                uInk: { value: new THREE.Color(0x0b0f1a) },
                uInkStrength: { value: 0.82 },
                uProjInv: { value: new THREE.Matrix4() },
                uCamWorld: { value: new THREE.Matrix4() },
                uTime: { value: 0 },
                uMistColor: { value: new THREE.Color() },
                uMistAmount: { value: 0.22 },
                uMistHeight: { value: 0.55 },
                uWind: { value: new THREE.Vector2(0.05, 0.02) },
                uGlowA: { value: new THREE.Vector4(0, 0, 0, 2.4) },
                uGlowColorA: { value: new THREE.Color() },
                uGlowB: { value: new THREE.Vector4(0, 0, 0, 1.8) },
                uGlowColorB: { value: new THREE.Color() },
                uCloudColor: { value: new THREE.Color() },
                uLightning: { value: 0 },
                uLightningColor: { value: new THREE.Color(0xc9d8ff) },
                uAspect: { value: 16 / 9 },
            },
            fragmentShader: ATMOSPHERE_FRAGMENT,
        });
        this.quad = new FullScreenQuad(this.material);
    }

    setSize(width: number, height: number) {
        (this.material.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
        this.material.uniforms.uAspect!.value = width / Math.max(1, height);
    }

    /** 读的是单独的场景目标，不是合成器的读缓冲（场景没有画进那里）。 */
    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
        this.material.uniforms.tDiffuse!.value = this.scene.target.texture;
        this.material.uniforms.tDepth!.value = this.scene.target.depthTexture;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.material.dispose();
        this.quad.dispose();
    }
}

const BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb
        + texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb
        + texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb
        + texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, luminance), 1.0);
}
`;

const STREAK_BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2;
    float weights[4];
    weights[0] = 0.17; weights[1] = 0.13; weights[2] = 0.08; weights[3] = 0.04;
    for (int i = 0; i < 4; i++) {
        vec2 offset = uStep * float(i + 1);
        sum += (texture2D(tDiffuse, vUv + offset).rgb + texture2D(tDiffuse, vUv - offset).rgb) * weights[i];
    }
    gl_FragColor = vec4(sum, 1.0);
}
`;

const ADD_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tAdd;
uniform vec3 uTint;
uniform float uStrength;
varying vec2 vUv;
void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(base.rgb + texture2D(tAdd, vUv).rgb * uTint * uStrength, base.a);
}
`;

const halfFloatTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

/** 横向镜头光条：亮处降到四分之一分辨率，横向越扩越宽地模糊三次，再叠回去。 */
export class KonbiniStreakPass extends Pass {
    private readonly targets = [halfFloatTarget(), halfFloatTarget()];
    private readonly bright: THREE.ShaderMaterial;
    private readonly blur: THREE.ShaderMaterial;
    private readonly add: THREE.ShaderMaterial;
    private readonly quad = new FullScreenQuad();
    private width = 1;
    strength = 0.55;

    constructor() {
        super();
        this.bright = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } },
            fragmentShader: BRIGHT_FRAGMENT,
        });
        this.blur = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
            fragmentShader: STREAK_BLUR_FRAGMENT,
        });
        this.add = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, tAdd: { value: null }, uTint: { value: new THREE.Color(0.62, 0.74, 1.0) }, uStrength: { value: 0.55 } },
            fragmentShader: ADD_FRAGMENT,
        });
    }

    setSize(width: number, height: number) {
        this.width = Math.max(1, Math.round(width / 4));
        const h = Math.max(1, Math.round(height / 4));
        this.targets.forEach(target => target.setSize(this.width, h));
        (this.bright.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }

    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        const [a, b] = this.targets as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
        this.bright.uniforms.tDiffuse!.value = readBuffer.texture;
        this.quad.material = this.bright;
        renderer.setRenderTarget(a);
        this.quad.render(renderer);
        let source = a;
        let target = b;
        [1, 4, 14].forEach(spread => {
            this.blur.uniforms.tDiffuse!.value = source.texture;
            (this.blur.uniforms.uStep!.value as THREE.Vector2).set(spread / this.width, 0);
            this.quad.material = this.blur;
            renderer.setRenderTarget(target);
            this.quad.render(renderer);
            [source, target] = [target, source];
        });
        this.add.uniforms.tDiffuse!.value = readBuffer.texture;
        this.add.uniforms.tAdd!.value = source.texture;
        this.add.uniforms.uStrength!.value = this.strength;
        this.quad.material = this.add;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.targets.forEach(target => target.dispose());
        this.bright.dispose();
        this.blur.dispose();
        this.add.dispose();
        this.quad.dispose();
    }
}

const GAUSS_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227;
    sum += (texture2D(tDiffuse, vUv + uStep * 1.385).rgb + texture2D(tDiffuse, vUv - uStep * 1.385).rgb) * 0.316;
    sum += (texture2D(tDiffuse, vUv + uStep * 3.231).rgb + texture2D(tDiffuse, vUv - uStep * 3.231).rgb) * 0.070;
    gl_FragColor = vec4(sum, 1.0);
}
`;

const LENS_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBlur;
uniform sampler2D tDepth;
uniform float uDepthRange;
uniform float uFocus;
uniform float uFocusBand;
uniform float uFocusFalloff;
uniform float uDof;
uniform float uTilt;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 centered = vUv - 0.5;
    float edge = dot(centered, centered);
    // 边缘色差：红蓝沿径向错开，中间不动。
    vec2 shift = centered * edge * uAberration;
    vec3 sharp = vec3(
        texture2D(tDiffuse, vUv + shift).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - shift).b
    );
    vec3 blurred = texture2D(tBlur, vUv).rgb;
    // 微缩景深：离对焦深度越远越虚，再叠一点上下的移轴。
    float depth = texture2D(tDepth, vUv).x * uDepthRange;
    float coc = smoothstep(uFocusBand, uFocusBand + uFocusFalloff, abs(depth - uFocus)) * uDof;
    coc = max(coc, smoothstep(0.2, 0.55, abs(vUv.y - 0.5)) * uTilt);
    vec3 color = mix(sharp, blurred, clamp(coc, 0.0, 1.0));
    // 暗角。
    vec2 v = centered * vec2(uAspect, 1.0);
    float vignette = smoothstep(1.15, 0.35, length(v) * 1.15);
    color *= mix(1.0, vignette, uVignette);
    // 颗粒：跟亮度走，暗部更细。
    float grain = gHash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.31)) - 0.5;
    color += grain * uGrain * (0.25 + dot(color, vec3(0.3333)));
    gl_FragColor = vec4(max(color, 0.0), 1.0);
}
`;

export interface KonbiniLensSettings {
    focus: number;
    focusBand: number;
    focusFalloff: number;
    dof: number;
    tilt: number;
    aberration: number;
    vignette: number;
    grain: number;
}

/** 镜头：半分辨率高斯模糊出离焦层，按深度混合；再加色差、暗角、颗粒。 */
export class KonbiniLensPass extends Pass {
    private readonly targets = [halfFloatTarget(), halfFloatTarget()];
    private readonly gauss: THREE.ShaderMaterial;
    private readonly copy: THREE.ShaderMaterial;
    readonly material: THREE.ShaderMaterial;
    private readonly quad = new FullScreenQuad();
    private size = new THREE.Vector2(1, 1);
    dofEnabled = true;

    constructor(private readonly scene: KonbiniSceneTarget) {
        super();
        this.gauss = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
            fragmentShader: GAUSS_FRAGMENT,
        });
        this.copy = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null } },
            fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
        });
        this.material = fullscreenMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tBlur: { value: null },
                tDepth: { value: null },
                uDepthRange: { value: 100 },
                uFocus: { value: 60 },
                uFocusBand: { value: 3 },
                uFocusFalloff: { value: 7 },
                uDof: { value: 0.85 },
                uTilt: { value: 0.35 },
                uAberration: { value: 0.012 },
                uVignette: { value: 0.55 },
                uGrain: { value: 0.035 },
                uTime: { value: 0 },
                uAspect: { value: 16 / 9 },
            },
            fragmentShader: LENS_FRAGMENT,
        });
    }

    setSize(width: number, height: number) {
        this.size.set(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
        this.targets.forEach(target => target.setSize(this.size.x, this.size.y));
        this.material.uniforms.uAspect!.value = width / Math.max(1, height);
    }

    configure(settings: KonbiniLensSettings, depthRange: number, time: number) {
        const uniforms = this.material.uniforms;
        uniforms.uDepthRange!.value = depthRange;
        uniforms.uFocus!.value = settings.focus;
        uniforms.uFocusBand!.value = settings.focusBand;
        uniforms.uFocusFalloff!.value = settings.focusFalloff;
        uniforms.uDof!.value = this.dofEnabled ? settings.dof : 0;
        uniforms.uTilt!.value = this.dofEnabled ? settings.tilt : 0;
        uniforms.uAberration!.value = settings.aberration;
        uniforms.uVignette!.value = settings.vignette;
        uniforms.uGrain!.value = settings.grain;
        uniforms.uTime!.value = time;
    }

    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        const [a, b] = this.targets as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
        if (this.dofEnabled) {
            this.copy.uniforms.tDiffuse!.value = readBuffer.texture;
            this.quad.material = this.copy;
            renderer.setRenderTarget(a);
            this.quad.render(renderer);
            const passes: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget, number, number][] = [[a, b, 1.6, 0], [b, a, 0, 1.6], [a, b, 2.6, 0], [b, a, 0, 2.6]];
            passes.forEach(([from, to, x, y]) => {
                this.gauss.uniforms.tDiffuse!.value = from.texture;
                (this.gauss.uniforms.uStep!.value as THREE.Vector2).set(x / this.size.x, y / this.size.y);
                this.quad.material = this.gauss;
                renderer.setRenderTarget(to);
                this.quad.render(renderer);
            });
        }
        const uniforms = this.material.uniforms;
        uniforms.tDiffuse!.value = readBuffer.texture;
        uniforms.tBlur!.value = this.dofEnabled ? a.texture : readBuffer.texture;
        uniforms.tDepth!.value = this.scene.target.depthTexture;
        this.quad.material = this.material;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.targets.forEach(target => target.dispose());
        this.gauss.dispose();
        this.copy.dispose();
        this.material.dispose();
        this.quad.dispose();
    }
}
