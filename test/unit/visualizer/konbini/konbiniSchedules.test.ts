import { describe, expect, it } from 'vitest';
import {
    buildKonbiniLightningTimes,
    KONBINI_ENTER_LEAD,
    KONBINI_ENTER_PATH,
    KONBINI_EXIT_LEAD,
    KONBINI_EXIT_PATH,
    KONBINI_WALK_SPEED,
    listKonbiniDoorEvents,
    pathLength,
    resolveKonbiniCar,
    resolveKonbiniCustomers,
    resolveKonbiniLightning,
    resolveKonbiniStroll,
    samplePath,
} from '@/components/visualizer/konbini/actors/konbiniSchedules';
import { KONBINI_DOOR_TIMING, resolveKonbiniDoorOpenness } from '@/components/visualizer/konbini/konbiniDirector';
import { STORE } from '@/components/visualizer/konbini/geometry/layout';
import type { Line } from '@/types';

// test/unit/visualizer/konbini/konbiniSchedules.test.ts
// 雨町里会动的东西：车与路人按氛围时间确定地出现、同时最多一辆车；顾客跟着开门进出，跨门槛时门是全开的；
// 闪电落在每段副歌的开头。

const variation = { doorInterval: 30, doorPhase: 0.4 };

describe('samplePath', () => {
    const path = [[0, 0, 0], [3, 0, 0], [3, 0, 4]] as const;

    it('walks along the polyline and stops at the end', () => {
        expect(pathLength(path)).toBe(7);
        expect(samplePath(path, 1.5)).toMatchObject({ x: 1.5, z: 0, done: false });
        expect(samplePath(path, 5)).toMatchObject({ x: 3, z: 2, done: false });
        expect(samplePath(path, 99)).toMatchObject({ x: 3, z: 4, done: true });
    });

    it('faces the direction of travel', () => {
        expect(samplePath(path, 1).heading).toBeCloseTo(Math.PI / 2);
        expect(samplePath(path, 4).heading).toBeCloseTo(0);
    });
});

describe('traffic and strollers', () => {
    it('is deterministic and never has two cars at once', () => {
        for (let t = 0; t < 600; t += 0.37) {
            expect(resolveKonbiniCar(t, 'song')).toEqual(resolveKonbiniCar(t, 'song'));
        }
        const seen = Array.from({ length: 2000 }, (_, index) => resolveKonbiniCar(index * 0.3, 'song')).filter(Boolean);
        expect(seen.length).toBeGreaterThan(100);
        seen.forEach(car => expect(car!.lane).toBeGreaterThanOrEqual(0));
    });

    it('sends fewer cars when the chance is lower', () => {
        const count = (chance: number) => Array.from({ length: 3000 }, (_, index) => resolveKonbiniCar(index * 0.2, 'busy', chance)).filter(Boolean).length;
        expect(count(0.3)).toBeLessThan(count(0.9));
        expect(count(0)).toBe(0);
    });

    it('lets strollers walk the whole route at walking pace', () => {
        const samples = Array.from({ length: 4000 }, (_, index) => resolveKonbiniStroll(index * 0.1, 'stroll')).filter(Boolean);
        expect(samples.length).toBeGreaterThan(0);
        samples.forEach(stroll => expect(stroll!.distance).toBeGreaterThanOrEqual(0));
    });
});

describe('customers follow the automatic door', () => {
    const events = [40, 75, 110];
    const around = (time: number) => listKonbiniDoorEvents(events, time, variation, false);
    const thresholdDistance = pathLength(KONBINI_ENTER_PATH.slice(0, 8));
    const exitThreshold = pathLength(KONBINI_EXIT_PATH.slice(0, 3));

    it('crosses the threshold on the way in while the door is fully open', () => {
        const crossing = events[0]! - KONBINI_ENTER_LEAD + thresholdDistance / KONBINI_WALK_SPEED;
        expect(resolveKonbiniDoorOpenness(events, crossing, variation, false)).toBe(1);
        const [enter] = resolveKonbiniCustomers(around(crossing), crossing);
        expect(enter?.path).toBe('enter');
        expect(samplePath(KONBINI_ENTER_PATH, enter!.distance).z).toBeCloseTo(STORE.z1 + 0.05, 1);
    });

    it('browses inside until the next opening, then walks out through the open door', () => {
        const [browsing] = resolveKonbiniCustomers(around(60), 60);
        expect(browsing).toMatchObject({ path: 'enter', browsing: true });
        const crossing = events[1]! - KONBINI_EXIT_LEAD + exitThreshold / KONBINI_WALK_SPEED;
        expect(resolveKonbiniDoorOpenness(events, crossing, variation, false)).toBe(1);
        const [stillInside, leaving] = resolveKonbiniCustomers(around(crossing), crossing);
        expect(stillInside).toBeNull();
        expect(leaving?.path).toBe('exit');
        expect(leaving!.look).toBe(browsing!.look);
    });

    it('has nobody around before the first opening and nobody leaving before anyone came in', () => {
        expect(resolveKonbiniCustomers(around(5), 5)).toEqual([null, null]);
        const [, leaving] = resolveKonbiniCustomers([{ time: 30, index: 1 }], 31);
        expect(leaving).not.toBeNull();
        expect(resolveKonbiniCustomers([{ time: 30, index: 0 }], 31)[1]).toBeNull();
    });

    it('lists periodic openings for an instrumental with stable indices', () => {
        const listed = listKonbiniDoorEvents([], 100, variation, true);
        listed.forEach(event => expect(event.time).toBeCloseTo((event.index - variation.doorPhase) * variation.doorInterval));
        const later = listKonbiniDoorEvents([], 130, variation, true);
        const shared = listed.find(event => later.some(other => other.index === event.index))!;
        expect(later.find(event => event.index === shared.index)!.time).toBeCloseTo(shared.time);
        expect(KONBINI_DOOR_TIMING.open).toBeLessThan(2);
    });
});

describe('lightning', () => {
    const line = (start: number, chorus: boolean): Line => ({ words: [], startTime: start, endTime: start + 2, fullText: 'x', isChorus: chorus });

    it('strikes at the start of each chorus run', () => {
        const lines = [line(0, false), line(3, true), line(5, true), line(8, false), line(11, true)];
        expect(buildKonbiniLightningTimes(lines)).toEqual([3, 11]);
    });

    it('flashes twice and fades within about a second', () => {
        const times = [10];
        expect(resolveKonbiniLightning(times, 9.9)).toBe(0);
        expect(resolveKonbiniLightning(times, 10.04)).toBeGreaterThan(0.9);
        expect(resolveKonbiniLightning(times, 10.14)).toBeLessThan(resolveKonbiniLightning(times, 10.24));
        expect(resolveKonbiniLightning(times, 11.5)).toBe(0);
    });
});
