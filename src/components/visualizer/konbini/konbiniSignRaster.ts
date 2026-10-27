import { resolveLucideIconNode } from '../../../services/lucideIconResolver';
import { lucideIconPath2d } from '../lucidePath2d';
import type { WordColorRange } from '../wordColoring';
import type { KonbiniBoardLayout, KonbiniMeasure } from './konbiniBoardLayout';

// src/components/visualizer/konbini/konbiniSignRaster.ts
// 雨町各块招牌的 Canvas 2D 画法：广告塔字面（上半张未唱、下半张已唱，关键词用自己的颜色）、店招（图标 logo + 店名）、
// LED 跑马灯的字条、立柱灯箱、玻璃海报、窗内霓虹图标、门口 A 字立牌。字体栈与字重由调用方按主题给
// （resolveThemeFontStack / resolveThemeFontWeight），测量与绘制用同一个字体。图标先加载好再画（loadLucideIcons）。

export interface KonbiniFont {
    stack: string;
    weight: number;
}

/** 量字用的参考字号。 */
export const KONBINI_REFERENCE_PX = 100;

export const fontSpec = (font: KonbiniFont, px: number) => `${font.weight} ${px.toFixed(1)}px ${font.stack}`;

let measureContext: CanvasRenderingContext2D | null = null;

/** 按参考字号量字宽（缓存在这一个字体上）。 */
export const createKonbiniMeasure = (font: KonbiniFont): KonbiniMeasure => {
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    const cache = new Map<string, number>();
    const spec = fontSpec(font, KONBINI_REFERENCE_PX);
    return (text: string) => {
        if (!text) return 0;
        let width = cache.get(text);
        if (width === undefined) {
            measureContext!.font = spec;
            width = measureContext!.measureText(text).width;
            if (cache.size > 4000) cache.clear();
            cache.set(text, width);
        }
        return width;
    };
};

export const createCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

const context2d = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!;

/** 一个主题图标，画成线稿（stroke），放在 (x, y) 起、边长 size 的方框里。 */
export const drawIcon = (
    context: CanvasRenderingContext2D,
    name: string | undefined,
    fallbacks: readonly string[],
    x: number,
    y: number,
    size: number,
    color: string,
    lineWidth = 2.2,
) => {
    const node = [name, ...fallbacks].map(candidate => (candidate ? resolveLucideIconNode(candidate) : null)).find(Boolean);
    context.save();
    context.translate(x, y);
    context.scale(size / 24, size / 24);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    if (node) context.stroke(lucideIconPath2d(node));
    else {
        context.beginPath();
        context.arc(12, 12, 8, 0, Math.PI * 2);
        context.stroke();
    }
    context.restore();
};

/** 把一段字缩到 maxWidth 以内的字号。 */
const fitFont = (context: CanvasRenderingContext2D, font: KonbiniFont, text: string, maxWidth: number, maxPx: number, minPx = 8) => {
    let px = maxPx;
    context.font = fontSpec(font, px);
    const width = context.measureText(text).width;
    if (width > maxWidth) px = Math.max(minPx, (px * maxWidth) / width);
    context.font = fontSpec(font, px);
    return px;
};

/** 按宽度折行（中日韩逐字，拉丁按词），最多 maxLines 行，超出的末行加省略号。 */
const wrapText = (context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
    const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+\s*|\s+/gu) ?? [];
    const lines: string[] = [];
    let current = '';
    units.forEach(unit => {
        const next = current + unit;
        if (current && context.measureText(next.trimEnd()).width > maxWidth) {
            lines.push(current.trimEnd());
            current = unit.trimStart();
        } else current = next;
    });
    if (current.trim()) lines.push(current.trimEnd());
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1]!;
        while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
        kept[maxLines - 1] = `${last}…`;
        return kept;
    }
    return lines;
};

export interface KonbiniBoardPaint {
    layout: KonbiniBoardLayout;
    font: KonbiniFont;
    unlit: string;
    lit: string;
    /** 关键词着色的字符范围（按 fullText 的 UTF-16 下标）。 */
    keywordRanges: readonly WordColorRange[];
    /** 曲名卡：第一行用 lit 色，第二行用 unlit 色，整面都“亮着”。 */
    card?: boolean;
}

/** 广告屏字面：canvas 上半张是未唱的字，下半张是唱到的字（着色器按点亮位置在两者之间切）。 */
export const paintKonbiniBoard = (canvas: HTMLCanvasElement, paint: KonbiniBoardPaint) => {
    const context = context2d(canvas);
    const half = canvas.height / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const { layout, font } = paint;
    const scaleY = half / layout.height;
    const scaleX = canvas.width / layout.width;
    layout.rows.forEach((row, rowIndex) => {
        const px = row.fontPx;
        context.font = fontSpec(font, px * scaleX);
        row.glyphs.forEach(glyph => {
            const x = glyph.x0 * scaleX;
            const y = row.centerY * scaleY;
            const keyword = paint.keywordRanges.find(range => glyph.offset >= range.startOffset && glyph.offset < range.endOffset);
            // 上半：未唱。
            context.fillStyle = paint.card && rowIndex === 0 ? paint.lit : paint.unlit;
            context.fillText(glyph.text, x, y);
            // 下半：唱到的字。屏幕上的字是干净的像素，不画光晕（光晕会糊字，也会被 bloom 再放大一圈）。
            const color = paint.card ? (rowIndex === 0 ? paint.lit : paint.unlit) : (keyword?.color ?? paint.lit);
            context.fillStyle = color;
            context.fillText(glyph.text, x, y + half);
        });
    });
};

export interface KonbiniFasciaPaint {
    font: KonbiniFont;
    title: string;
    icon?: string;
    fallbacks: readonly string[];
    base: string;
    text: string;
    brand: readonly [string, string, string];
}

/** 前面店招：左边一个圆形 logo（主题图标），中间店名（曲名），右边小字 24H。 */
export const paintKonbiniFascia = (canvas: HTMLCanvasElement, paint: KonbiniFasciaPaint) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = paint.base;
    context.fillRect(0, 0, width, height);
    const badge = height * 0.86;
    const badgeX = height * 0.3;
    const badgeY = (height - badge) / 2;
    context.fillStyle = paint.brand[0];
    context.beginPath();
    context.arc(badgeX + badge / 2, badgeY + badge / 2, badge / 2, 0, Math.PI * 2);
    context.fill();
    drawIcon(context, paint.icon, paint.fallbacks, badgeX + badge * 0.2, badgeY + badge * 0.2, badge * 0.6, '#ffffff', 2.4);
    const tagWidth = height * 1.5;
    const textLeft = badgeX + badge + height * 0.35;
    const textRight = width - tagWidth - height * 0.3;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = paint.text;
    fitFont(context, paint.font, paint.title, textRight - textLeft, height * 0.6);
    context.fillText(paint.title, textLeft, height * 0.53);
    // 右边：品牌色小块里写 24H。
    context.fillStyle = paint.brand[2];
    context.beginPath();
    context.roundRect(width - tagWidth - height * 0.15, height * 0.18, tagWidth, height * 0.64, height * 0.12);
    context.fill();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    fitFont(context, { ...paint.font, weight: 800 }, '24H', tagWidth * 0.8, height * 0.42);
    context.fillText('24H', width - tagWidth / 2 - height * 0.15, height * 0.52);
};

/** LED 跑马灯的字条：黑底白字一长条，着色器按点阵采样、着 LED 色、横向滚动。返回字条的实际宽度（像素）。 */
export const paintKonbiniLedStrip = (canvas: HTMLCanvasElement, font: KonbiniFont, text: string) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = '#ffffff';
    const px = fitFont(context, font, text, width * 0.94, height * 0.78, height * 0.4);
    context.font = fontSpec(font, px);
    // 字条按自己的宽度循环：末尾留一段空白再接开头。
    const used = Math.min(width, context.measureText(text).width + height * 3);
    context.fillText(text, height * 1.5, height * 0.54);
    return used;
};

export interface KonbiniPylonPaint {
    font: KonbiniFont;
    icon?: string;
    fallbacks: readonly string[];
    base: string;
    brand: readonly [string, string, string];
}

/** 立柱灯箱：上半品牌色带大图标，下半白底写 24 HOURS。 */
export const paintKonbiniPylon = (canvas: HTMLCanvasElement, paint: KonbiniPylonPaint) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = paint.base;
    context.fillRect(0, 0, width, height);
    context.fillStyle = paint.brand[0];
    context.fillRect(0, 0, width, height * 0.58);
    context.fillStyle = paint.brand[2];
    context.fillRect(0, height * 0.58, width, height * 0.05);
    const iconSize = height * 0.44;
    drawIcon(context, paint.icon, paint.fallbacks, (width - iconSize) / 2, height * 0.07, iconSize, '#ffffff', 2.6);
    context.fillStyle = paint.brand[2];
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    fitFont(context, { ...paint.font, weight: 800 }, '24', width * 0.5, height * 0.26);
    context.fillText('24', width * 0.32, height * 0.8);
    context.fillStyle = '#2a2f3a';
    fitFont(context, paint.font, 'HOURS', width * 0.36, height * 0.12);
    context.fillText('HOURS', width * 0.66, height * 0.8);
};

export interface KonbiniPosterPaint {
    font: KonbiniFont;
    heading: string;
    body: string;
    icon?: string;
    fallbacks: readonly string[];
    background: string;
    ink: string;
    accent: string;
    tag: string;
}

/** 玻璃上的海报：色底、大图标、标题（歌手 / 专辑）、角上一个小标签。 */
export const paintKonbiniPoster = (canvas: HTMLCanvasElement, paint: KonbiniPosterPaint) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = paint.background;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = paint.ink;
    context.globalAlpha = 0.18;
    context.lineWidth = width * 0.02;
    context.strokeRect(width * 0.05, width * 0.05, width * 0.9, height - width * 0.1);
    context.globalAlpha = 1;
    const iconSize = width * 0.5;
    drawIcon(context, paint.icon, paint.fallbacks, (width - iconSize) / 2, height * 0.12, iconSize, paint.ink, 2.4);
    context.fillStyle = paint.ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const headingPx = fitFont(context, paint.font, paint.heading, width * 0.84, width * 0.15);
    const headingLines = wrapText(context, paint.heading, width * 0.84, 2);
    headingLines.forEach((line, index) => context.fillText(line, width / 2, height * 0.62 + index * headingPx * 1.15));
    context.globalAlpha = 0.75;
    fitFont(context, { ...paint.font, weight: Math.max(400, paint.font.weight - 300) }, paint.body, width * 0.8, width * 0.075);
    context.fillText(paint.body, width / 2, height * 0.86);
    context.globalAlpha = 1;
    // 角上的小标签。
    context.save();
    context.translate(width * 0.78, height * 0.07);
    context.rotate(0.22);
    context.fillStyle = paint.accent;
    context.beginPath();
    context.roundRect(-width * 0.17, -width * 0.06, width * 0.34, width * 0.12, width * 0.03);
    context.fill();
    context.fillStyle = '#ffffff';
    fitFont(context, { ...paint.font, weight: 800 }, paint.tag, width * 0.28, width * 0.08);
    context.fillText(paint.tag, 0, width * 0.005);
    context.restore();
};

export interface KonbiniRoofLogoPaint {
    /** 三角形顶点，按画布像素。 */
    corners: { x: number; y: number }[];
    icon?: string;
    fallbacks: readonly string[];
    brand: readonly [string, string, string];
    /** 图标朝向（画布里的旋转角，弧度）：让它从默认镜头看是正的。 */
    rotation: number;
}

/** 广告塔顶的屋顶 logo：品牌色三角、内圈一道第三色描边、中间一个大的主题图标。 */
export const paintKonbiniRoofLogo = (canvas: HTMLCanvasElement, paint: KonbiniRoofLogoPaint) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const path = new Path2D();
    paint.corners.forEach((corner, index) => (index === 0 ? path.moveTo(corner.x, corner.y) : path.lineTo(corner.x, corner.y)));
    path.closePath();
    context.fillStyle = paint.brand[0];
    context.fill(path);
    const cx = paint.corners.reduce((sum, corner) => sum + corner.x, 0) / paint.corners.length;
    const cy = paint.corners.reduce((sum, corner) => sum + corner.y, 0) / paint.corners.length;
    const inset = (scale: number) => {
        const inner = new Path2D();
        paint.corners.forEach((corner, index) => {
            const x = cx + (corner.x - cx) * scale;
            const y = cy + (corner.y - cy) * scale;
            if (index === 0) inner.moveTo(x, y);
            else inner.lineTo(x, y);
        });
        inner.closePath();
        return inner;
    };
    context.lineJoin = 'round';
    context.strokeStyle = paint.brand[1];
    context.lineWidth = width * 0.022;
    context.stroke(inset(0.86));
    context.strokeStyle = paint.brand[2];
    context.lineWidth = width * 0.014;
    context.stroke(inset(0.78));
    const radius = Math.min(...paint.corners.map(corner => Math.hypot(corner.x - cx, corner.y - cy)));
    const size = radius * 0.62;
    context.save();
    context.translate(cx, cy);
    context.rotate(paint.rotation);
    drawIcon(context, paint.icon, paint.fallbacks, -size / 2, -size / 2, size, '#ffffff', 2.6);
    context.restore();
};

/** 窗内霓虹：透明底上一个发光的图标线稿（加色混合贴在玻璃后面）。 */
export const paintKonbiniNeon = (canvas: HTMLCanvasElement, icon: string | undefined, fallbacks: readonly string[], color: string) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const size = Math.min(width, height) * 0.7;
    const x = (width - size) / 2;
    const y = (height - size) / 2;
    context.shadowColor = color;
    context.shadowBlur = size * 0.12;
    drawIcon(context, icon, fallbacks, x, y, size, color, 1.6);
    context.shadowBlur = size * 0.04;
    drawIcon(context, icon, fallbacks, x, y, size, '#ffffff', 0.6);
    context.shadowBlur = 0;
};

export interface KonbiniAFramePaint {
    font: KonbiniFont;
    heading: string;
    title: string;
    note: string;
    icon?: string;
    fallbacks: readonly string[];
    chalk: string;
    accent: string;
}

/** 门口 A 字立牌：黑板底、粉笔字。 */
export const paintKonbiniAFrame = (canvas: HTMLCanvasElement, paint: KonbiniAFramePaint) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#7a5a3a';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#1f2a25';
    context.fillRect(width * 0.05, width * 0.05, width * 0.9, height - width * 0.1);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = paint.accent;
    fitFont(context, paint.font, paint.heading, width * 0.8, width * 0.09);
    context.fillText(paint.heading, width / 2, height * 0.12);
    context.fillStyle = paint.chalk;
    const titlePx = fitFont(context, paint.font, paint.title, width * 0.82, width * 0.15, width * 0.08);
    const titleLines = wrapText(context, paint.title, width * 0.82, 2);
    titleLines.forEach((line, index) => context.fillText(line, width / 2, height * 0.3 + index * titlePx * 1.2));
    context.globalAlpha = 0.85;
    context.font = fontSpec({ ...paint.font, weight: Math.max(400, paint.font.weight - 300) }, width * 0.065);
    wrapText(context, paint.note, width * 0.8, 4).forEach((line, index) => context.fillText(line, width / 2, height * 0.55 + index * width * 0.085));
    context.globalAlpha = 1;
    drawIcon(context, paint.icon, paint.fallbacks, width * 0.38, height * 0.8, width * 0.24, paint.accent, 1.8);
};
