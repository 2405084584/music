import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// src/components/visualizer/konbini/konbiniPost.ts
// 雨町的后处理：场景画进带深度贴图的 HDR 目标（可开 MSAA）→ 墨线（深度的拉普拉斯：正交投影下深度在平面上是线性的，
// 平面上二阶差分为零，只有轮廓与折角处不为零，所以一道 pass 同时描出外轮廓和折线；玻璃、雨、光斑不写深度，不被描）
// → 克制的 bloom（高阈值、低强度，只让招牌和灯头微微溢光）→ 色调映射与 sRGB 输出。

const INK_SHADER = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        tDepth: { value: null as THREE.Texture | null },
        uTexel: { value: new THREE.Vector2() },
        uDepthRange: { value: 100 },
        uThreshold: { value: 0.05 },
        uInk: { value: new THREE.Color(0x0b0f1a) },
        uStrength: { value: 0.82 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uTexel;
        uniform float uDepthRange;
        uniform float uThreshold;
        uniform vec3 uInk;
        uniform float uStrength;
        varying vec2 vUv;
        float depthAt(vec2 uv) { return texture2D(tDepth, uv).x * uDepthRange; }
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float d = depthAt(vUv);
            float l = depthAt(vUv - vec2(uTexel.x, 0.0));
            float r = depthAt(vUv + vec2(uTexel.x, 0.0));
            float u = depthAt(vUv + vec2(0.0, uTexel.y));
            float b = depthAt(vUv - vec2(0.0, uTexel.y));
            float lu = depthAt(vUv + vec2(-uTexel.x, uTexel.y));
            float rb = depthAt(vUv + vec2(uTexel.x, -uTexel.y));
            float ru = depthAt(vUv + uTexel);
            float lb = depthAt(vUv - uTexel);
            float laplace = abs(l + r - 2.0 * d) + abs(u + b - 2.0 * d) + 0.5 * (abs(lu + rb - 2.0 * d) + abs(ru + lb - 2.0 * d));
            float line = smoothstep(uThreshold, uThreshold * 2.6, laplace);
            // 天空（深度 = 远平面）那一侧不描，只描物体自己的边。
            line *= step(d, uDepthRange * 0.999);
            gl_FragColor = vec4(mix(color.rgb, uInk, line * uStrength), color.a);
        }
    `,
};

class KonbiniInkPass extends Pass {
    private readonly quad: FullScreenQuad;
    readonly material: THREE.ShaderMaterial;

    constructor() {
        super();
        this.material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(INK_SHADER.uniforms),
            vertexShader: INK_SHADER.vertexShader,
            fragmentShader: INK_SHADER.fragmentShader,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new FullScreenQuad(this.material);
    }

    setSize(width: number, height: number) {
        (this.material.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }

    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        this.material.uniforms.tDiffuse!.value = readBuffer.texture;
        this.material.uniforms.tDepth!.value = readBuffer.depthTexture;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.material.dispose();
        this.quad.dispose();
    }
}

export interface KonbiniPostOptions {
    samples: number;
    bloom: boolean;
}

export class KonbiniPost {
    private readonly composer: EffectComposer;
    private readonly ink = new KonbiniInkPass();
    private readonly bloom: UnrealBloomPass;
    private readonly renderTarget: THREE.WebGLRenderTarget;

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, private readonly camera: THREE.OrthographicCamera, options: KonbiniPostOptions) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const depthTexture = new THREE.DepthTexture(size.x, size.y);
        depthTexture.type = THREE.UnsignedIntType;
        this.renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
            samples: options.samples,
            depthTexture,
        });
        this.renderTarget.texture.name = 'konbini:scene';
        this.composer = new EffectComposer(renderer, this.renderTarget);
        this.composer.addPass(new RenderPass(scene, camera));
        this.composer.addPass(this.ink);
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.26, 0.35, 1.05);
        this.bloom.enabled = options.bloom;
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
    }

    setSize(width: number, height: number, pixelRatio: number) {
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);
        this.ink.setSize(width * pixelRatio, height * pixelRatio);
    }

    setBloom(enabled: boolean) {
        this.bloom.enabled = enabled;
    }

    /** 墨线的门槛跟着每个像素代表的世界尺寸走：缩放之后线不变粗也不消失。 */
    render(pixelWorldSize: number) {
        const uniforms = this.ink.material.uniforms;
        uniforms.uDepthRange!.value = this.camera.far - this.camera.near;
        uniforms.uThreshold!.value = Math.max(0.004, pixelWorldSize * 0.7);
        this.composer.render();
    }

    dispose() {
        this.ink.dispose();
        this.bloom.dispose();
        this.composer.dispose();
        this.renderTarget.depthTexture?.dispose();
        this.renderTarget.dispose();
    }
}
