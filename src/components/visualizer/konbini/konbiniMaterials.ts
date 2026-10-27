import * as THREE from 'three';
import type { KonbiniPalette, KonbiniPaletteColorKey } from './konbiniPalette';

// src/components/visualizer/konbini/konbiniMaterials.ts
// 雨町的材质：克制的卡通着色（MeshToonMaterial + 4 阶渐变图），自发光件（招牌、灯头、冰柜内光）用 MeshBasicMaterial
// 输出高于 1 的线性色给 bloom 一点余量。颜色都从调色板来，换主题时由 KonbiniColorBlend 插值过去再写回材质。

/** 调色板摊平后的键：调色板里的单色键，加上三色条与 8 个商品色。 */
export type KonbiniColorKey = KonbiniPaletteColorKey | 'brand0' | 'brand1' | 'brand2' | `product${number}`;

export const flattenKonbiniPalette = (palette: KonbiniPalette): Record<KonbiniColorKey, string> => {
    const flat: Record<string, string> = {};
    (Object.keys(palette) as (keyof KonbiniPalette)[]).forEach(key => {
        const value = palette[key];
        if (typeof value === 'string') flat[key] = value;
    });
    palette.brand.forEach((color, index) => { flat[`brand${index}`] = color; });
    palette.products.forEach((color, index) => { flat[`product${index}`] = color; });
    return flat as Record<KonbiniColorKey, string>;
};

/** 换主题时颜色的插值：每个键一对当前 / 目标色，按指数阻尼追过去（与镜台的 COLOR_DAMP_RATE 同一个做法）。 */
export class KonbiniColorBlend {
    private readonly current = new Map<KonbiniColorKey, THREE.Color>();
    private readonly target = new Map<KonbiniColorKey, THREE.Color>();
    private settled = true;

    constructor(palette: KonbiniPalette) {
        Object.entries(flattenKonbiniPalette(palette)).forEach(([key, value]) => {
            this.current.set(key as KonbiniColorKey, new THREE.Color(value));
            this.target.set(key as KonbiniColorKey, new THREE.Color(value));
        });
    }

    setTarget(palette: KonbiniPalette, immediate = false) {
        Object.entries(flattenKonbiniPalette(palette)).forEach(([key, value]) => {
            const colorKey = key as KonbiniColorKey;
            const target = this.target.get(colorKey) ?? new THREE.Color();
            target.set(value);
            this.target.set(colorKey, target);
            if (immediate || !this.current.has(colorKey)) this.current.set(colorKey, target.clone());
        });
        this.settled = immediate;
    }

    /** 推进插值；返回这一步颜色有没有变。 */
    step(deltaSeconds: number, rate = 2.4): boolean {
        if (this.settled) return false;
        const k = 1 - Math.exp(-rate * deltaSeconds);
        let moving = false;
        this.current.forEach((color, key) => {
            const target = this.target.get(key)!;
            color.lerp(target, k);
            if (Math.abs(color.r - target.r) + Math.abs(color.g - target.g) + Math.abs(color.b - target.b) > 0.002) moving = true;
            else color.copy(target);
        });
        this.settled = !moving;
        return true;
    }

    get(key: KonbiniColorKey): THREE.Color {
        return this.current.get(key) ?? this.current.get('wall')!;
    }
}

/** 卡通着色件按调色板的哪个颜色上色。 */
export type KonbiniToonRole =
    | 'asphalt' | 'concrete' | 'curb' | 'roadPaint'
    | 'plinthTop' | 'plinthMid' | 'plinthLow' | 'plinthTrim'
    | 'wall' | 'trim' | 'roof' | 'frame'
    | 'interiorFloor' | 'interiorWall' | 'shelf' | 'counter' | 'fridgeBody'
    | 'metal' | 'darkMetal' | 'pole' | 'rubber' | 'wire' | 'acUnit'
    | 'caution' | 'mirrorPole' | 'stopRed'
    | 'vendingBody' | 'vendingAccent' | 'bike' | 'umbrella'
    | 'brand0' | 'brand1' | 'brand2' | 'signBase' | 'white';

/** 自发光件：颜色键与亮度倍数（线性空间，> 1 才会被 bloom 轻轻带出光晕）。 */
export const KONBINI_GLOW_ROLES = {
    ceilingLight: { key: 'interiorLight', level: 2.4 },
    fridgeGlow: { key: 'vendingLight', level: 1.5 },
    vendingGlow: { key: 'vendingLight', level: 1.7 },
    lampHead: { key: 'streetLight', level: 3.2 },
    warmWindow: { key: 'interiorLight', level: 0.42 },
    snackCase: { key: 'spillLight', level: 1.6 },
    screen: { key: 'led', level: 1.3 },
    redLamp: { key: 'brand0', level: 1.0 },
    neonRim: { key: 'neon', level: 1.4 },
} as const satisfies Record<string, { key: KonbiniColorKey; level: number }>;

export type KonbiniGlowRole = keyof typeof KONBINI_GLOW_ROLES;

const TOON_KEY: Record<Exclude<KonbiniToonRole, 'white'>, KonbiniColorKey> = {
    asphalt: 'asphalt', concrete: 'concrete', curb: 'curb', roadPaint: 'roadPaint',
    plinthTop: 'plinthTop', plinthMid: 'plinthMid', plinthLow: 'plinthLow', plinthTrim: 'plinthTrim',
    wall: 'wall', trim: 'trim', roof: 'roof', frame: 'frame',
    interiorFloor: 'interiorFloor', interiorWall: 'interiorWall', shelf: 'shelf', counter: 'counter', fridgeBody: 'fridgeBody',
    metal: 'metal', darkMetal: 'darkMetal', pole: 'pole', rubber: 'rubber', wire: 'wire', acUnit: 'acUnit',
    caution: 'caution', mirrorPole: 'mirrorPole', stopRed: 'stopRed',
    vendingBody: 'vendingBody', vendingAccent: 'vendingAccent', bike: 'bike', umbrella: 'umbrella',
    brand0: 'brand0', brand1: 'brand1', brand2: 'brand2', signBase: 'signBase',
};

/** 4 阶的卡通渐变：暗部不压死，亮部一刀切，避免塑料感的连续高光。 */
const createToonGradient = () => {
    const data = new Uint8Array([86, 146, 206, 255]);
    const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
};

export class KonbiniMaterials {
    readonly gradient = createToonGradient();
    private readonly toons = new Map<KonbiniToonRole, THREE.MeshToonMaterial>();
    private readonly glows = new Map<KonbiniGlowRole, THREE.MeshBasicMaterial>();
    private readonly glowLevels = new Map<KonbiniGlowRole, number>();
    /** 透明落地玻璃：不写深度，透过它能看到（也能描到）店里。 */
    readonly glass: THREE.MeshToonMaterial;
    /** 商品、瓶子：白底，颜色走 InstancedMesh 的实例色。 */
    readonly product: THREE.MeshToonMaterial;
    private readonly extra: THREE.Material[] = [];

    constructor(private readonly blend: KonbiniColorBlend) {
        this.glass = new THREE.MeshToonMaterial({
            color: blend.get('glass'),
            gradientMap: this.gradient,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
        });
        this.glass.name = 'konbini:glass';
        this.product = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: this.gradient });
        this.product.name = 'konbini:product';
    }

    toon(role: KonbiniToonRole): THREE.MeshToonMaterial {
        let material = this.toons.get(role);
        if (!material) {
            material = new THREE.MeshToonMaterial({
                color: role === 'white' ? 0xffffff : this.blend.get(TOON_KEY[role]),
                gradientMap: this.gradient,
            });
            material.name = `konbini:${role}`;
            this.toons.set(role, material);
        }
        return material;
    }

    glow(role: KonbiniGlowRole): THREE.MeshBasicMaterial {
        let material = this.glows.get(role);
        if (!material) {
            material = new THREE.MeshBasicMaterial({ color: 0xffffff });
            material.name = `konbini:glow:${role}`;
            this.glows.set(role, material);
            this.syncGlow(role, material);
        }
        return material;
    }

    /** 自发光件的亮度调制（闪烁、副歌加亮），1 是常态。 */
    setGlowLevel(role: KonbiniGlowRole, level: number) {
        if (this.glowLevels.get(role) === level) return;
        this.glowLevels.set(role, level);
        const material = this.glows.get(role);
        if (material) this.syncGlow(role, material);
    }

    /** 外面另建的材质（招牌、天气）交给这里一起销毁。 */
    track<T extends THREE.Material>(material: T): T {
        this.extra.push(material);
        return material;
    }

    private syncGlow(role: KonbiniGlowRole, material: THREE.MeshBasicMaterial) {
        const spec = KONBINI_GLOW_ROLES[role];
        material.color.copy(this.blend.get(spec.key)).multiplyScalar(spec.level * (this.glowLevels.get(role) ?? 1));
    }

    /** 插值后的颜色写回所有材质。 */
    syncColors() {
        this.toons.forEach((material, role) => {
            if (role !== 'white') material.color.copy(this.blend.get(TOON_KEY[role]));
        });
        this.glass.color.copy(this.blend.get('glass'));
        this.glows.forEach((material, role) => this.syncGlow(role, material));
    }

    dispose() {
        this.toons.forEach(material => material.dispose());
        this.glows.forEach(material => material.dispose());
        this.glass.dispose();
        this.product.dispose();
        this.extra.forEach(material => material.dispose());
        this.gradient.dispose();
    }
}
