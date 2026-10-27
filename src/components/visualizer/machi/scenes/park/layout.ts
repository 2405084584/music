// src/components/visualizer/machi/scenes/park/layout.ts
// 樱花公园的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。后排正中一座樱花祭的小舞台，两根高杆之间挂着
// 「桜まつり」横幅（当前行）；前面一串写着下一句的提灯；左边池塘与红色拱桥，右边游乐设施；樱花树围着一圈。
// 横幅在后排、离镜头最远，前面的东西在仰角下投到画面里更低，挡不到它。

export const DEG = Math.PI / 180;

/** 各层高度：草地、石子路、池水面、舞台台面。 */
export const LEVEL = {
    grass: 0.05,
    path: 0.065,
    water: 0.06,
    stage: 0.6,
} as const;

/** 石子路：一条主路从前面通到舞台前的小广场，一条横路连起池塘与游乐区。 */
export const PATHS: readonly { x0: number; x1: number; z0: number; z1: number }[] = [
    { x0: -0.85, x1: 0.85, z0: -2.2, z1: 6 },
    { x0: -1.35, x1: 5.6, z0: -0.25, z1: 0.75 },
    { x0: -2.9, x1: 1.15, z0: -3.0, z1: -2.0 },
];

/** 池塘：椭圆，沿 z 长；一座红色拱桥沿 x 横跨。 */
export const POND = { x: -3.15, z: 0.75, rx: 1.45, rz: 2.15 } as const;
export const BRIDGE = { x0: -4.85, x1: -1.45, z: 0.75, width: 0.8, rise: 0.55 } as const;

/** 樱花祭的舞台：台子、后面两根高杆、杆间的横幅。整组转向默认镜头一点。 */
export const STAGE = {
    x: -0.05,
    z: -3.75,
    width: 3.6,
    depth: 1.5,
    /** 横幅杆在台子后沿，左右各一根。 */
    poleSpan: 5.7,
    poleBack: 0.45,
    poleHeight: 5.0,
    bannerWidth: 5.3,
    bannerHeight: 1.45,
    bannerTop: 4.6,
    rotationY: 18 * DEG,
} as const;

/** 樱花树：位置、大小（1 是约 4.6m 高）。都在两侧与后角，不挡横幅，也不压在离镜头最近的前右角。 */
export const TREES: readonly { x: number; z: number; scale: number }[] = [
    { x: -5.2, z: -4.6, scale: 1.0 },
    { x: -5.05, z: -1.05, scale: 0.88 },
    { x: 4.95, z: -3.75, scale: 1.05 },
    { x: 5.1, z: -0.6, scale: 0.84 },
    { x: -5.1, z: 4.5, scale: 0.78 },
    { x: 2.9, z: -5.35, scale: 0.72 },
];

/** 写下一句的提灯：前面一串，挂在两根杆之间；舞台杆往两边树上各一串不写字的。 */
export const LANTERN_LINE = {
    from: [-5.35, 3.35, 3.05] as const,
    to: [5.35, 3.35, 3.05] as const,
    sag: 0.55,
    count: 12,
} as const;

/** 游乐设施。 */
export const PLAYGROUND = {
    swings: { x: 3.35, z: 1.55, width: 2.4, height: 2.25 },
    slide: { x: 4.1, z: -1.75 },
    jungleGym: { x: 2.05, z: -1.75, size: 1.45 },
    seesaw: { x: 1.75, z: 2.2 },
    sandbox: { x: 2.35, z: 4.15, size: 1.6 },
    springRider: { x: 4.35, z: 3.75 },
} as const;

/** 园灯、长椅、贩卖机、公园时钟。 */
export const LAMPS: readonly [number, number][] = [[-1.35, 3.7], [1.35, -2.25], [-1.4, -2.3]];
export const BENCHES: readonly { x: number; z: number; rotationY: number }[] = [
    { x: -3.2, z: 3.45, rotationY: 0 },
    { x: 1.55, z: 4.75, rotationY: -Math.PI / 2 },
    { x: -3.05, z: -2.75, rotationY: 0.3 },
];
export const VENDING = { x: -1.75, z: 5.05 } as const;
export const CLOCK = { x: 1.35, z: 0.95, height: 2.9 } as const;

/** 默认视角：从前右斜俯视。 */
export const PARK_VIEW = {
    azimuth: 35 * DEG,
    elevation: 32 * DEG,
    zoom: 1.32,
} as const;
