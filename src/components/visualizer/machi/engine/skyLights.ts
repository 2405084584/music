import * as THREE from 'three';
import type { MachiColorBlend } from './materials';

// src/components/visualizer/machi/engine/skyLights.ts
// 三个场景共用的天光：半球光（天、地两色）与一盏平行光（夜里是月光，白天是太阳），平行光投柔和阴影，
// 阴影图只在需要时重画（建场景、开关门、环境变化）。场景自己的灯（店内、路灯、罩棚灯……）由场景挂。

const HEMI_INTENSITY = 2.1;
const MOON_INTENSITY = 1.35;

export class MachiSkyLights {
    readonly group = new THREE.Group();
    readonly moon: THREE.DirectionalLight;
    private readonly hemi: THREE.HemisphereLight;
    private flash = 0;

    constructor(private readonly blend: MachiColorBlend, shadowMapSize: number) {
        this.group.name = 'SkyLights';
        this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, HEMI_INTENSITY);
        this.hemi.name = 'Lights/hemi';

        this.moon = new THREE.DirectionalLight(0xffffff, MOON_INTENSITY);
        this.moon.name = 'Lights/moon';
        this.moon.position.set(-6.5, 14, -5);
        this.moon.target.position.set(0, 0, 0);
        this.moon.castShadow = true;
        this.moon.shadow.mapSize.set(shadowMapSize, shadowMapSize);
        const shadowCamera = this.moon.shadow.camera;
        shadowCamera.left = -9.5;
        shadowCamera.right = 9.5;
        shadowCamera.top = 9.5;
        shadowCamera.bottom = -9.5;
        shadowCamera.near = 1;
        shadowCamera.far = 40;
        this.moon.shadow.bias = -0.0006;
        this.moon.shadow.normalBias = 0.025;
        this.moon.shadow.radius = 3;
        this.moon.shadow.autoUpdate = false;
        this.group.add(this.hemi, this.moon, this.moon.target);
        this.sync();
    }

    /** 颜色（插值后的）写回。 */
    sync() {
        this.hemi.color.copy(this.blend.get('hemiSky'));
        this.hemi.groundColor.copy(this.blend.get('hemiGround'));
        this.moon.color.copy(this.blend.get('moon'));
    }

    /** 闪电：天光和月光一下子亮起来（0..1）。 */
    setFlash(flash: number) {
        if (flash === this.flash) return;
        this.flash = flash;
        this.hemi.intensity = HEMI_INTENSITY * (1 + 1.5 * flash);
        this.moon.intensity = MOON_INTENSITY * (1 + 1.2 * flash);
    }

    /** 下一帧重画阴影图。 */
    invalidateShadows() {
        this.moon.shadow.needsUpdate = true;
    }

    setShadowMapSize(size: number) {
        if (this.moon.shadow.mapSize.x === size) return;
        this.moon.shadow.mapSize.set(size, size);
        this.moon.shadow.map?.dispose();
        this.moon.shadow.map = null;
        this.invalidateShadows();
    }

    dispose() {
        this.moon.shadow.map?.dispose();
    }
}
