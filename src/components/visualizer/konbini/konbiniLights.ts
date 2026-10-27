import * as THREE from 'three';
import { DOOR, LEVEL, PROPS, STORE } from './geometry/layout';
import type { KonbiniColorBlend, KonbiniMaterials } from './konbiniMaterials';

// src/components/visualizer/konbini/konbiniLights.ts
// 雨町的灯：半球光（深蓝的天、更暗的地）、一盏月光平行光投柔和阴影（阴影图只在需要时重画）、店内两盏暖光、
// 玻璃外两盏溢出的暖光把店前场地照亮、路灯一盏聚光、贩卖机一盏冷光。地上的光斑用加色贴片画，不用投影光。
// 卡通渐变只把角度量化，距离衰减照常平滑，所以光照出来是一块块柔和的光池。

/** 光斑贴图：柔边的长方形（靠店的一侧更亮）与圆。 */
const createPoolTexture = (round: boolean) => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = (x + 0.5) / size * 2 - 1;
            const v = (y + 0.5) / size * 2 - 1;
            const d = round ? Math.hypot(u, v) : Math.max(Math.abs(u) * 0.9, Math.abs(v));
            const falloff = Math.max(0, 1 - d);
            const bias = round ? 1 : 0.55 + 0.45 * (1 - (v + 1) / 2);
            const value = Math.round(255 * falloff * falloff * bias);
            const index = (y * size + x) * 4;
            image.data[index] = value;
            image.data[index + 1] = value;
            image.data[index + 2] = value;
            image.data[index + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
};

export interface KonbiniLightLevels {
    /** 店内与溢出光（副歌加亮、开门时多漏一点）。 */
    interior: number;
    /** 路灯（偶尔闪一下）。 */
    street: number;
}

export class KonbiniLights {
    readonly group = new THREE.Group();
    readonly moon: THREE.DirectionalLight;
    private readonly hemi: THREE.HemisphereLight;
    private readonly interior: THREE.PointLight[];
    private readonly spill: THREE.PointLight[];
    private readonly street: THREE.SpotLight;
    private readonly vending: THREE.PointLight;
    private readonly pools: THREE.Mesh[] = [];
    private readonly poolMaterials: { material: THREE.MeshBasicMaterial; key: 'spillLight' | 'streetLight' | 'vendingLight'; level: number }[] = [];
    private levels: KonbiniLightLevels = { interior: 1, street: 1 };
    private readonly stripTexture = createPoolTexture(false);
    private readonly roundTexture = createPoolTexture(true);

    constructor(private readonly blend: KonbiniColorBlend, materials: KonbiniMaterials, streetLampHead: THREE.Vector3, shadowMapSize: number) {
        this.group.name = 'Lights';
        this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 2.1);
        this.hemi.name = 'Lights/hemi';

        this.moon = new THREE.DirectionalLight(0xffffff, 1.35);
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

        const point = (intensity: number, distance: number, position: [number, number, number], name: string) => {
            const light = new THREE.PointLight(0xffffff, intensity, distance, 2);
            light.position.set(...position);
            light.name = name;
            return light;
        };
        this.interior = [
            point(9, 9, [-3.2, STORE.wallHeight - 0.45, -1.6], 'Lights/interior0'),
            point(8, 9, [-1.0, STORE.wallHeight - 0.45, -3.6], 'Lights/interior1'),
        ];
        this.spill = [
            point(4.2, 6, [-2.8, 1.9, STORE.z1 + 0.9], 'Lights/spill0'),
            point(3.6, 6, [STORE.x1 + 0.9, 1.9, -0.9], 'Lights/spill1'),
        ];
        this.street = new THREE.SpotLight(0xffffff, 26, 9, 0.95, 0.65, 2);
        this.street.name = 'Lights/street';
        this.street.position.copy(streetLampHead);
        this.street.target.position.set(streetLampHead.x - 0.3, 0, streetLampHead.z);
        this.vending = point(2.4, 3.2, [PROPS.vending.x + PROPS.vending.depth + 0.5, 1.3, (PROPS.vending.z[0] + PROPS.vending.z[1]) / 2], 'Lights/vending');

        // 地上的光斑：玻璃前一长条、门口一块、路灯下一圈、贩卖机前一块。加色、不写深度。
        const pool = (key: 'spillLight' | 'streetLight' | 'vendingLight', level: number, size: [number, number], at: [number, number], round: boolean) => {
            const material = materials.track(new THREE.MeshBasicMaterial({
                color: 0xffffff,
                map: round ? this.roundTexture : this.stripTexture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            const geometry = new THREE.PlaneGeometry(size[0], size[1]);
            geometry.rotateX(-Math.PI / 2);
            const result = new THREE.Mesh(geometry, material);
            result.position.set(at[0], LEVEL.lot + 0.006, at[1]);
            result.renderOrder = 1;
            result.name = `Pool/${key}`;
            this.pools.push(result);
            this.poolMaterials.push({ material, key, level });
            return result;
        };
        const doorMid = (DOOR.x0 + DOOR.x1) / 2;
        const pools = [
            pool('spillLight', 0.5, [STORE.x1 - STORE.frontPillarEnd + 0.6, 2.0], [(STORE.frontPillarEnd + STORE.x1) / 2, STORE.z1 + 1.0], false),
            pool('spillLight', 0.42, [2.2, 1.7], [doorMid, STORE.z1 + 0.95], true),
            pool('spillLight', 0.42, [3.6, 1.6], [STORE.x1 + 0.85, (STORE.rightGlassEnd + STORE.z1) / 2], false),
            pool('streetLight', 0.55, [3.4, 3.4], [streetLampHead.x - 0.3, streetLampHead.z], true),
            pool('vendingLight', 0.32, [1.4, 2.4], [PROPS.vending.x + PROPS.vending.depth + 0.6, (PROPS.vending.z[0] + PROPS.vending.z[1]) / 2], true),
        ];
        pools[2]!.rotation.y = Math.PI / 2;
        pools[3]!.position.y = LEVEL.road + 0.006;

        this.group.add(this.hemi, this.moon, this.moon.target, ...this.interior, ...this.spill, this.street, this.street.target, this.vending, ...pools);
        this.sync();
    }

    setLevels(levels: KonbiniLightLevels) {
        if (levels.interior === this.levels.interior && levels.street === this.levels.street) return;
        this.levels = levels;
        this.sync();
    }

    /** 颜色（插值后的）与亮度写回灯和光斑。 */
    sync() {
        const { interior, street } = this.levels;
        this.hemi.color.copy(this.blend.get('hemiSky'));
        this.hemi.groundColor.copy(this.blend.get('hemiGround'));
        this.moon.color.copy(this.blend.get('moon'));
        this.interior.forEach((light, index) => {
            light.color.copy(this.blend.get('interiorLight'));
            light.intensity = (index === 0 ? 9 : 8) * interior;
        });
        this.spill.forEach((light, index) => {
            light.color.copy(this.blend.get('spillLight'));
            light.intensity = (index === 0 ? 4.2 : 3.6) * interior;
        });
        this.street.color.copy(this.blend.get('streetLight'));
        this.street.intensity = 26 * street;
        this.vending.color.copy(this.blend.get('vendingLight'));
        this.poolMaterials.forEach(({ material, key, level }) => {
            const scale = key === 'streetLight' ? street : key === 'spillLight' ? interior : 1;
            material.color.copy(this.blend.get(key)).multiplyScalar(level * scale);
        });
    }

    /** 下一帧重画阴影图（建场景、开关门时）。 */
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
        this.pools.forEach(pool => pool.geometry.dispose());
        this.moon.shadow.map?.dispose();
        this.stripTexture.dispose();
        this.roundTexture.dispose();
    }
}
