import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import type { AudioBands, Line, Theme } from '../../../types';
import { resolveLucideIconNames } from '../../../services/lucideIconResolver';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { buildKonbiniBase } from './geometry/base';
import { buildKonbiniInterior, type KonbiniProductBatch } from './geometry/interior';
import { DEG } from './geometry/layout';
import { buildKonbiniProps, buildKonbiniSongProps } from './geometry/props';
import { bakeStatic, withGeometryCache, type KonbiniGeometryCache } from './geometry/shapes';
import { buildKonbiniStore } from './geometry/store';
import { KonbiniCamera } from './konbiniCamera';
import { KonbiniClock } from './konbiniClock';
import {
    buildKonbiniDoorEvents,
    KonbiniAudioFollower,
    resolveKonbiniBoardTarget,
    resolveKonbiniChorus,
    resolveKonbiniDoorOpenness,
    resolveKonbiniFlicker,
    sameBoardTarget,
    type KonbiniBoardTarget,
} from './konbiniDirector';
import { KonbiniLights } from './konbiniLights';
import { KonbiniColorBlend, KonbiniMaterials } from './konbiniMaterials';
import { resolveKonbiniPalette } from './konbiniPalette';
import { resolveKonbiniVariation, type KonbiniVariation } from './konbiniSeed';
import { KonbiniPost } from './konbiniPost';
import { KONBINI_REFLECT_LAYER, KonbiniReflection } from './konbiniReflection';
import { KonbiniSigns } from './konbiniSigns';
import { KonbiniWeather } from './konbiniWeather';
import { KonbiniWetGround } from './konbiniWetGround';

// src/components/visualizer/konbini/createKonbiniRuntime.ts
// 雨町的运行时：一个 WebGL 上下文、一份场景，建一次，换歌、换主题、暂停都就地推给它（外壳用 useVisualizerPixiHost 托管）。
// 自己的 requestAnimationFrame 循环：暂停时只在镜头还在动、颜色还在插值、或外面要求补一帧时出帧，其余时间不跑。
// 每帧的时间只从 currentTime（歌词）和 KonbiniClock（氛围）读，不进 React。

export interface KonbiniSongContext {
    seed: string | number;
    lines: Line[];
    isInstrumental: boolean;
    title: string;
    artist: string;
    album: string;
}

export interface KonbiniRuntimeOptions {
    host: HTMLDivElement;
    song: KonbiniSongContext;
    theme: Theme;
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    paused: boolean;
    staticMode: boolean;
    showText: boolean;
    /** 样式架小图、主题乐园预览：低分辨率、不接拖拽。 */
    previewMode: boolean;
    /** 主题没有图标时招牌上的兜底图标。 */
    fallbackIcons: readonly string[];
    /** WebGL 上下文丢了：外壳重建运行时。 */
    onContextLost: () => void;
    signal: AbortSignal;
}

/** 画质上限：DPR 封顶，自动降级只降不升。 */
const MAX_PIXEL_RATIO = 1.5;
const PREVIEW_PIXEL_RATIO = 1;

const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

/** object 是不是 ancestor 的后代。 */
const isInside = (object: THREE.Object3D, ancestor: THREE.Object3D) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === ancestor) return true;
    return false;
};

/** 换主题时只看真正影响画面的字段：主题对象在改字体时也会换引用。 */
const themeKey = (theme: Theme) => [
    theme.backgroundColor, theme.primaryColor, theme.accentColor, theme.secondaryColor,
    (theme.wordColors ?? []).map(entry => `${entry.word}=${entry.color}`).join(','),
    (theme.lyricsIcons ?? []).join(','),
    theme.fontStyle, theme.fontFamily ?? '', (theme.fontFamilyStack ?? []).join(','), String(theme.fontWeight ?? ''),
    theme.name ?? '', theme.description ?? '', theme.animationIntensity,
].join('|');

/** 主题的动效强度 → 雨量、闪烁这些氛围动效的倍数。 */
const INTENSITY_SCALE: Record<Theme['animationIntensity'], number> = { calm: 0.7, normal: 1, chaotic: 1.3 };

/** 画质档：自动降级只往后走。 */
interface KonbiniQualityStep {
    pixelRatio: number;
    reflectionScale: number;
    shadowMapSize: number;
    bloom: boolean;
}
const QUALITY_STEPS: KonbiniQualityStep[] = [
    { pixelRatio: 1.5, reflectionScale: 0.5, shadowMapSize: 2048, bloom: true },
    { pixelRatio: 1.25, reflectionScale: 0.5, shadowMapSize: 2048, bloom: true },
    { pixelRatio: 1, reflectionScale: 0.4, shadowMapSize: 1536, bloom: true },
    { pixelRatio: 1, reflectionScale: 0.3, shadowMapSize: 1024, bloom: false },
];
/** 平均帧时超过它（约 48fps 以下）就降一档；至少隔这么久才看一次。 */
const DEGRADE_FRAME_MS = 21;
const DEGRADE_WINDOW_MS = 2500;

/** 换主题时重画招牌的防抖（调色时主题一直在变）。 */
const SIGN_REPAINT_DEBOUNCE_MS = 150;
/** 提前多久把下一行画好。 */
const PREHEAT_LEAD_SECONDS = 2.5;

/** 天空：竖向渐变，作为场景背景铺满画面。 */
class KonbiniSky {
    readonly texture: THREE.CanvasTexture;
    private readonly context: CanvasRenderingContext2D;

    constructor() {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 256;
        this.context = canvas.getContext('2d')!;
        this.texture = new THREE.CanvasTexture(canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
    }

    paint(top: THREE.Color, bottom: THREE.Color) {
        const gradient = this.context.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, `#${top.getHexString()}`);
        gradient.addColorStop(1, `#${bottom.getHexString()}`);
        this.context.fillStyle = gradient;
        this.context.fillRect(0, 0, 4, 256);
        this.texture.needsUpdate = true;
    }

    dispose() {
        this.texture.dispose();
    }
}

interface KonbiniDebugHook {
    setView: (azimuthDeg: number, elevationDeg: number, zoom?: number) => void;
    resetView: () => void;
    renderAt: (songSeconds: number, ambientSeconds?: number) => void;
    stats: () => Record<string, number>;
    runtime: KonbiniRuntime;
}

declare global {
    interface Window {
        __konbiniDebug?: KonbiniDebugHook;
    }
}

export class KonbiniRuntime {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new KonbiniCamera();
    private readonly clock = new KonbiniClock();
    private readonly blend: KonbiniColorBlend;
    private readonly materials: KonbiniMaterials;
    private readonly lights: KonbiniLights;
    private readonly sky = new KonbiniSky();
    private readonly productBatches: KonbiniProductBatch[];
    private readonly doorPanels: ReturnType<typeof buildKonbiniStore>['doorPanels'];
    private readonly fans: THREE.Object3D[];
    private readonly signs: KonbiniSigns;
    private readonly weather: KonbiniWeather;
    private readonly wet: KonbiniWetGround;
    private readonly reflection: KonbiniReflection;
    private readonly post: KonbiniPost;
    private quality = 0;
    private qualityCheckedAt = 0;
    private size = { width: 1, height: 1 };
    private readonly root: THREE.Group;
    private songProps: THREE.Group;
    private readonly audio = new KonbiniAudioFollower();
    private variation: KonbiniVariation;
    private doorEvents: number[] = [];
    private doorOpenness = 0;
    private boardTarget: KonbiniBoardTarget | null = null;
    private chorus = 0;
    private signRepaintTimer = 0;
    private readonly resizeObserver: ResizeObserver;
    private readonly geometryCache: KonbiniGeometryCache = new Map();
    private raf = 0;
    private disposed = false;
    private paused: boolean;
    private staticMode: boolean;
    private showText: boolean;
    private song: KonbiniSongContext;
    private theme: Theme;
    private themeSignature: string;
    private pixelRatio: number;
    private wantsFrame = true;
    private readonly frameTimes: number[] = [];
    private lastFrameAt = 0;
    private lastCalls = 0;
    private lastTriangles = 0;

    static async create(options: KonbiniRuntimeOptions) {
        throwIfAborted(options.signal);
        return new KonbiniRuntime(options);
    }

    private constructor(private readonly options: KonbiniRuntimeOptions) {
        this.paused = options.paused;
        this.staticMode = options.staticMode;
        this.showText = options.showText;
        this.song = options.song;
        this.theme = options.theme;
        this.themeSignature = themeKey(options.theme);
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, options.previewMode ? PREVIEW_PIXEL_RATIO : MAX_PIXEL_RATIO);

        // 抗锯齿交给后处理目标的 MSAA，画布本身不开。
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.info.autoReset = false;
        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.addEventListener('webglcontextlost', this.onContextLost);
        options.host.appendChild(canvas);

        const palette = resolveKonbiniPalette(options.theme, options.song.seed);
        this.blend = new KonbiniColorBlend(palette);
        this.materials = new KonbiniMaterials(this.blend);
        const variation = resolveKonbiniVariation(options.song.seed);
        this.variation = variation;
        this.doorEvents = buildKonbiniDoorEvents(options.song.lines, variation);

        const { base, interior, store, props, songProps } = withGeometryCache(this.geometryCache, () => {
            const builtInterior = buildKonbiniInterior(this.materials, variation.shelfSeed);
            return {
                base: buildKonbiniBase(this.materials),
                interior: builtInterior,
                store: buildKonbiniStore(this.materials, builtInterior.group),
                props: buildKonbiniProps(this.materials),
                songProps: buildKonbiniSongProps(this.materials, variation),
            };
        });
        this.productBatches = [...interior.productBatches, ...props.productBatches];
        this.doorPanels = store.doorPanels;
        this.fans = props.fans;
        const root = new THREE.Group();
        root.name = 'Konbini';
        root.add(base.group, store.group, props.group, songProps);
        // 亮的东西进倒影图层（合批前打上，合批按图层分开）。店本身也进：倒影镜头不认灯光，卡通材质在那里是全黑的，
        // 正好当遮挡，屋顶上的广告塔不会穿过店身映到店前的水洼里。
        root.traverse(object => {
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const isGlow = object.material.name.startsWith('konbini:glow');
            const isStoreBody = !object.material.transparent && object.parent !== null && isInside(object, store.group);
            if (isGlow || isStoreBody) object.layers.enable(KONBINI_REFLECT_LAYER);
        });
        this.wet = new KonbiniWetGround(this.materials, this.blend);
        base.roadSurface.material = this.wet.asphalt;
        base.lotSurfaces.forEach(surface => { surface.material = this.wet.concrete; });
        this.wet.uniforms.uPuddleOffset.value.set(variation.puddleOffset[0], variation.puddleOffset[1]);
        this.wet.uniforms.uPuddleAmount.value = variation.puddleAmount;
        bakeStatic(root);
        this.scene.add(root);
        this.root = root;
        this.songProps = songProps;

        this.lights = new KonbiniLights(this.blend, this.materials, props.streetLampHead, options.previewMode ? 1024 : 2048);
        this.scene.add(this.lights.group);
        this.signs = new KonbiniSigns(this.materials, this.blend, {
            boardFaces: store.boardFaces,
            fasciaFaces: store.fasciaFaces,
            pylonFaces: props.pylonFaces,
            aFrameFaces: props.aFrameFaces,
            boardLid: store.boardLid,
        });
        this.scene.add(this.signs.group);
        this.signs.group.traverse(object => {
            if (object instanceof THREE.Mesh && !object.name.startsWith('Poster') && !object.name.startsWith('AFrame') && object.name !== 'Board/roofLogo') object.layers.enable(KONBINI_REFLECT_LAYER);
        });
        this.repaintSigns(palette);

        this.weather = new KonbiniWeather(this.materials, this.blend, variation, options.previewMode ? { rain: 800, splash: 160 } : { rain: 2000, splash: 560 });
        this.scene.add(this.weather.group);
        this.reflection = new KonbiniReflection(0.06, QUALITY_STEPS[0]!.reflectionScale);
        this.wet.uniforms.uReflection.value = this.reflection.target.texture;
        this.post = new KonbiniPost(this.renderer, this.scene, this.camera.camera, { samples: options.previewMode ? 0 : 4, bloom: !options.previewMode });
        this.scene.background = this.sky.texture;
        this.syncColors();
        this.lights.invalidateShadows();

        if (!options.previewMode) this.camera.attach(canvas);
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(options.host);
        this.resize(options.host.clientWidth, options.host.clientHeight);

        this.clock.paused = this.paused || this.staticMode;
        // 第一帧在 create 里画好：着色器编译是起步最慢的一段，换样式的过渡等它（firstFrame.ts）。
        this.renderer.compile(this.scene, this.camera.camera);
        this.renderFrame(performance.now());
        this.wake();
        if (import.meta.env.DEV) this.installDebugHook();
    }

    private readonly onContextLost = (event: Event) => {
        event.preventDefault();
        console.warn('[Konbini] WebGL context lost, rebuilding the runtime');
        this.stopLoop();
        this.options.onContextLost();
    };

    private readonly onResize = (entries: ResizeObserverEntry[]) => {
        const entry = entries[0];
        if (!entry) return;
        this.resize(entry.contentRect.width, entry.contentRect.height);
        this.wake();
    };

    private resize(width: number, height: number) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        this.size = { width: w, height: h };
        this.renderer.setSize(w, h, false);
        this.camera.setAspect(w, h);
        this.post.setSize(w, h, this.pixelRatio);
        this.reflection.setSize(w * this.pixelRatio, h * this.pixelRatio);
        this.wantsFrame = true;
    }

    /** 帧时一直偏高就降一档画质（DPR、倒影分辨率、阴影图、bloom），只降不升。 */
    private adaptQuality(now: number) {
        if (this.options.previewMode || this.clock.paused || document.visibilityState !== 'visible') return;
        if (now - this.qualityCheckedAt < DEGRADE_WINDOW_MS || this.frameTimes.length < 60) return;
        this.qualityCheckedAt = now;
        const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
        if (average <= DEGRADE_FRAME_MS || this.quality >= QUALITY_STEPS.length - 1) return;
        this.quality += 1;
        const step = QUALITY_STEPS[this.quality]!;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, step.pixelRatio);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.reflection.setScale(step.reflectionScale, this.size.width * this.pixelRatio, this.size.height * this.pixelRatio);
        this.lights.setShadowMapSize(step.shadowMapSize);
        this.post.setBloom(step.bloom);
        this.resize(this.size.width, this.size.height);
        this.frameTimes.length = 0;
        console.info(`[Konbini] frame time ${average.toFixed(1)} ms, quality step ${this.quality}`);
    }

    /** 插值后的颜色写回材质、灯、天空、商品实例色。 */
    private syncColors() {
        this.materials.syncColors();
        this.lights.sync();
        this.sky.paint(this.blend.get('skyTop'), this.blend.get('skyBottom'));
        this.wet.syncColors();
        this.weather.syncColors();
        const color = new THREE.Color();
        this.productBatches.forEach(batch => {
            for (let index = 0; index < batch.colorIndex.length; index += 1) {
                color.copy(this.blend.get(`product${batch.colorIndex[index]!}`)).multiplyScalar(batch.shade[index]!);
                batch.mesh.setColorAt(index, color);
            }
            if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
        });
    }

    private wake() {
        if (this.disposed || this.raf) return;
        this.clock.resync();
        this.raf = requestAnimationFrame(this.frame);
    }

    private stopLoop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }

    private readonly frame = (now: number) => {
        this.raf = 0;
        if (this.disposed) return;
        this.renderFrame(now);
        const animating = !this.clock.paused;
        if (animating || this.camera.busy || this.signs.busy || this.wantsFrame) {
            this.raf = requestAnimationFrame(this.frame);
        }
    };

    /** 推进一帧并画出来。 */
    private renderFrame(now: number) {
        this.clock.tick(now);
        this.wantsFrame = false;
        if (this.lastFrameAt > 0) {
            const interval = now - this.lastFrameAt;
            if (interval > 0 && interval < 100) {
                this.frameTimes.push(interval);
                if (this.frameTimes.length > 120) this.frameTimes.shift();
            }
        }
        this.lastFrameAt = now;

        this.camera.update(this.clock.realDelta);
        if (this.blend.step(this.clock.realDelta)) {
            this.syncColors();
            this.wantsFrame = true;
        }
        this.direct();
        this.animateProps();

        this.renderer.info.reset();
        if (this.lights.moon.shadow.needsUpdate) this.renderer.shadowMap.needsUpdate = true;
        const camera = this.camera.camera;
        this.reflection.render(this.renderer, this.scene, camera);
        this.wet.uniforms.uReflectMatrix.value.copy(this.reflection.textureMatrix);
        const pixelWorldSize = (camera.top - camera.bottom) / camera.zoom / Math.max(1, this.size.height * this.pixelRatio);
        this.post.render(pixelWorldSize);
        this.adaptQuality(now);
        this.lastCalls = this.renderer.info.render.calls;
        this.lastTriangles = this.renderer.info.render.triangles;
        this.camera.rendered();
    }

    /** 按歌曲时间决定牌面、门、副歌；按氛围时钟决定闪烁；音频包络平滑。 */
    private direct() {
        const songTime = this.options.currentTime.get();
        const lines = this.song.lines;
        const target: KonbiniBoardTarget = this.showText ? resolveKonbiniBoardTarget(lines, songTime) : { kind: 'card' };
        if (!sameBoardTarget(this.boardTarget, target)) {
            this.boardTarget = target;
            this.signs.showBoard(target, lines, this.staticMode || this.clock.paused, this.showText);
            this.wantsFrame = true;
        } else if (target.kind === 'line' && !this.clock.paused) {
            const next = lines[target.index + 1];
            if (next && next.startTime - songTime < PREHEAT_LEAD_SECONDS) this.signs.preheat({ kind: 'line', index: target.index + 1 }, lines, this.showText);
        }
        const chorusTarget = resolveKonbiniChorus(lines, target);
        this.chorus += (chorusTarget - this.chorus) * (1 - Math.exp(-this.clock.delta * 2.5));
        if (this.staticMode) this.chorus = chorusTarget;
        const audio = this.clock.paused ? this.audio.step(0, 0) : this.audio.step(this.options.audioPower.get(), this.clock.delta);
        const flicker = this.staticMode ? 1 : resolveKonbiniFlicker(this.clock.elapsed, this.song.seed);
        const streetFlicker = this.staticMode ? 1 : resolveKonbiniFlicker(this.clock.elapsed + 3.1, String(this.song.seed) + ':street', 0.45);
        const openness = resolveKonbiniDoorOpenness(this.doorEvents, songTime, this.variation, this.song.isInstrumental || lines.length === 0);
        if (Math.abs(openness - this.doorOpenness) > 1e-4) {
            this.doorOpenness = openness;
            this.lights.invalidateShadows();
        }
        this.lights.setLevels({ interior: 1 + 0.1 * this.chorus + 0.06 * this.doorOpenness, street: 0.75 + 0.25 * streetFlicker });
        this.materials.setGlowLevel('spotHead', 1 + 0.35 * this.chorus);
        this.materials.setGlowLevel('neonRim', (0.75 + 0.25 * flicker) * (1 + 0.4 * this.chorus));
        const intensity = INTENSITY_SCALE[this.theme.animationIntensity] ?? 1;
        const rain = (0.62 + 0.22 * audio + 0.12 * this.chorus) * intensity;
        this.weather.update({ time: this.clock.elapsed, intensity: rain });
        this.wet.uniforms.uTime.value = this.clock.elapsed;
        this.wet.uniforms.uRain.value = Math.min(1, 0.45 + 0.5 * rain);
        this.signs.update({
            songTime,
            ambientTime: this.clock.elapsed,
            delta: this.clock.delta,
            staticMode: this.staticMode,
            showText: this.showText,
            chorus: this.chorus,
            audio,
            flicker,
        });
    }

    /** 风扇转、自动门滑开。 */
    private animateProps() {
        const t = this.clock.elapsed;
        this.fans.forEach((fan, index) => {
            fan.rotation.z = -t * (this.variation.fanSpeed + index * 0.37) * Math.PI * 2;
        });
        this.doorPanels.forEach(panel => {
            panel.object.position.x = panel.closedX + panel.direction * 0.86 * this.doorOpenness;
        });
    }

    /** 换歌：按新 seed 重建自行车和伞（只有这一组跟着歌变几何）。 */
    private rebuildSongProps() {
        const shared = new Set(this.geometryCache.values());
        this.songProps.removeFromParent();
        this.songProps.traverse(object => {
            if (object instanceof THREE.Mesh && !shared.has(object.geometry)) object.geometry.dispose();
        });
        const holder = new THREE.Group();
        const next = withGeometryCache(this.geometryCache, () => buildKonbiniSongProps(this.materials, this.variation));
        holder.add(next);
        bakeStatic(holder);
        next.removeFromParent();
        this.root.add(next);
        this.songProps = next;
        this.lights.invalidateShadows();
    }

    /** 主题 / 歌换了：按目标调色板、字体、图标重画招牌。 */
    private repaintSigns(palette = resolveKonbiniPalette(this.theme, this.song.seed)) {
        window.clearTimeout(this.signRepaintTimer);
        this.signRepaintTimer = 0;
        this.signs.setContent({
            song: this.song,
            theme: this.theme,
            palette,
            font: { stack: resolveThemeFontStack(this.theme), weight: resolveThemeFontWeight(this.theme, 700) },
            icons: resolveLucideIconNames(this.theme.lyricsIcons),
            fallbacks: this.options.fallbackIcons,
        });
        this.boardTarget = null;
        this.wantsFrame = true;
    }

    swapSong(song: KonbiniSongContext) {
        const seedChanged = song.seed !== this.song.seed;
        this.song = song;
        this.variation = resolveKonbiniVariation(song.seed);
        if (seedChanged) this.rebuildSongProps();
        this.doorEvents = buildKonbiniDoorEvents(song.lines, this.variation);
        const palette = resolveKonbiniPalette(this.theme, song.seed);
        this.blend.setTarget(palette, this.staticMode);
        this.repaintSigns(palette);
        this.wake();
    }

    setTheme(theme: Theme) {
        const signature = themeKey(theme);
        this.theme = theme;
        if (signature === this.themeSignature) return;
        this.themeSignature = signature;
        this.blend.setTarget(resolveKonbiniPalette(theme, this.song.seed), this.staticMode);
        if (this.staticMode) this.syncColors();
        window.clearTimeout(this.signRepaintTimer);
        this.signRepaintTimer = window.setTimeout(() => {
            if (this.disposed) return;
            this.repaintSigns();
            this.wake();
        }, SIGN_REPAINT_DEBOUNCE_MS);
        this.wake();
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        this.clock.paused = this.paused || this.staticMode;
        this.wake();
    }

    setStaticMode(staticMode: boolean) {
        this.staticMode = staticMode;
        this.clock.paused = this.paused || this.staticMode;
        this.wake();
    }

    setShowText(showText: boolean) {
        if (this.showText === showText) return;
        this.showText = showText;
        this.boardTarget = null;
        this.wantsFrame = true;
        this.wake();
    }

    /** 暂停时外面要求补一帧（拖进度条、换行）。 */
    renderOnce() {
        this.wantsFrame = true;
        this.wake();
    }

    private installDebugHook() {
        window.__konbiniDebug = {
            // 调试时窗格可能在后台、没有 requestAnimationFrame：直接同步画一帧。
            setView: (azimuthDeg, elevationDeg, zoom = 1) => {
                this.camera.placeAt({ azimuth: azimuthDeg * DEG, elevation: elevationDeg * DEG, zoom });
                this.renderFrame(performance.now());
            },
            resetView: () => {
                this.camera.placeAt({ azimuth: 45 * DEG, elevation: 31 * DEG, zoom: 1 });
                this.renderFrame(performance.now());
            },
            renderAt: (songSeconds: number, ambientSeconds?: number) => {
                this.options.currentTime.set(songSeconds);
                if (ambientSeconds !== undefined) this.clock.elapsed = ambientSeconds;
                this.renderFrame(performance.now());
            },
            stats: () => {
                const average = this.frameTimes.length ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length : 0;
                return {
                    calls: this.lastCalls,
                    triangles: this.lastTriangles,
                    geometries: this.renderer.info.memory.geometries,
                    textures: this.renderer.info.memory.textures,
                    programs: this.renderer.info.programs?.length ?? 0,
                    frameMs: Math.round(average * 100) / 100,
                    pixelRatio: this.pixelRatio,
                    showText: this.showText ? 1 : 0,
                };
            },
            runtime: this,
        };
    }

    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        this.stopLoop();
        window.clearTimeout(this.signRepaintTimer);
        this.resizeObserver.disconnect();
        this.camera.dispose();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('webglcontextlost', this.onContextLost);
        const geometries = new Set<THREE.BufferGeometry>(this.geometryCache.values());
        this.scene.traverse(object => {
            if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry);
        });
        geometries.forEach(geometry => geometry.dispose());
        this.materials.dispose();
        this.lights.dispose();
        this.signs.dispose();
        this.weather.dispose();
        this.reflection.dispose();
        this.post.dispose();
        this.sky.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        canvas.remove();
        if (window.__konbiniDebug?.runtime === this) delete window.__konbiniDebug;
    }
}
