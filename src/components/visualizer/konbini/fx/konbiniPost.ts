import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    KonbiniAtmospherePass,
    KonbiniLensPass,
    KonbiniStreakPass,
    type KonbiniLensSettings,
    type KonbiniSceneTarget,
} from './konbiniPostPasses';

// src/components/visualizer/konbini/fx/konbiniPost.ts
// 雨町的后处理链：场景画进单独一张带深度贴图的 HDR 目标（MSAA，不参与合成器的来回交换）→ 氛围（墨线、贴地薄雾与灯的散射、云和闪电）
// → bloom（柔和、宽，让招牌和灯在雨夜里晕开）→ 横向镜头光条 → 镜头（微缩景深、色差、暗角、颗粒）→ 色调映射输出。
// 画质降级时依次关掉景深、光条、bloom；预览里只留氛围和镜头的暗角颗粒。

export interface KonbiniPostOptions {
    samples: number;
    bloom: boolean;
    streaks: boolean;
    dof: boolean;
}

export interface KonbiniAtmosphereFrame {
    time: number;
    mistColor: THREE.Color;
    mistAmount: number;
    cloudColor: THREE.Color;
    lightning: number;
    /** 雾里的两处灯：xyz 位置、半径，颜色已乘好亮度。 */
    glowA: THREE.Vector4;
    glowColorA: THREE.Color;
    glowB: THREE.Vector4;
    glowColorB: THREE.Color;
    wind: THREE.Vector2;
}

export class KonbiniPost {
    private readonly composer: EffectComposer;
    private readonly scene: KonbiniSceneTarget;
    private readonly atmosphere: KonbiniAtmospherePass;
    private readonly bloom: UnrealBloomPass;
    private readonly streaks: KonbiniStreakPass;
    private readonly lens: KonbiniLensPass;

    constructor(
        private readonly renderer: THREE.WebGLRenderer,
        private readonly sceneGraph: THREE.Scene,
        private readonly camera: THREE.OrthographicCamera,
        options: KonbiniPostOptions,
    ) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const depthTexture = new THREE.DepthTexture(size.x, size.y);
        depthTexture.type = THREE.UnsignedIntType;
        const target = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
            samples: options.samples,
            depthTexture,
        });
        target.texture.name = 'konbini:scene';
        this.scene = { target };
        this.composer = new EffectComposer(renderer);
        this.atmosphere = new KonbiniAtmospherePass(this.scene);
        this.composer.addPass(this.atmosphere);
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.62, 0.86);
        this.bloom.enabled = options.bloom;
        this.composer.addPass(this.bloom);
        this.streaks = new KonbiniStreakPass();
        this.streaks.enabled = options.streaks;
        this.composer.addPass(this.streaks);
        this.lens = new KonbiniLensPass(this.scene);
        this.lens.dofEnabled = options.dof;
        this.composer.addPass(this.lens);
        this.composer.addPass(new OutputPass());
    }

    setSize(width: number, height: number, pixelRatio: number) {
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);
        this.scene.target.setSize(Math.max(1, Math.round(width * pixelRatio)), Math.max(1, Math.round(height * pixelRatio)));
    }

    setQuality(options: Pick<KonbiniPostOptions, 'bloom' | 'streaks' | 'dof'>) {
        this.bloom.enabled = options.bloom;
        this.streaks.enabled = options.streaks;
        this.lens.dofEnabled = options.dof;
    }

    /**
     * 画一帧。墨线门槛跟着每个像素代表的世界尺寸走，缩放后线不变粗也不消失；景深的对焦深度是镜头到目标点的距离，
     * 放大时景深变浅（越近越“微缩”）。
     */
    render(pixelWorldSize: number, focusDistance: number, atmosphere: KonbiniAtmosphereFrame, lens: Omit<KonbiniLensSettings, 'focus'>) {
        const camera = this.camera;
        const range = camera.far - camera.near;
        const uniforms = this.atmosphere.material.uniforms;
        uniforms.uDepthRange!.value = range;
        uniforms.uThreshold!.value = Math.max(0.004, pixelWorldSize * 0.7);
        (uniforms.uProjInv!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        (uniforms.uCamWorld!.value as THREE.Matrix4).copy(camera.matrixWorld);
        uniforms.uTime!.value = atmosphere.time;
        (uniforms.uMistColor!.value as THREE.Color).copy(atmosphere.mistColor);
        uniforms.uMistAmount!.value = atmosphere.mistAmount;
        (uniforms.uCloudColor!.value as THREE.Color).copy(atmosphere.cloudColor);
        uniforms.uLightning!.value = atmosphere.lightning;
        (uniforms.uGlowA!.value as THREE.Vector4).copy(atmosphere.glowA);
        (uniforms.uGlowColorA!.value as THREE.Color).copy(atmosphere.glowColorA);
        (uniforms.uGlowB!.value as THREE.Vector4).copy(atmosphere.glowB);
        (uniforms.uGlowColorB!.value as THREE.Color).copy(atmosphere.glowColorB);
        (uniforms.uWind!.value as THREE.Vector2).copy(atmosphere.wind);
        this.lens.configure({ ...lens, focus: focusDistance - camera.near }, range, atmosphere.time);
        this.renderer.setRenderTarget(this.scene.target);
        this.renderer.clear();
        this.renderer.render(this.sceneGraph, camera);
        this.composer.render();
    }

    dispose() {
        this.atmosphere.dispose();
        this.bloom.dispose();
        this.streaks.dispose();
        this.lens.dispose();
        this.composer.dispose();
        this.scene.target.depthTexture?.dispose();
        this.scene.target.dispose();
    }
}
