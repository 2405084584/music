import { DRUM_KICK, DRUM_SNARE, type DrumHits } from '../../../../services/analysis/drumHits';
import type { BeatFxEvent } from '../../../../services/beatFx/clock';

// src/components/visualizer/machi/engine/beatFx.ts
// 町景在智能动感模式里的三个效果（纯函数，不碰 three）：
//   霓虹随拍 machi.neonPulse   <- 拍的包络（beatImpact / downbeatImpact）：招牌霓虹，店里的灯、亮窗、地上的光斑，
//                                还有 bloom 每拍涨一下，小节第一拍更亮；本来就近白的灯箱只涨一点（不然一拍就冲成白块）。
//                                偏低频的拍多涨暖色的灯，偏中高频的拍多涨霓虹（按刚发射那拍的三段占比；没有重音数据时两边一样）。
//   鼓点涟漪 machi.drumRipple  <- htdemucs 分出的底鼓：每下底鼓从歌词屏脚下在湿地面上荡开一圈涟漪（扰动倒影、带一道亮环），
//                                最多同时四圈；地面干的时候改成地上的光斑跟着跳一下。
//   大屏闪拍 machi.screenFlash <- htdemucs 分出的军鼓：歌词屏整块闪亮一下，同时自上而下扫过一道信号横纹。
// 鼓点按听到的时间取，画面只由时间决定，拖进度、暂停都对。效果关着、拍点 / 鼓点没装好时得到常态值，
// 画面和关掉智能动感模式时一样。

/** 一帧里三个效果交给场景、地面、歌词屏的量；常态见 MACHI_BEAT_REST。 */
export interface MachiBeatFrame {
    /** 霓虹的亮度倍数（1 是常态）。 */
    neon: number;
    /** 近白的招牌灯箱（店招、价格立柱）的亮度倍数：霓虹那一路的一小份。 */
    lightbox: number;
    /** 店里的灯、亮窗（连同它们投在地上的光斑）的亮度倍数（1 是常态）。 */
    warm: number;
    /** bloom 强度的倍数（1 是常态）。 */
    bloom: number;
    /** 地面干时地上的光斑多亮的量（0 是常态；城寨的环境光跟着光斑走，也一起跳）。 */
    thump: number;
    /** 歌词屏加亮的量（0 是常态，1 左右是一下闪）。 */
    flash: number;
    /** 信号横纹扫到哪（0 是屏幕顶、1 是底）；没有横纹时 -1。 */
    scan: number;
}

export const MACHI_BEAT_REST: Readonly<MachiBeatFrame> = { neon: 1, lightbox: 1, warm: 1, bloom: 1, thump: 0, flash: 0, scan: -1 };

/** 调好的样子（各效果强度 1 时）。 */
export const MACHI_BEAT = {
    /** 霓虹随拍：每拍、重拍额外涨多少。 */
    neon: { beat: 0.22, downbeat: 0.2 },
    /** 灯箱涨霓虹那一路的几成。 */
    lightbox: 0.3,
    warm: { beat: 0.1, downbeat: 0.1 },
    bloom: { beat: 0.06, downbeat: 0.1 },
    /**
     * 鼓点涟漪：环走多快（米 / 秒）、活多久（秒）、最多几圈；弱于 floor 的底鼓不算，两圈至少隔 gap 秒。
     * 路面湿度在 wet 两个值之间时，环渐渐出来、光斑的一跳渐渐退掉（地面着色器用同一对值）。
     */
    ripple: { speed: 6.5, life: 1.3, max: 4, floor: 0.3, gap: 0.12, thump: 0.55, thumpDecay: 0.14, wet: [0.1, 0.6] },
    /** 大屏闪拍：满亮多久、再按多长的时间常数淡掉、横纹扫完一屏多久（秒）；弱于 floor 的军鼓不算。 */
    flash: { hold: 0.04, decay: 0.16, scan: 0.26, floor: 0.4, life: 0.6 },
} as const;

/** 路面有多湿就有多少涟漪（0..1，与地面着色器里的 smoothstep 一样）；剩下的给光斑的一跳。 */
export const machiRippleWetness = (wetness: number) => {
    const [from, to] = MACHI_BEAT.ripple.wet;
    const t = Math.min(1, Math.max(0, (wetness - from) / (to - from)));
    return t * t * (3 - 2 * t);
};

/** 刚发射的那一拍：普通拍和重拍里时刻靠后的那个。 */
export const latestMachiBeat = (beat: BeatFxEvent | null, downbeat: BeatFxEvent | null) => {
    if (!beat) return downbeat;
    if (!downbeat) return beat;
    return downbeat.t >= beat.t ? downbeat : beat;
};

/**
 * 霓虹随拍：k / d 是拍 / 重拍包络（0..2，时钟已经乘好这个效果的强度）。tone 是刚发射那拍的三段占比（没有就两边一样）：
 * 暖色的灯跟低频，霓虹跟中高频，平均下来两边各是 1 倍。
 */
export const resolveMachiNeonPulse = (
    k: number,
    d: number,
    tone: BeatFxEvent['tone'] | undefined,
    out: MachiBeatFrame,
) => {
    const warmTone = tone ? Math.max(0, 0.4 + 1.8 * tone.low) : 1;
    const neonTone = tone ? Math.max(0, 0.4 + 0.9 * (tone.mid + tone.high)) : 1;
    out.neon = 1 + MACHI_BEAT.neon.beat * k * neonTone + MACHI_BEAT.neon.downbeat * d;
    out.lightbox = 1 + MACHI_BEAT.lightbox * (out.neon - 1);
    out.warm = 1 + MACHI_BEAT.warm.beat * k * warmTone + MACHI_BEAT.warm.downbeat * d;
    out.bloom = 1 + MACHI_BEAT.bloom.beat * k + MACHI_BEAT.bloom.downbeat * d;
    return out;
};

/** times（升序）里最后一个 ≤ time 的下标；没有就 -1。 */
const lastHitAtOrBefore = (times: Float64Array, time: number) => {
    let low = 0;
    let high = times.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (times[middle]! <= time) low = middle + 1;
        else high = middle;
    }
    return low - 1;
};

/** 鼓点在 time 处还有效：分离还没做完的歌，until 之后的鼓点还不知道。 */
export const machiDrumHitsAt = (hits: DrumHits | null, time: number): DrumHits | null => (
    hits && (hits.until === undefined || time < hits.until) ? hits : null
);

/** 涟漪一圈按时间往后挑时留下的那几下（最多 MACHI_BEAT.ripple.max 个，环形覆盖，最旧的先让位）。 */
const keptKicks = new Int32Array(MACHI_BEAT.ripple.max);

/**
 * 鼓点涟漪：time 之前、还活着的几圈（最新的在前）。rings 是 [年龄, 幅度] × MACHI_BEAT.ripple.max 的扁平数组，
 * 空的一圈年龄 -1、幅度 0。按时间往后挑：离上一圈不到 gap 的那下不起新环（留早的那圈，环不会缩回去重来）；
 * 活着的超过 max 圈时留最新的几圈，让掉的是走到最后、几乎淡完的那圈（地面上幅度按剩余寿命的平方淡）。
 * 返回地面干时光斑的那一跳（0..）。
 */
export const resolveMachiDrumRipples = (hits: DrumHits | null, time: number, strength: number, rings: Float32Array) => {
    const { life, max, floor, gap, thump, thumpDecay } = MACHI_BEAT.ripple;
    for (let slot = 0; slot < max; slot += 1) {
        rings[slot * 2] = -1;
        rings[slot * 2 + 1] = 0;
    }
    if (!hits || strength <= 0) return 0;
    const last = lastHitAtOrBefore(hits.times, time);
    // 从寿命再往前 gap 起挑：窗口里第一下是不是离前一圈太近，也按同样的规则定，不随窗口滑动而变。
    let index = lastHitAtOrBefore(hits.times, time - life - gap) + 1;
    let previous = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (; index <= last; index += 1) {
        const at = hits.times[index]!;
        if (hits.kinds[index] !== DRUM_KICK || hits.strengths[index]! < floor || at - previous < gap) continue;
        previous = at;
        if (time - at >= life) continue;
        keptKicks[count % max] = index;
        count += 1;
    }
    let pulse = 0;
    const shown = Math.min(count, max);
    for (let slot = 0; slot < shown; slot += 1) {
        const hit = keptKicks[(count - 1 - slot) % max]!;
        const age = time - hits.times[hit]!;
        const amp = strength * hits.strengths[hit]!;
        rings[slot * 2] = age;
        rings[slot * 2 + 1] = amp;
        pulse = Math.max(pulse, thump * amp * Math.exp(-age / thumpDecay));
    }
    return pulse;
};

/** 大屏闪拍：最近一下够响的军鼓给出的加亮与横纹位置（写进 out.flash / out.scan）。 */
export const resolveMachiScreenFlash = (hits: DrumHits | null, time: number, strength: number, out: MachiBeatFrame) => {
    out.flash = 0;
    out.scan = -1;
    if (!hits || strength <= 0) return out;
    const { hold, decay, scan, floor, life } = MACHI_BEAT.flash;
    for (let index = lastHitAtOrBefore(hits.times, time); index >= 0; index -= 1) {
        const age = time - hits.times[index]!;
        if (age >= life) break;
        if (hits.kinds[index] !== DRUM_SNARE || hits.strengths[index]! < floor) continue;
        out.flash = strength * hits.strengths[index]! * (age < hold ? 1 : Math.exp(-(age - hold) / decay));
        out.scan = age < scan ? age / scan : -1;
        break;
    }
    return out;
};
