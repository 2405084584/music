import { describe, expect, it } from 'vitest';
import { resolveMachiDrift } from '@/components/visualizer/machi/engine/camera';

// test/unit/visualizer/machi/camera.test.ts
// 町景的运镜：相对静止位置的偏移有界（转角、俯仰、缩放、平移都不大），走得慢，但一两分钟里确实转开了。

const samples = (seconds: number, step: number) => Array.from({ length: Math.round(seconds / step) }, (_, index) => resolveMachiDrift(index * step));

describe('resolveMachiDrift', () => {
    it('stays near the resting view', () => {
        samples(900, 0.25).forEach(drift => {
            expect(Math.abs(drift.azimuth)).toBeLessThanOrEqual(20);
            expect(Math.abs(drift.elevation)).toBeLessThanOrEqual(4);
            expect(Math.abs(Math.log(drift.zoom))).toBeLessThanOrEqual(0.08 + 1e-9);
            expect(Math.abs(drift.panX)).toBeLessThanOrEqual(0.45);
            expect(Math.abs(drift.panZ)).toBeLessThanOrEqual(0.3);
        });
    });

    it('moves slowly but does get around', () => {
        const step = 0.05;
        const path = samples(600, step);
        const fastest = Math.max(...path.slice(1).map((drift, index) => Math.abs(drift.azimuth - path[index]!.azimuth) / step));
        expect(fastest).toBeLessThan(2.5);
        const firstMinutes = path.slice(0, Math.round(120 / step)).map(drift => drift.azimuth);
        expect(Math.max(...firstMinutes) - Math.min(...firstMinutes)).toBeGreaterThan(25);
    });
});
