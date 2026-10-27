// src/components/visualizer/machi/scenes/station/layout.ts
// 加油站停车场的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。默认镜头从正前偏右 25° 看过来，
// 所以高的东西（加油站罩棚、货车）都放在后排，前排只有车和细高的立牌：仰角 30° 下前排的东西投到画面里更低，
// 挡不到后排的货车屏幕。货车侧面的屏幕、出租车顶灯都朝 +z，离镜头方向 25°。

export const DEG = Math.PI / 180;

/** 各层地面的高度：路面与停车场同高，加油区是抬高一点的混凝土。 */
export const LEVEL = {
    road: 0,
    lot: 0.02,
    apron: 0.1,
} as const;

/** 前面一条路（沿 x），一直通到底座边上；停车场在路后面，中间一道路缘、两处出入口。 */
export const ROAD = {
    z0: 3.5,
    z1: 6,
    curb: 0.16,
    /** 两条车道的中线（靠左行驶）：近的一条往 +x，远的一条往 -x。 */
    lanes: [4.15, 5.35] as const,
    /** 路缘在这两段断开，是出入口。 */
    gaps: [[-1.2, 0.8], [1.8, 3.6]] as const,
} as const;

/** 加油站罩棚：后排右边，四根柱子，前沿与右沿挂品牌条。 */
export const CANOPY = {
    x0: 1.4,
    x1: 5.9,
    z0: -5.6,
    z1: -1.4,
    /** 罩棚底面与顶面。 */
    under: 3.85,
    top: 4.3,
    columns: [[2.05, -2.1], [5.25, -2.1], [2.05, -4.9], [5.25, -4.9]] as const,
} as const;

/** 加油岛：两座，沿 x，各两台加油机。 */
export const ISLANDS = {
    x0: 2.45,
    x1: 4.85,
    z: [-4.35, -2.75] as const,
    width: 0.5,
    height: 0.16,
    pumps: [3.05, 4.25] as const,
} as const;

/** 抬高的加油区（混凝土）：罩棚下和罩棚前的一片。 */
export const APRON = {
    x0: 1.2,
    x1: 6,
    z0: -6,
    z1: 0.4,
} as const;

/** 货车（アドトラック）：后排左边，沿 x 停着，货厢侧面朝 +z 是一块 LED 屏；车头朝 +x。 */
export const TRUCK = {
    rear: -5.85,
    front: 1.1,
    z0: -5.7,
    z1: -3.6,
    deck: 1.0,
    boxTop: 3.4,
    /** 货厢到这里为止，往前是车头。 */
    boxFront: -0.7,
    cabBack: -0.55,
    cabTop: 2.75,
} as const;

/** 货厢侧面的屏幕（屏幕面的中心与尺寸）。 */
export const TRUCK_SCREEN = {
    x: (TRUCK.rear + TRUCK.boxFront) / 2,
    y: (TRUCK.deck + 0.22 + TRUCK.boxTop - 0.16) / 2,
    z: TRUCK.z1 + 0.03,
    width: TRUCK.boxFront - TRUCK.rear - 0.36,
    height: TRUCK.boxTop - 0.16 - (TRUCK.deck + 0.22),
} as const;

/** 前排的停车位：车头朝 +z（朝路），车身沿 z。 */
export const STALLS = {
    x: [-4.75, -2.85, -0.95] as const,
    z: 0.0,
    width: 1.9,
    depth: 3.6,
} as const;

/** 车的尺寸（沿车长、车宽、高）。 */
export const CAR = { length: 3.2, width: 1.42, height: 1.38 } as const;

/** 加油机旁停着的一辆（沿 x，车头朝 +x），与罩棚前排的空地上一辆轻卡。 */
export const PUMP_CAR = { x: 3.65, z: -1.75 } as const;
export const KEI_TRUCK = { x: 4.35, z: 1.35 } as const;

/** 路边的价格立柱、汽车旅馆的高立牌、场地灯。 */
export const PYLON = { x: 5.35, z: 2.75, height: 4.1, width: 1.0 } as const;
export const MOTEL_SIGN = { x: -5.25, z: 2.75, height: 6.4 } as const;
export const LOT_LAMP = { x: 0.9, z: 2.85, height: 5.0, arm: 1.2 } as const;

/** 默认视角：从正前偏右 25° 斜俯视（方位角按 three 的球坐标，从 +z 转向 +x）。 */
export const STATION_VIEW = {
    azimuth: 25 * DEG,
    elevation: 30 * DEG,
    zoom: 1.32,
} as const;
