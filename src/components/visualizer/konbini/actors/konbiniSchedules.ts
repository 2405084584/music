import type { Line } from '../../../../types';
import { hashVisualizerSeed, visualizerHash01 } from '../../visualizerSeedHash';
import { ROAD } from '../geometry/layout';

// src/components/visualizer/konbini/actors/konbiniSchedules.ts
// 雨町里会动的东西什么时候出现、走到哪（纯函数，只依赖时间与 seed）：
// - 车：按氛围时间切成窗口，每个窗口按哈希决定有没有一辆车、走哪条车道、什么颜色；同时最多一辆。
// - 闪电：每段副歌开头一道（两下闪），按歌曲时间。

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
