import * as THREE from 'three';
import type { Line, Theme } from '../../../types';
import { buildWordColorRangesFromMatchers, prepareWordColorMatchers, type WordColorMatcher } from '../wordColoring';
import type { KonbiniSongContext } from './createKonbiniRuntime';
import type { KonbiniPlacement } from './geometry/props';
import { BOARD, DEG, STORE } from './geometry/layout';
import {
    layoutKonbiniBoardCard,
    layoutKonbiniBoardLine,
    resolveKonbiniBoardReveal,
    type KonbiniBoardBox,
    type KonbiniBoardLayout,
} from './konbiniBoardLayout';
import type { KonbiniBoardTarget } from './konbiniDirector';
import type { KonbiniColorBlend, KonbiniMaterials } from './konbiniMaterials';
import type { KonbiniPalette } from './konbiniPalette';
import {
    createCanvas,
    createKonbiniMeasure,
    KONBINI_REFERENCE_PX,
    paintKonbiniAFrame,
    paintKonbiniBoard,
    paintKonbiniFascia,
    paintKonbiniLedStrip,
    paintKonbiniNeon,
    paintKonbiniPoster,
    paintKonbiniPylon,
    paintKonbiniRoofLogo,
    type KonbiniFont,
} from './konbiniSignRaster';

// src/components/visualizer/konbini/konbiniSigns.ts
// 雨町的招牌：屋顶三面广告屏（当前行逐字点亮；像一块户外 LED 屏：像素格、子像素、刷新带、面板玻璃反光，
// 换行时信号切换一下）、右面店招上的 LED 跑马灯
// （下一句 / 译文，点阵着色器横向滚动）、前面店招（主题图标 logo + 曲名当店名）、立柱灯箱、玻璃海报（歌手、专辑）、
// 窗内霓虹图标、门口 A 字立牌（主题名）。颜色、图标、字体都从主题来；牌面贴图在换行 / 换歌 / 换主题时重画，每帧只改 uniform。

export interface KonbiniSignPlacements {
    boardFaces: { position: THREE.Vector3; rotationY: number }[];
    fasciaFaces: { position: THREE.Vector3; rotationY: number; width: number; height: number }[];
    pylonFaces: KonbiniPlacement[];
    aFrameFaces: (KonbiniPlacement & { lean?: number })[];
    boardLid: { center: THREE.Vector3; shape: THREE.Vector2[]; topY: number };
}

export interface KonbiniSignContent {
    song: KonbiniSongContext;
    theme: Theme;
    palette: KonbiniPalette;
    font: KonbiniFont;
    /** 主题图标（已加载、已规范化的名字），可能是空的。 */
    icons: string[];
    fallbacks: readonly string[];
}

export interface KonbiniSignFrame {
    songTime: number;
    ambientTime: number;
    delta: number;
    staticMode: boolean;
    showText: boolean;
    chorus: number;
    audio: number;
    flicker: number;
}

/** 广告塔字面贴图的尺寸（每半张）：与字面宽高比一致。 */
const BOARD_TEXTURE_WIDTH = 1280;
const LED_TEXTURE = { width: 4096, height: 96 };
/** 换行时屏幕信号切换的总时长（秒）。 */
const BOARD_SWITCH_SECONDS = 0.3;
/** 广告屏横向的像素格数（竖向按面的宽高比取，格子是方的）。 */
const BOARD_CELLS_X = 150;
/** 屏幕最亮的通道压到这里：深色屏的字只轻轻碰到 bloom 门槛，亮色屏的底不进 bloom。 */
const BOARD_PEAK = { dark: 0.95, light: 0.8 } as const;
const BOARD_POOL_SIZE = 3;

const BOARD_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vViewNormal;
void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BOARD_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uBase;
uniform float uBright;
uniform float uLitGain;
uniform float uUnlitGain;
uniform vec3 uRowBottom;
uniform vec3 uReveal;
uniform float uSoft;
uniform vec2 uCells;
uniform float uTime;
uniform float uGlitch;
uniform float uPeak;
uniform vec3 uSheen;
varying vec2 vUv;
varying vec3 vViewNormal;
float bHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
    // 换行时的信号切换：几条横带错开、色散变大、亮度掉一下。
    vec2 uv = vUv;
    float tear = bHash(floor(vUv.y * 22.0) + floor(uTime * 24.0) * 7.0);
    uv.x += (tear - 0.5) * 0.08 * uGlitch * step(0.62, tear);
    // 像素格：贴图按原分辨率取（字不糊），点亮的边界对齐到格；格子小到约 2.5 个屏幕像素以下就把网格淡掉，免得出摩尔纹。
    vec2 cellUv = vUv * uCells;
    vec2 perPixel = fwidth(cellUv);
    float grid = 1.0 - smoothstep(0.3, 0.55, max(perPixel.x, perPixel.y));
    float y = 1.0 - vUv.y;
    float split = 0.0008 + 0.006 * uGlitch;
    vec4 unlit = texture2D(uMap, vec2(uv.x, 0.5 + uv.y * 0.5));
    vec4 litR = texture2D(uMap, vec2(uv.x + split, uv.y * 0.5));
    vec4 litG = texture2D(uMap, vec2(uv.x, uv.y * 0.5));
    vec4 litB = texture2D(uMap, vec2(uv.x - split, uv.y * 0.5));
    float reveal = y < uRowBottom.x ? uReveal.x : (y < uRowBottom.y ? uReveal.y : uReveal.z);
    float snapped = (floor(vUv.x * uCells.x) + 0.5) / uCells.x;
    float on = 1.0 - smoothstep(reveal - uSoft, reveal + uSoft, mix(vUv.x, snapped, grid));
    // 屏幕的底：边缘一圈略暗（像素老化 / 边框阴影）。
    float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    vec3 base = uBase * (0.92 + 0.08 * smoothstep(1.0, 0.0, y)) * (0.8 + 0.2 * edge);
    vec3 color = mix(base, unlit.rgb * uUnlitGain, unlit.a);
    color = mix(color, vec3(litR.r, litG.g, litB.b) * uLitGain, vec3(litR.a, litG.a, litB.a) * on);
    // 像素之间的黑缝与 RGB 子像素条（按格的可见度淡入淡出），平均亮度不变。
    vec2 f = fract(cellUv) - 0.5;
    float gap = smoothstep(0.5, 0.38, abs(f.x)) * smoothstep(0.5, 0.36, abs(f.y));
    vec3 stripe = clamp(1.6 - abs(vec3(fract(cellUv.x) * 3.0) - vec3(0.5, 1.5, 2.5)) * 1.1, 0.0, 1.0) * 2.0;
    vec3 mask = gap * mix(vec3(1.0), stripe, 0.35) / 0.78;
    color *= mix(vec3(1.0), mask, grid * 0.8);
    // 慢慢往下走的刷新带，切换时的雪花点。
    float roll = fract(vUv.y + uTime * 0.07);
    color *= (1.0 + 0.045 * exp(-pow((roll - 0.5) * 9.0, 2.0))) * (1.0 - 0.3 * uGlitch);
    color += (bHash(dot(floor(cellUv), vec2(1.0, 157.0)) + floor(uTime * 30.0)) - 0.5) * 0.12 * uGlitch;
    color = max(color * uBright, 0.0);
    // 最亮的通道压到 uPeak（保色相）：字清楚，不被 bloom 晕开。
    float peak = max(max(color.r, color.g), color.b);
    color *= min(1.0, uPeak / max(peak, 1e-4));
    // 面板玻璃：一点天光反射，侧着看更明显，再加一道斜的柔光。
    float fresnel = pow(1.0 - clamp(vViewNormal.z, 0.0, 1.0), 3.0);
    float glare = smoothstep(0.22, 0.0, abs(vUv.x * 0.7 + vUv.y * 0.9 - 1.05));
    color += uSheen * (0.035 + 0.22 * fresnel + 0.05 * glare);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const LED_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLed;
uniform float uScroll;
uniform float uUsed;
uniform float uWindow;
uniform float uDots;
uniform float uAspect;
uniform float uBright;
varying vec2 vUv;
void main() {
    vec2 grid = vec2(floor(uDots * uAspect), uDots);
    vec2 cell = floor(vUv * grid);
    vec2 f = fract(vUv * grid) - 0.5;
    vec2 sampleUv = (cell + 0.5) / grid;
    float u = fract(uScroll + sampleUv.x * uWindow) * uUsed;
    float a = texture2D(uMap, vec2(u, sampleUv.y)).r;
    float dotMask = 1.0 - smoothstep(0.28, 0.42, length(f));
    vec3 off = vec3(0.025, 0.022, 0.03);
    vec3 color = mix(off, mix(uLed * 0.08, uLed * 2.2, a) * uBright, dotMask);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

interface BoardSlot {
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    key: string;
    layout: KonbiniBoardLayout | null;
    usedAt: number;
}

const canvasTexture = (canvas: HTMLCanvasElement, anisotropy = 4) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
};

const placedPlane = (material: THREE.Material, width: number, height: number, position: THREE.Vector3, rotationY: number, name: string) => {
    const result = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    result.name = name;
    result.position.copy(position);
    result.rotation.y = rotationY;
    return result;
};

/** 一行要显示的 LED 字：下一句；没有下一句时用这一句的译文；曲名卡时是曲名与歌手。 */
const ledTextFor = (target: KonbiniBoardTarget, lines: readonly Line[], song: KonbiniSongContext) => {
    const title = song.title || 'KONBINI';
    if (target.kind === 'card') return `♪ ${title}${song.artist ? ` — ${song.artist}` : ''}   ◆   OPEN 24H   ◆`;
    const next = lines.slice(target.index + 1).find(line => line.fullText.trim());
    const current = lines[target.index];
    const parts = [
        next ? `NEXT ▸ ${next.fullText}` : '',
        current?.translation ? `◆ ${current.translation}` : '',
    ].filter(Boolean);
    return parts.length ? `${parts.join('   ')}   ` : `♪ ${title}   ◆   `;
};

export class KonbiniSigns {
    readonly group = new THREE.Group();
    private readonly boardMaterial: THREE.ShaderMaterial;
    private readonly boardPool: BoardSlot[];
    private boardSlot: BoardSlot | null = null;
    private pendingSlot: BoardSlot | null = null;
    private switchElapsed = BOARD_SWITCH_SECONDS;
    private boardTarget: KonbiniBoardTarget | null = null;
    private readonly boardBox: KonbiniBoardBox;
    private readonly ledCanvas = createCanvas(LED_TEXTURE.width, LED_TEXTURE.height);
    private readonly ledTexture: THREE.CanvasTexture;
    private readonly ledMaterial: THREE.ShaderMaterial;
    private ledText = '';
    private ledScroll = 0;
    private readonly statics: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial | THREE.MeshToonMaterial; level: number }[] = [];
    private readonly fascia;
    private readonly pylon;
    private readonly posters;
    private readonly neon;
    private readonly aFrame;
    private readonly roofLogo;
    private readonly roofCorners: { x: number; y: number }[];
    private content: KonbiniSignContent | null = null;
    private matchers: WordColorMatcher[] = [];
    private measure: ReturnType<typeof createKonbiniMeasure> | null = null;
    private lines: readonly Line[] = [];
    private chorusGlow = 0;

    constructor(materials: KonbiniMaterials, private readonly blend: KonbiniColorBlend, placements: KonbiniSignPlacements) {
        this.group.name = 'Signs';
        const faceWidth = BOARD.faceWidth - 0.14;
        const faceHeight = BOARD.faceHeight - 0.12;
        const half = Math.round(BOARD_TEXTURE_WIDTH * (faceHeight / faceWidth));
        this.boardBox = { width: BOARD_TEXTURE_WIDTH, height: half, paddingX: 0.05, referencePx: KONBINI_REFERENCE_PX };
        this.boardPool = Array.from({ length: BOARD_POOL_SIZE }, () => {
            const canvas = createCanvas(BOARD_TEXTURE_WIDTH, half * 2);
            return { canvas, texture: canvasTexture(canvas, 8), key: '', layout: null, usedAt: 0 };
        });
        this.boardMaterial = materials.track(new THREE.ShaderMaterial({
            vertexShader: BOARD_VERTEX,
            fragmentShader: BOARD_FRAGMENT,
            uniforms: {
                uMap: { value: this.boardPool[0]!.texture },
                uBase: { value: new THREE.Color() },
                uBright: { value: 1 },
                uLitGain: { value: 1.8 },
                uUnlitGain: { value: 0.85 },
                uRowBottom: { value: new THREE.Vector3(1, 1, 1) },
                uReveal: { value: new THREE.Vector3(0, 0, 0) },
                uSoft: { value: 0.004 },
                uCells: { value: new THREE.Vector2(BOARD_CELLS_X, Math.round(BOARD_CELLS_X * faceHeight / faceWidth)) },
                uTime: { value: 0 },
                uGlitch: { value: 0 },
                uPeak: { value: BOARD_PEAK.dark },
                uSheen: { value: new THREE.Color() },
            },
        }));
        this.boardMaterial.name = 'konbini:board';
        placements.boardFaces.forEach((face, index) => {
            this.group.add(placedPlane(this.boardMaterial, faceWidth, faceHeight, face.position, face.rotationY, `Board/face${index}`));
        });

        // 前面店招、右面 LED。
        const fasciaFront = placements.fasciaFaces[0]!;
        this.fascia = this.staticSign(materials, 1600, Math.round(1600 * fasciaFront.height / fasciaFront.width), 0.78, 'basic');
        this.group.add(placedPlane(this.fascia.material, fasciaFront.width, fasciaFront.height, fasciaFront.position, fasciaFront.rotationY, 'Fascia/front'));
        const fasciaRight = placements.fasciaFaces[1]!;
        this.ledTexture = canvasTexture(this.ledCanvas, 1);
        this.ledTexture.colorSpace = THREE.NoColorSpace;
        this.ledTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.ledMaterial = materials.track(new THREE.ShaderMaterial({
            vertexShader: BOARD_VERTEX,
            fragmentShader: LED_FRAGMENT,
            uniforms: {
                uMap: { value: this.ledTexture },
                uLed: { value: new THREE.Color() },
                uScroll: { value: 0 },
                uUsed: { value: 1 },
                uWindow: { value: 0.3 },
                uDots: { value: 18 },
                uAspect: { value: fasciaRight.width / fasciaRight.height },
                uBright: { value: 1 },
            },
        }));
        this.ledMaterial.name = 'konbini:led';
        this.group.add(placedPlane(this.ledMaterial, fasciaRight.width, fasciaRight.height, fasciaRight.position, fasciaRight.rotationY, 'Fascia/led'));

        // 立柱灯箱两面。
        const pylonFace = placements.pylonFaces[0]!;
        this.pylon = this.staticSign(materials, 384, Math.round(384 * pylonFace.height / pylonFace.width), 0.95, 'basic');
        placements.pylonFaces.forEach((face, index) => {
            this.group.add(placedPlane(this.pylon.material, face.width, face.height, face.position, face.rotationY, `Pylon/face${index}`));
        });

        // 玻璃海报：前面左段玻璃后面两张。
        this.posters = [0, 1].map(index => {
            const sign = this.staticSign(materials, 256, 364, 0.95, 'basic');
            const position = new THREE.Vector3(-4.05 + index * 0.72, 1.62, STORE.z1 - 0.075);
            this.group.add(placedPlane(sign.material, 0.56, 0.8, position, 0, `Poster${index}`));
            return sign;
        });

        // 窗内霓虹：右面玻璃后面，朝外。
        this.neon = this.staticSign(materials, 256, 256, 1.6, 'additive');
        this.group.add(placedPlane(this.neon.material, 0.86, 0.86, new THREE.Vector3(STORE.x1 - 0.1, 1.55, -1.95), Math.PI / 2, 'Neon'));

        // 广告塔顶的屋顶 logo：形状坐标就是 UV（米），贴图按外接正方形映射过去。
        const lid = placements.boardLid;
        const reach = Math.max(...lid.shape.map(point => point.length())) * 1.02;
        this.roofLogo = this.staticSign(materials, 512, 512, 1, 'toon');
        this.roofLogo.texture.repeat.set(1 / (2 * reach), 1 / (2 * reach));
        this.roofLogo.texture.offset.set(0.5, 0.5);
        (this.roofLogo.material as THREE.MeshToonMaterial).emissive.setScalar(0.32);
        (this.roofLogo.material as THREE.MeshToonMaterial).emissiveMap = this.roofLogo.texture;
        this.roofCorners = lid.shape.map(point => ({ x: (point.x / (2 * reach) + 0.5) * 512, y: (0.5 - point.y / (2 * reach)) * 512 }));
        const logoGeometry = new THREE.ShapeGeometry(new THREE.Shape(lid.shape));
        logoGeometry.rotateX(-Math.PI / 2);
        const logo = new THREE.Mesh(logoGeometry, this.roofLogo.material);
        logo.name = 'Board/roofLogo';
        logo.position.set(lid.center.x, lid.topY + 0.004, lid.center.z);
        logo.receiveShadow = true;
        this.group.add(logo);

        // 门口 A 字立牌。
        const aFace = placements.aFrameFaces[0]!;
        this.aFrame = this.staticSign(materials, 256, Math.round(256 * aFace.height / aFace.width), 1, 'toon');
        const aMesh = placedPlane(this.aFrame.material, aFace.width, aFace.height, aFace.position, aFace.rotationY, 'AFrame/face');
        aMesh.rotateX(-(aFace.lean ?? 12 * DEG));
        this.group.add(aMesh);
    }

    /** 一块静态招牌：一张 canvas 贴图 + 材质（自发光、加色或受光）。 */
    private staticSign(materials: KonbiniMaterials, width: number, height: number, level: number, kind: 'basic' | 'additive' | 'toon') {
        const canvas = createCanvas(width, height);
        const texture = canvasTexture(canvas);
        const material = kind === 'toon'
            ? materials.track(new THREE.MeshToonMaterial({ map: texture, gradientMap: materials.gradient }))
            : materials.track(new THREE.MeshBasicMaterial({
                map: texture,
                transparent: kind === 'additive',
                blending: kind === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: kind !== 'additive',
            }));
        if (material instanceof THREE.MeshBasicMaterial) material.color.setScalar(level);
        const sign = { canvas, texture, material, level };
        this.statics.push(sign);
        return sign;
    }

    /** 换歌 / 换主题：重画所有静态招牌，牌面按新颜色重画。 */
    setContent(content: KonbiniSignContent) {
        this.content = content;
        this.matchers = prepareWordColorMatchers(content.theme.wordColors);
        this.measure = createKonbiniMeasure(content.font);
        const { palette, font, song, fallbacks } = content;
        const icon = (index: number) => content.icons.length ? content.icons[index % content.icons.length] : fallbacks[index % fallbacks.length];
        const title = song.title || song.album || 'KONBINI';
        paintKonbiniFascia(this.fascia.canvas, { font, title, icon: icon(0), fallbacks, base: palette.signBase, text: palette.signText, brand: palette.brand });
        paintKonbiniPylon(this.pylon.canvas, { font, icon: icon(0), fallbacks, base: palette.signBase, brand: palette.brand });
        paintKonbiniPoster(this.posters[0]!.canvas, {
            font,
            heading: song.artist || title,
            body: song.album || 'NOW ON SALE',
            icon: icon(1),
            fallbacks,
            background: palette.brand[1],
            ink: palette.brand[0],
            accent: palette.brand[2],
            tag: 'NEW',
        });
        paintKonbiniPoster(this.posters[1]!.canvas, {
            font,
            heading: content.theme.name && content.theme.provider === 'AI' ? content.theme.name : (song.album || title),
            body: 'LIMITED',
            icon: icon(2),
            fallbacks,
            background: palette.brand[2],
            ink: '#ffffff',
            accent: palette.brand[0],
            tag: '限定',
        });
        paintKonbiniNeon(this.neon.canvas, icon(0), fallbacks, palette.neon);
        // 屋顶 logo 的图标朝向：默认镜头从前右（方位角 45°）看过来，图标的“上”朝远离镜头的方向。
        paintKonbiniRoofLogo(this.roofLogo.canvas, { corners: this.roofCorners, icon: icon(0), fallbacks, brand: palette.brand, rotation: -Math.PI / 4 });
        const hasThemeName = !!content.theme.name && content.theme.provider === 'AI';
        paintKonbiniAFrame(this.aFrame.canvas, {
            font,
            heading: '本日のテーマ',
            title: hasThemeName ? content.theme.name! : title,
            note: (hasThemeName ? content.theme.description : song.artist) || '',
            icon: icon(1),
            fallbacks,
            chalk: '#eef1ea',
            accent: palette.brand[0],
        });
        this.statics.forEach(sign => { sign.texture.needsUpdate = true; });
        // 牌面和 LED 都按新内容重画。
        this.boardPool.forEach(slot => { slot.key = ''; });
        const target = this.boardTarget;
        this.boardTarget = null;
        if (target) this.showBoard(target, this.lines, true);
        this.ledText = '';
    }

    private slotKey(target: KonbiniBoardTarget, showText: boolean) {
        return target.kind === 'line' && showText ? `line:${target.index}` : 'card';
    }

    /** 把 target 画进一个空闲槽（或命中已画好的槽）。 */
    private prepare(target: KonbiniBoardTarget, lines: readonly Line[], showText: boolean): BoardSlot | null {
        if (!this.content || !this.measure) return null;
        const key = this.slotKey(target, showText);
        const hit = this.boardPool.find(slot => slot.key === key);
        if (hit) {
            hit.usedAt = performance.now();
            return hit;
        }
        const slot = this.boardPool
            .filter(candidate => candidate !== this.boardSlot && candidate !== this.pendingSlot)
            .sort((a, b) => a.usedAt - b.usedAt)[0];
        if (!slot) return null;
        const { palette, font, song } = this.content;
        const line = target.kind === 'line' ? lines[target.index] : undefined;
        let layout: KonbiniBoardLayout;
        let keywordRanges: ReturnType<typeof buildWordColorRangesFromMatchers> = [];
        const card = !line || !showText;
        if (card) {
            layout = layoutKonbiniBoardCard(`♪ ${song.title || 'KONBINI'}`, song.artist || song.album || '', this.boardBox, this.measure);
        } else {
            layout = layoutKonbiniBoardLine(line, this.boardBox, this.measure);
            keywordRanges = buildWordColorRangesFromMatchers(line.fullText, this.matchers);
        }
        paintKonbiniBoard(slot.canvas, { layout, font, unlit: palette.boardUnlit, lit: palette.boardLit, keywordRanges, card });
        slot.texture.needsUpdate = true;
        slot.key = key;
        slot.layout = layout;
        slot.usedAt = performance.now();
        return slot;
    }

    /** 换牌面：画好新的，熄灯、换贴图、再亮（静态模式直接换）。 */
    showBoard(target: KonbiniBoardTarget, lines: readonly Line[], immediate: boolean, showText = true) {
        this.lines = lines;
        const sameKey = this.boardTarget && this.slotKey(this.boardTarget, showText) === this.slotKey(target, showText);
        this.boardTarget = target;
        const slot = this.prepare(target, lines, showText);
        if (!slot) return;
        if (sameKey && this.boardSlot === slot) return;
        if (immediate || !this.boardSlot) {
            this.applySlot(slot);
            this.switchElapsed = BOARD_SWITCH_SECONDS;
            this.pendingSlot = null;
        } else {
            this.pendingSlot = slot;
            this.switchElapsed = 0;
        }
        this.ledText = '';
    }

    /** 空闲时提前画好下一行。 */
    preheat(target: KonbiniBoardTarget, lines: readonly Line[], showText: boolean) {
        const key = this.slotKey(target, showText);
        if (this.boardPool.some(slot => slot.key === key)) return;
        this.prepare(target, lines, showText);
    }

    private applySlot(slot: BoardSlot) {
        this.boardSlot = slot;
        this.boardMaterial.uniforms.uMap!.value = slot.texture;
        const layout = slot.layout;
        const bottoms = [1, 1, 1];
        if (layout) {
            layout.rows.forEach((row, index) => {
                if (index < 3) bottoms[index] = index === layout.rows.length - 1 ? 1 : (row.bottom / layout.height);
            });
        }
        (this.boardMaterial.uniforms.uRowBottom!.value as THREE.Vector3).set(bottoms[0]!, bottoms[1]!, bottoms[2]!);
    }

    /** 每帧：点亮位置、换行的熄灯动画、LED 滚动、招牌亮度（闪烁、副歌、音频）。 */
    update(frame: KonbiniSignFrame) {
        const content = this.content;
        if (!content) return;
        const palette = content.palette;
        // 换行：信号切换——错位、色散、雪花在中间最强，贴图在峰值处换掉。
        let glitch = 0;
        if (this.switchElapsed < BOARD_SWITCH_SECONDS) {
            this.switchElapsed += frame.staticMode ? BOARD_SWITCH_SECONDS : Math.max(frame.delta, 1 / 120);
            const t = Math.min(1, this.switchElapsed / BOARD_SWITCH_SECONDS);
            if (t >= 0.45 && this.pendingSlot) {
                this.applySlot(this.pendingSlot);
                this.pendingSlot = null;
            }
            glitch = t >= 1 ? 0 : Math.sin(Math.PI * t) ** 0.7;
        }
        this.chorusGlow += (frame.chorus - this.chorusGlow) * (1 - Math.exp(-frame.delta * 3));
        const layout = this.boardSlot?.layout;
        const reveal = layout ? resolveKonbiniBoardReveal(layout, frame.songTime) : [];
        const revealU = (this.boardMaterial.uniforms.uReveal!.value as THREE.Vector3);
        revealU.set((reveal[0] ?? 0) / this.boardBox.width, (reveal[1] ?? 0) / this.boardBox.width, (reveal[2] ?? 0) / this.boardBox.width);
        const uniforms = this.boardMaterial.uniforms;
        (uniforms.uBase!.value as THREE.Color).copy(this.blend.get('boardBase')).multiplyScalar(palette.boardIsLight ? 0.98 : 1.0);
        uniforms.uLitGain!.value = palette.boardIsLight ? 1.0 : 1.25 + 0.2 * this.chorusGlow;
        uniforms.uUnlitGain!.value = palette.boardIsLight ? 1.0 : 0.9;
        uniforms.uBright!.value = 1 + 0.05 * frame.audio + 0.06 * this.chorusGlow;
        uniforms.uPeak!.value = palette.boardIsLight ? BOARD_PEAK.light : BOARD_PEAK.dark;
        uniforms.uGlitch!.value = glitch;
        uniforms.uTime!.value = frame.ambientTime;
        (uniforms.uSheen!.value as THREE.Color).copy(this.blend.get('moon')).multiplyScalar(0.35);

        // LED：内容随牌面换，滚动速度副歌时快一点。
        if (!this.ledText && this.boardTarget) {
            this.ledText = ledTextFor(this.boardTarget, this.lines, content.song);
            const used = paintKonbiniLedStrip(this.ledCanvas, content.font, this.ledText);
            this.ledTexture.needsUpdate = true;
            const led = this.ledMaterial.uniforms;
            led.uUsed!.value = used / LED_TEXTURE.width;
            const dots = led.uDots!.value as number;
            const aspect = led.uAspect!.value as number;
            // 一个点对应字条的 height / dots 像素：可见窗口宽度占循环长度的比例。
            led.uWindow!.value = Math.min(4, (Math.floor(dots * aspect) * (LED_TEXTURE.height / dots)) / Math.max(1, used));
        }
        const ledSpeed = (frame.staticMode ? 0 : 70) * (1 + 0.5 * this.chorusGlow);
        const used = (this.ledMaterial.uniforms.uUsed!.value as number) * LED_TEXTURE.width;
        this.ledScroll = (this.ledScroll + (frame.delta * ledSpeed) / Math.max(1, used)) % 1;
        this.ledMaterial.uniforms.uScroll!.value = this.ledScroll;
        (this.ledMaterial.uniforms.uLed!.value as THREE.Color).copy(this.blend.get('led'));
        this.ledMaterial.uniforms.uBright!.value = 0.9 + 0.2 * frame.audio;

        // 静态招牌：闪烁只落在店招与立柱灯箱上，副歌时不闪、更亮；霓虹随副歌脉动。
        const flicker = this.chorusGlow > 0.5 ? 1 : frame.flicker;
        const lift = 1 + 0.08 * this.chorusGlow + 0.05 * frame.audio;
        this.setLevel(this.fascia, this.fascia.level * lift);
        this.setLevel(this.pylon, this.pylon.level * flicker * lift);
        const neonPulse = frame.staticMode ? 1 : 0.85 + 0.15 * Math.sin(frame.ambientTime * 2.2) + 0.4 * this.chorusGlow;
        this.setLevel(this.neon, this.neon.level * neonPulse);
    }

    private setLevel(sign: { material: THREE.Material }, level: number) {
        if (sign.material instanceof THREE.MeshBasicMaterial) sign.material.color.setScalar(level);
    }

    /** 屏幕上有招牌在动画：暂停时也要继续出帧。 */
    get busy() {
        return this.switchElapsed < BOARD_SWITCH_SECONDS;
    }

    dispose() {
        this.boardPool.forEach(slot => slot.texture.dispose());
        this.ledTexture.dispose();
        this.statics.forEach(sign => sign.texture.dispose());
        this.group.traverse(object => {
            if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
    }
}
