import type { Line } from '../../../../types';
import { hashVisualizerSeed, visualizerHash01 } from '../../visualizerSeedHash';
import { DOOR, LEVEL, ROAD, STORE } from '../geometry/layout';
import type { KonbiniVariation } from '../konbiniSeed';

// src/components/visualizer/konbini/actors/konbiniSchedules.ts
// 雨町里会动的东西什么时候出现、走到哪（纯函数，只依赖时间与 seed）：
// - 车：按氛围时间切成窗口，每个窗口按哈希决定有没有一辆车、走哪条车道、什么颜色；同时最多一辆。
// - 路人：撑伞沿路边走过（两条路线、两个方向），也按窗口哈希。
// - 顾客：跟着开门的时刻表——偶数次开门有人进店（到门口时门正好全开），进去后在货架前逛；下一次开门他出来、
//   走斑马线离开。都按歌曲时间算，拖进度条也对得上。
// - 闪电：每段副歌开头一道（两下闪），按歌曲时间。

export type KonbiniPathPoint = readonly [x: number, y: number, z: number];

export interface KonbiniPathSample {
    x: number;
    y: number;
    z: number;
    /** 朝向（绕 y 的角度，0 朝 +z）。 */
    heading: number;
    /** 已经走到终点。 */
    done: boolean;
}

export const pathLength = (path: readonly KonbiniPathPoint[]) => {
    let length = 0;
    for (let index = 1; index < path.length; index += 1) {
        const [ax, , az] = path[index - 1]!;
        const [bx, , bz] = path[index]!;
        length += Math.hypot(bx - ax, bz - az);
    }
    return length;
};

/** 沿折线走 distance 米的位置与朝向（超出终点停在终点）。 */
export const samplePath = (path: readonly KonbiniPathPoint[], distance: number): KonbiniPathSample => {
    let remaining = Math.max(0, distance);
    for (let index = 1; index < path.length; index += 1) {
        const [ax, ay, az] = path[index - 1]!;
        const [bx, by, bz] = path[index]!;
        const segment = Math.hypot(bx - ax, bz - az);
        const heading = Math.atan2(bx - ax, bz - az);
        if (remaining <= segment || index === path.length - 1) {
            const t = segment > 0 ? Math.min(1, remaining / segment) : 1;
            return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t, heading, done: remaining >= segment && index === path.length - 1 };
        }
        remaining -= segment;
    }
    const [x, y, z] = path[path.length - 1]!;
    return { x, y, z, heading: 0, done: true };
};

// —— 车 ——————————————————————————————————————————————————————————————

/** 四条车道（靠左行驶）：前路东行 / 西行，右路北行 / 南行。两端伸出底座，车由裁切面从底座边缘“开出来”。 */
const LANE_REACH = 8;
export const KONBINI_LANES: readonly { from: readonly [number, number]; to: readonly [number, number] }[] = [
    { from: [-LANE_REACH, ROAD.inner + 0.92], to: [LANE_REACH, ROAD.inner + 0.92] },
    { from: [LANE_REACH, ROAD.outer - 1.12], to: [-LANE_REACH, ROAD.outer - 1.12] },
    { from: [ROAD.inner + 0.92, LANE_REACH], to: [ROAD.inner + 0.92, -LANE_REACH] },
    { from: [ROAD.outer - 1.12, -LANE_REACH], to: [ROAD.outer - 1.12, LANE_REACH] },
];
export const KONBINI_CAR_SPEED = 3.4;
const CAR_WINDOW = 9.5;
const CAR_TRAVEL = (LANE_REACH * 2) / KONBINI_CAR_SPEED;

export interface KonbiniCarPass {
    lane: number;
    /** 沿车道走过的米数。 */
    distance: number;
    colorIndex: number;
}

/** 时刻 time（氛围时钟）路上的车：没有就是 null。chance 是每个窗口有车的概率。 */
export const resolveKonbiniCar = (time: number, seed: string | number, chance = 0.62): KonbiniCarPass | null => {
    const key = hashVisualizerSeed(`car:${seed}`);
    const window = Math.floor(time / CAR_WINDOW);
    // 一辆车可能跨进下一个窗口：先看上一个窗口的车有没有开完。
    for (const index of [window, window - 1]) {
        if (visualizerHash01(key, index, 0x11) > chance) continue;
        const start = index * CAR_WINDOW + visualizerHash01(key, index, 0x22) * (CAR_WINDOW * 0.5);
        const local = time - start;
        if (local < 0 || local > CAR_TRAVEL) continue;
        return {
            lane: Math.floor(visualizerHash01(key, index, 0x33) * KONBINI_LANES.length),
            distance: local * KONBINI_CAR_SPEED,
            colorIndex: Math.floor(visualizerHash01(key, index, 0x44) * 1000),
        };
    }
    return null;
};

// —— 路人 ————————————————————————————————————————————————————————————

/** 路人走路边（这样的小街没有人行道，人沿白线外侧走）：前路远侧、右路远侧。 */
export const KONBINI_STROLL_ROUTES: readonly (readonly KonbiniPathPoint[])[] = [
    [[-6.6, LEVEL.road, ROAD.outer - 0.2], [6.6, LEVEL.road, ROAD.outer - 0.2]],
    [[ROAD.outer - 0.2, LEVEL.road, -6.6], [ROAD.outer - 0.2, LEVEL.road, 6.6]],
];
export const KONBINI_WALK_SPEED = 1.05;
const STROLL_WINDOW = 15;

export interface KonbiniStroll {
    route: number;
    reverse: boolean;
    distance: number;
    look: number;
}

export const resolveKonbiniStroll = (time: number, seed: string | number, chance = 0.55): KonbiniStroll | null => {
    const key = hashVisualizerSeed(`stroll:${seed}`);
    const window = Math.floor(time / STROLL_WINDOW);
    for (const index of [window, window - 1]) {
        if (visualizerHash01(key, index, 0x15) > chance) continue;
        const route = Math.floor(visualizerHash01(key, index, 0x25) * KONBINI_STROLL_ROUTES.length);
        const length = pathLength(KONBINI_STROLL_ROUTES[route]!);
        const start = index * STROLL_WINDOW + visualizerHash01(key, index, 0x35) * 3;
        const distance = (time - start) * KONBINI_WALK_SPEED;
        if (distance < 0 || distance > length) continue;
        return { route, reverse: visualizerHash01(key, index, 0x45) < 0.5, distance, look: Math.floor(visualizerHash01(key, index, 0x55) * 1000) };
    }
    return null;
};

// —— 顾客 ————————————————————————————————————————————————————————————

const DOOR_X = (DOOR.x0 + DOOR.x1) / 2;
const OUT = LEVEL.lot;
const IN = LEVEL.floor;
/** 店里逛的位置：杂志架与第一排货架之间。 */
const BROWSE: KonbiniPathPoint = [-2.6, IN, -0.72];
/** 进店：从对面人行道下来过斑马线，上路缘，绕开门口的立牌，进门，走到货架前。 */
export const KONBINI_ENTER_PATH: readonly KonbiniPathPoint[] = [
    [1.05, OUT, 6.5],
    [1.05, OUT, ROAD.outer + 0.16],
    [1.05, LEVEL.road, ROAD.outer - 0.1],
    [1.05, LEVEL.road, ROAD.inner + 0.1],
    [0.85, OUT, ROAD.inner - 0.25],
    [0.4, OUT, 1.62],
    [DOOR_X, OUT, 1.0],
    [DOOR_X, OUT, STORE.z1 + 0.05],
    [DOOR_X, IN, -0.4],
    BROWSE,
];
/** 出店：从货架前到门口，出门往右，沿场地边走到右路的斑马线，过马路离开。 */
export const KONBINI_EXIT_PATH: readonly KonbiniPathPoint[] = [
    BROWSE,
    [DOOR_X, IN, -0.4],
    [DOOR_X, OUT, STORE.z1 + 0.05],
    [DOOR_X, OUT, 1.0],
    [0.4, OUT, 1.62],
    [1.85, OUT, 1.62],
    [1.95, OUT, 0.0],
    [ROAD.inner + 0.1, LEVEL.road, -0.05],
    [ROAD.outer - 0.1, LEVEL.road, -0.05],
    [ROAD.outer + 0.16, OUT, -0.05],
    [6.6, OUT, -0.05],
];
/** 走到门槛时门应当已经开到全开：开门时刻之后这么多秒。 */
const ENTER_AT_DOOR = 1.6;
const EXIT_AT_DOOR = 1.8;
const ENTER_TO_DOOR = pathLength(KONBINI_ENTER_PATH.slice(0, 8));
const EXIT_TO_DOOR = pathLength(KONBINI_EXIT_PATH.slice(0, 3));
/** 开门之前多久开始走。 */
export const KONBINI_ENTER_LEAD = ENTER_TO_DOOR / KONBINI_WALK_SPEED - ENTER_AT_DOOR;
export const KONBINI_EXIT_LEAD = EXIT_TO_DOOR / KONBINI_WALK_SPEED - EXIT_AT_DOOR;

export interface KonbiniDoorEvent {
    time: number;
    /** 全曲第几次开门（偶数进、奇数出）。 */
    index: number;
}

/** time 前后一段里的开门时刻：有歌词的歌用时刻表，纯音乐按 seed 的周期。 */
export const listKonbiniDoorEvents = (
    events: readonly number[],
    time: number,
    variation: Pick<KonbiniVariation, 'doorInterval' | 'doorPhase'>,
    instrumental: boolean,
    span = 40,
): KonbiniDoorEvent[] => {
    if (instrumental || events.length === 0) {
        const first = Math.ceil((time - span) / variation.doorInterval + variation.doorPhase);
        const last = Math.floor((time + span) / variation.doorInterval + variation.doorPhase);
        const result: KonbiniDoorEvent[] = [];
        for (let n = Math.max(0, first); n <= last; n += 1) result.push({ time: (n - variation.doorPhase) * variation.doorInterval, index: n });
        return result;
    }
    return events.map((value, index) => ({ time: value, index })).filter(event => Math.abs(event.time - time) <= span);
};

export interface KonbiniCustomer {
    path: 'enter' | 'exit';
    distance: number;
    /** 进店后站着逛。 */
    browsing: boolean;
    look: number;
}

/**
 * 两个顾客位：A 是最近一次“进店”开门的人（进来后在货架前逛，直到下一次开门他开始往外走）；
 * B 是最近一次“出店”开门往外走的人（走出底座就消失）。
 */
export const resolveKonbiniCustomers = (doorEvents: readonly KonbiniDoorEvent[], time: number): [KonbiniCustomer | null, KonbiniCustomer | null] => {
    let enter: KonbiniDoorEvent | null = null;
    let exit: KonbiniDoorEvent | null = null;
    doorEvents.forEach(event => {
        if (event.index % 2 === 0 && event.time - KONBINI_ENTER_LEAD <= time && (!enter || event.time > enter.time)) enter = event;
        if (event.index % 2 === 1 && event.time - KONBINI_EXIT_LEAD <= time && (!exit || event.time > exit.time)) exit = event;
    });
    let a: KonbiniCustomer | null = null;
    const entered = enter as KonbiniDoorEvent | null;
    if (entered) {
        const leaving = doorEvents.find(event => event.index === entered.index + 1);
        if (!leaving || time < leaving.time - KONBINI_EXIT_LEAD) {
            const distance = (time - (entered.time - KONBINI_ENTER_LEAD)) * KONBINI_WALK_SPEED;
            const length = pathLength(KONBINI_ENTER_PATH);
            a = { path: 'enter', distance: Math.min(distance, length), browsing: distance >= length, look: entered.index };
        }
    }
    let b: KonbiniCustomer | null = null;
    const left = exit as KonbiniDoorEvent | null;
    if (left && left.index > 0) {
        const distance = (time - (left.time - KONBINI_EXIT_LEAD)) * KONBINI_WALK_SPEED;
        if (distance <= pathLength(KONBINI_EXIT_PATH)) b = { path: 'exit', distance, browsing: false, look: left.index - 1 };
    }
    return [a, b];
};

// —— 闪电 ————————————————————————————————————————————————————————————

const isChorus = (line: Line | undefined) => !!line && (line.isChorus === true || /chorus|副歌/i.test(line.songPart ?? ''));

/** 每段副歌的开头（相邻副歌行算一段）。 */
export const buildKonbiniLightningTimes = (lines: readonly Line[]) => lines
    .filter((line, index) => isChorus(line) && !isChorus(lines[index - 1]))
    .map(line => line.startTime);

/** 闪电亮度 0..1：两下闪，第二下略弱，一秒内收尽。 */
export const resolveKonbiniLightning = (times: readonly number[], time: number) => {
    let since = Infinity;
    for (let index = times.length - 1; index >= 0; index -= 1) {
        if (times[index]! <= time) {
            since = time - times[index]!;
            break;
        }
    }
    if (since > 1.2) return 0;
    const flash = (at: number, width: number, height: number) => height * Math.exp(-((since - at) ** 2) / (width * width));
    return Math.min(1, flash(0.04, 0.05, 1) + flash(0.24, 0.06, 0.7) + 0.25 * Math.exp(-since * 3.5));
};
