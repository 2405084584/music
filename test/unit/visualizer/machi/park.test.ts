import { describe, expect, it } from 'vitest';
import { MACHI_BASE } from '@/components/visualizer/machi/engine/geometry/plinth';
import { STAGE, TREES } from '@/components/visualizer/machi/scenes/park/layout';
import { resolveLanternGlyphs } from '@/components/visualizer/machi/scenes/park/lanterns';
import type { Line } from '@/types';

// test/unit/visualizer/machi/park.test.ts
// 樱花公园：提灯一盏一个字写下一句（去掉空白、太长截断、不够两边留空灯；曲名卡时写曲名）；
// 舞台转向镜头后横幅两头仍在底座里，树都在底座里。

const line = (text: string, start: number, extra: Partial<Line> = {}): Line => ({
    words: [{ text, startTime: start, endTime: start + 2 }],
    startTime: start,
    endTime: start + 2,
    fullText: text,
    ...extra,
});

describe('resolveLanternGlyphs', () => {
    const lines = [line('在城市尽头等', 0), line('把回忆 折成纸船放进河流', 3), line('', 6), line('晚安', 8)];

    it('writes the next line one glyph per lantern, centred and without spaces', () => {
        expect(resolveLanternGlyphs({ kind: 'line', index: 3 }, [line('a', 0), line('a', 1), line('a', 2), line('晚安', 3), line('好梦', 4)], { title: 'x' }, 6))
            .toEqual(['', '', '好', '梦', '', '']);
        const glyphs = resolveLanternGlyphs({ kind: 'line', index: 0 }, lines, { title: 'x' }, 12);
        expect(glyphs.join('')).toBe('把回忆折成纸船放进河流');
        expect(glyphs).toHaveLength(12);
    });

    it('cuts a long line with an ellipsis and skips empty lines', () => {
        const glyphs = resolveLanternGlyphs({ kind: 'line', index: 0 }, lines, { title: 'x' }, 6);
        expect(glyphs).toEqual(['把', '回', '忆', '折', '成', '…']);
        expect(resolveLanternGlyphs({ kind: 'line', index: 1 }, lines, { title: 'x' }, 4)).toEqual(['', '晚', '安', '']);
    });

    it('falls back to the translation, then the title on the card, then 桜まつり', () => {
        const last = [line('最后一句', 0, { translation: 'the end' })];
        expect(resolveLanternGlyphs({ kind: 'line', index: 0 }, last, { title: 'x' }, 6).join('')).toBe('theend');
        expect(resolveLanternGlyphs({ kind: 'card' }, lines, { title: '夜樱' }, 4)).toEqual(['', '夜', '樱', '']);
        expect(resolveLanternGlyphs({ kind: 'card' }, lines, { title: '' }, 4)).toEqual(['桜', 'ま', 'つ', 'り']);
    });
});

describe('park layout', () => {
    it('keeps the turned banner and the trees on the base', () => {
        const half = MACHI_BASE.half;
        [-1, 1].forEach(side => {
            const x = side * STAGE.poleSpan / 2;
            const z = -STAGE.depth / 2 - STAGE.poleBack;
            const c = Math.cos(STAGE.rotationY);
            const s = Math.sin(STAGE.rotationY);
            const worldX = STAGE.x + x * c + z * s;
            const worldZ = STAGE.z - x * s + z * c;
            expect(Math.abs(worldX)).toBeLessThan(half);
            expect(Math.abs(worldZ)).toBeLessThan(half);
        });
        TREES.forEach(tree => {
            expect(Math.abs(tree.x)).toBeLessThan(half);
            expect(Math.abs(tree.z)).toBeLessThan(half);
        });
    });
});
