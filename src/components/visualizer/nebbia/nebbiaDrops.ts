import { clamp, NEBBIA_FIXED } from './nebbiaConstants';
import { createVisualizerRng } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaDrops.ts
// 玻璃上的水珠和颠簸。水珠照 raindrop-fx 的做法：每颗是一张法线贴图精灵，实例数据 6 个数
// （中心 x、y，宽、高（CSS 像素），size = 宽/100 决定折射强度，alpha）；精灵只有中间约 1/4 宽能过合成阈值，
// 所以看得见半径 r 的水珠，四边形是 8r。颠簸：公交车压过坑，车身一震，水珠跟着晃，大水珠被震落、留下水痕。

interface FieldDrop {
    x: number; y: number; w: number; h: number; phase: number;
    fall: null | { t0: number; y0: number; len: number; dur: number; trail: Trail };
}
export interface Trail { x: number; y0: number; y1: number; w: number; end: number | null; seed: number }

/** 风把下淌的水珠往后推：每往下 1 像素横向挪多少。 */
export const windDrift = (dy: number, busSpeed: number) => -dy * NEBBIA_FIXED.wind * busSpeed;

export class NebbiaGlassMotion {
    /** 这一帧要画进水珠纹理的实例（擦痕边、下淌、雨点）。 */
    readonly drops: number[] = [];
    readonly trails: Trail[] = [];
    private fieldDrops: FieldDrop[] = [];
    private bumps: { t: number; a: number }[] = [];
    private nextBump = 0;
    private rng = createVisualizerRng(777);
    private now = 0;
    bump = 1;

    /** 雾上的凝结水珠：下半部分略多略大。 */
    buildField(W: number, H: number) {
        const rnd = createVisualizerRng(4242), n = Math.round(W * H / 2200 * NEBBIA_FIXED.fieldDrops);
        this.fieldDrops = [];
        for (let i = 0; i < n; i += 1) {
            const big = rnd() < 0.12;
            const w = big ? 40 + rnd() * 34 : 14 + rnd() ** 1.4 * 22;
            const sp = rnd() * 0.25;
            this.fieldDrops.push({ x: rnd() * W, y: H * (1 - rnd() ** 1.25), w: w * (1 + sp * 0.5), h: w * (1 + sp), phase: rnd() * 6.28, fall: null });
        }
        this.trails.length = 0;
    }

    /** 每帧开头：清空实例，按时间偶尔颠一下（`randomBumps` 为 false 时颠簸跟鼓点，由外面 trigger）。paused 时不颠。 */
    beginFrame(now: number, paused: boolean, randomBumps = true) {
        this.now = now;
        this.drops.length = 0;
        if (paused || !randomBumps || this.bump <= 0 || NEBBIA_FIXED.bumpRate <= 0) return;
        if (now > this.nextBump) {
            if (this.nextBump > 0) this.trigger(now, 0.5 + this.rng() * 0.7);
            this.nextBump = now + (3 + this.rng() * 9) / NEBBIA_FIXED.bumpRate;
        }
    }

    /** 颠一下：越大的水珠越容易被震落。 */
    trigger(now: number, a: number) {
        this.bumps.push({ t: now, a });
        while (this.bumps.length && now - this.bumps[0].t > 3) this.bumps.shift();
        for (const d of this.fieldDrops) {
            if (d.fall || d.w < 26) continue;
            if (this.rng() < NEBBIA_FIXED.bumpFall * a * (d.w - 24) / 45) {
                const trail: Trail = { x: d.x, y0: d.y - d.h * 0.05, y1: d.y, w: d.w, end: null, seed: this.rng() * 100 };
                d.fall = { t0: now + this.rng() * 0.12, y0: d.y, len: (30 + this.rng() * 150) * d.w / 50, dur: 1 + this.rng() * 2.2, trail };
                this.trails.push(trail);
            }
        }
    }

    /** 车身位移（CSS 像素）：先往下一沉，再阻尼回弹，横向带一点。 */
    shake(): [number, number] {
        let x = 0, y = 0;
        for (const b of this.bumps) {
            const dt = this.now - b.t;
            if (dt < 0) continue;
            const k = b.a * this.bump;
            y += k * 7 * Math.exp(-dt * 4.5) * Math.sin(dt * Math.PI * 2 * 3.8);
            x += k * 2 * Math.exp(-dt * 5.5) * Math.sin(dt * Math.PI * 2 * 2.7 + 1.2);
        }
        return [x, y];
    }

    /** 水珠形变：颠簸后来回压扁、拉长几下。 */
    wobble(phase: number) {
        let w = 0;
        for (const b of this.bumps) {
            const dt = this.now - b.t;
            if (dt >= 0) w += b.a * this.bump * 0.16 * Math.exp(-dt * 3.2) * Math.sin(dt * Math.PI * 2 * 7 + phase);
        }
        return w;
    }

    /** 放一颗水珠：r 是看得见的半径，sx / sy 压扁拉长。 */
    put(x: number, y: number, r: number, alpha: number, sx = 1, sy = 1) {
        if (r < 0.5 || alpha <= 0.01) return;
        const wb = this.wobble(x * 0.05 + y * 0.03);
        const w = r * 8 * sx * (1 + wb), h = r * 8 * sy * (1 - wb);
        this.drops.push(x, y, w, h, w / 100, Math.min(1, alpha));
    }

    /** 雾上水珠这一帧的实例：晃动，掉落中的往下走走停停并拉长。 */
    fieldInstances(out: number[], busSpeed: number) {
        out.length = 0;
        for (const d of this.fieldDrops) {
            let x = d.x, y = d.y, stretch = 0;
            if (d.fall) {
                const f = d.fall, tr = f.trail, u = clamp((this.now - f.t0) / f.dur);
                y = f.y0 + f.len * (u - Math.sin(u * 6 * Math.PI) / (6 * Math.PI));
                x = tr.x + Math.sin(y * 0.07 + tr.seed) * 1.4 + Math.sin(y * 0.021 + tr.seed * 2) * 2.2 + windDrift(y - tr.y0, busSpeed);
                stretch = 0.4 * (1 - Math.cos(u * 6 * Math.PI)) * (u < 1 ? 1 : 0);
                tr.y1 = y;
                if (u >= 1) { d.x = x; d.y = y; tr.end = this.now; d.fall = null; }
            }
            const wb = this.wobble(d.phase);
            out.push(x, y, d.w * (1 + wb), d.h * (1 - wb + stretch), d.w / 100, 1);
        }
        return out;
    }
}
