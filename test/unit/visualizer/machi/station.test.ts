import { describe, expect, it } from 'vitest';
import { MACHI_BASE } from '@/components/visualizer/machi/engine/geometry/plinth';
import { CANOPY, CAR, STALLS, STATION_VIEW, TRUCK, TRUCK_SCREEN } from '@/components/visualizer/machi/scenes/station/layout';
import { resolveStationVariation } from '@/components/visualizer/machi/scenes/station/stationSeed';

// test/unit/visualizer/machi/station.test.ts
// 加油站停车场：按歌变的东西是确定的、前排至少一辆出租车（顶灯要滚歌词）；货车屏幕与出租车顶灯都朝 +z，
// 离默认镜头方向不超过 30°；车位、货车、罩棚互不重叠，都在底座里。

describe('station variation', () => {
    it('is deterministic and always parks at least one taxi', () => {
        for (let index = 0; index < 300; index += 1) {
            const seed = `song-${index}`;
            const variation = resolveStationVariation(seed, 7, 4);
            expect(resolveStationVariation(seed, 7, 4)).toEqual(variation);
            expect(variation.stalls).toHaveLength(STALLS.x.length);
            expect(variation.stalls).toContain('taxi');
            expect(variation.taxiLivery).toBeLessThan(4);
            variation.carColors.forEach(color => expect(color).toBeLessThan(7));
            if (variation.hazardStall >= 0) expect(variation.stalls[variation.hazardStall]).toBe('sedan');
        }
    });
});

describe('station layout', () => {
    it('turns the truck screen and the taxi signs towards the default camera', () => {
        // 屏幕与顶灯的法线都是 +z（方位角 0），默认镜头在方位角 25°。
        expect(Math.abs(STATION_VIEW.azimuth) * 180 / Math.PI).toBeLessThanOrEqual(30);
        expect(TRUCK_SCREEN.width).toBeGreaterThan(4.4);
        expect(TRUCK_SCREEN.z).toBeGreaterThan(TRUCK.z1);
    });

    it('keeps the truck, the canopy and the parked cars apart and on the base', () => {
        const half = MACHI_BASE.half;
        const boxes = [
            { name: 'truck', x0: TRUCK.rear, x1: TRUCK.front, z0: TRUCK.z0, z1: TRUCK.z1 },
            { name: 'canopy', x0: CANOPY.x0, x1: CANOPY.x1, z0: CANOPY.z0, z1: CANOPY.z1 },
            ...STALLS.x.map((x, index) => ({ name: `stall${index}`, x0: x - CAR.width / 2, x1: x + CAR.width / 2, z0: STALLS.z - CAR.length / 2 + 0.15, z1: STALLS.z + CAR.length / 2 + 0.15 })),
        ];
        boxes.forEach(box => {
            expect(box.x0).toBeGreaterThanOrEqual(-half);
            expect(box.x1).toBeLessThanOrEqual(half);
            expect(box.z0).toBeGreaterThanOrEqual(-half);
            expect(box.z1).toBeLessThanOrEqual(half);
        });
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
            const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
            expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
        }));
    });
});
