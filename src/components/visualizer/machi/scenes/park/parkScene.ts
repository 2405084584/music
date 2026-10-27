import * as THREE from 'three';
import { adjustLightnessForContrast } from '../../../../../utils/themeColorMath';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import type { MachiSongContext } from '../../createMachiRuntime';
import { MACHI_REFLECT_LAYER } from '../../engine/fx/reflection';
import { MACHI_BASE } from '../../engine/geometry/plinth';
import { bakeStatic, withGeometryCache } from '../../engine/geometry/shapes';
import { MachiLyricScreen } from '../../engine/lyricScreen';
import type { MachiGlowSpec } from '../../engine/materials';
import { vivid, type MachiArtResolver } from '../../engine/palette';
import { createMachiMeasure } from '../../engine/signRaster';
import { prepareWordColorMatchers } from '../../../wordColoring';
import type { MachiScene, MachiSceneContent, MachiSceneContext, MachiSceneDefinition, MachiSceneFrame } from '../types';
import { ParkKoi, ParkPetals } from './ambience';
import { buildParkGrounds } from './grounds';
import { ParkLanterns, resolveLanternGlyphs } from './lanterns';
import { LANTERN_LINE, LEVEL, PARK_VIEW, STAGE, TREES } from './layout';
import { ParkLights } from './parkLights';
import { buildPlayground, type PlaygroundParts } from './playground';
import { buildSakuraTrees } from './trees';

// src/components/visualizer/machi/scenes/park/parkScene.ts
// 樱花公园：后排正中樱花祭的小舞台，两根高杆之间挂着「桜まつり」横幅（当前行：未唱的字只描边，唱到的“印”上颜色），
// 前面一串提灯写着下一句（一盏一个字，换行时一盏盏翻过去）；左边池塘、红色拱桥、锦鲤，右边秋千、滑梯、攀登架、
// 跷跷板、沙坑、摇摇马；八棵樱花树围一圈，花瓣一直往下飘。夜里园灯、提灯亮起来（夜樱），舞台两盏灯照着横幅。

const PARK_ART = {
    grass: '#86b562',
    grassDark: '#6b9a4c',
    soil: '#6b5440',
    // 石子路（湿地面材质按 concrete 上色）与路边石。
    concrete: '#cbbf9f',
    curb: '#b3a78b',
    water: '#2d5f69',
    wood: '#9a6b45',
    woodDark: '#5e3f2a',
    bark: '#5b4335',
    blossom: '#f4b6c6',
    blossomLight: '#f9d4de',
    blossomDeep: '#e78fa9',
    bridgeRed: '#c63a2c',
    stageRed: '#c83b30',
    stageWhite: '#f3eee4',
    rock: '#8f8b84',
    rockDark: '#6c6964',
    sand: '#e3d3a7',
    fence: '#c8b48e',
    clockFace: '#f4f1e8',
    lanternRed: '#d8432f',
    lanternWhite: '#f3e9d2',
    lanternGlow: '#ffb27a',
    petal: '#f9cfdb',
} as const;

const resolveParkArt: MachiArtResolver = () => ({ ...PARK_ART });

const PARK_GLOWS: Record<string, MachiGlowSpec> = {
    lampGlobe: { key: 'interiorLight', level: 2.0 },
    floodHead: { key: 'streetLight', level: 3.0 },
    clockFace: { key: 'clockFace', level: 0.6 },
    vendingGlow: { key: 'vendingLight', level: 1.6 },
};

/** 横幅的布与字：白布、上下两道主题色带、字是压暗到够对比的主题色。 */
const BANNER_CLOTH = '#f6f1e6';

const KOI_COLORS = ['#f08a3c', '#f4f1ea', '#e25b3a', '#f4f1ea', '#f2b13c', '#e9e6df'];

/** 默认构图要框进去的点：底座顶面四角与两侧厚度、横幅顶两角、后排树顶、提灯杆顶。 */
const parkFramingPoints = () => {
    const h = MACHI_BASE.half;
    const points: THREE.Vector3[] = [];
    [-h, h].forEach(x => [-h, h].forEach(z => {
        points.push(new THREE.Vector3(x, 0, z));
        if (z < 0 || x < 0) points.push(new THREE.Vector3(x, -MACHI_BASE.depth, z));
    }));
    [-1, 1].forEach(side => {
        const local = new THREE.Vector3(side * STAGE.poleSpan / 2, STAGE.poleHeight + 0.2, -STAGE.depth / 2 - STAGE.poleBack).applyAxisAngle(new THREE.Vector3(0, 1, 0), STAGE.rotationY);
        points.push(local.add(new THREE.Vector3(STAGE.x, 0, STAGE.z)));
    });
    TREES.slice(0, 4).forEach(tree => points.push(new THREE.Vector3(tree.x, 4.6 * tree.scale, tree.z)));
    return points;
};

class ParkScene implements MachiScene {
    readonly root = new THREE.Group();
    readonly framing;
    readonly weather;
    readonly reflectionPlaneY = LEVEL.water;
    readonly surfaces;
    readonly puddles;
    readonly rebuildsForSeed = true;
    private readonly world = new THREE.Group();
    private readonly lights: ParkLights;
    private readonly banner: MachiLyricScreen;
    private readonly lanterns: ParkLanterns;
    private readonly petals: ParkPetals;
    private readonly koi: ParkKoi;
    private readonly playground: PlaygroundParts;
    private readonly clock: { hour: THREE.Object3D; minute: THREE.Object3D };
    private readonly glowA: THREE.Vector4;
    private readonly glowB: THREE.Vector4;
    private readonly swingPhases: number[];
    private content: MachiSceneContent | null = null;
    private lanternTarget: MachiSceneFrame['target'] | null = null;

    constructor(private readonly context: MachiSceneContext) {
        const { materials, blend, geometryCache } = context;
        const seed = context.song.seed;
        const random = createVisualizerRng(`park:${seed}`);
        materials.defineGlows(PARK_GLOWS);
        this.root.name = 'Park';
        const built = withGeometryCache(geometryCache, () => ({
            grounds: buildParkGrounds(materials, seed),
            trees: buildSakuraTrees(materials, seed),
            playground: buildPlayground(materials),
        }));
        const { grounds, trees, playground } = built;
        this.playground = playground;
        this.clock = grounds.clock;
        this.world.name = 'Park/world';
        this.world.add(grounds.group, trees.group, playground.group);
        // 亮的东西进倒影图层（池水里映得出灯、横幅）；舞台与树干当遮挡。
        this.world.traverse(object => {
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const isGlow = object.material.name.startsWith('machi:glow');
            const isOccluder = object.name.startsWith('Stage/') || object.name === 'Trunk' || object.name.startsWith('Bridge/');
            if (isGlow || isOccluder) object.layers.enable(MACHI_REFLECT_LAYER);
        });
        this.surfaces = { road: [] as THREE.Mesh[], lot: grounds.paths, water: [grounds.water] };
        this.puddles = { offset: [random() * 80 - 40, random() * 80 - 40] as [number, number], amount: 0.4 + random() * 0.25 };
        bakeStatic(this.world);

        // 横幅：两杆之间，转向镜头一点；字是逐字“印”上去的布横幅。
        this.banner = new MachiLyricScreen(materials, blend, grounds.banner.width, grounds.banner.height, 'banner');
        const bannerFace = this.banner.createFace(grounds.banner.position, grounds.banner.rotationY, 'Banner');
        bannerFace.layers.enable(MACHI_REFLECT_LAYER);
        // 提灯：前面一串写字，舞台两根杆往后排两棵树各拉一串不写字的。
        const textLine = {
            from: new THREE.Vector3(...LANTERN_LINE.from),
            to: new THREE.Vector3(...LANTERN_LINE.to),
            sag: LANTERN_LINE.sag,
            count: LANTERN_LINE.count,
        };
        const backTrees = [TREES[0]!, TREES[2]!];
        const plainLines = grounds.poleTops.map((top, index) => ({
            from: top.clone(),
            to: new THREE.Vector3(backTrees[index]!.x * 0.92, 3.3 * backTrees[index]!.scale, backTrees[index]!.z + 0.6),
            sag: 0.45,
            count: 6,
        }));
        this.lanterns = new ParkLanterns(materials, textLine, plainLines);
        this.petals = new ParkPetals(materials, trees.crowns, context.previewMode ? 220 : 520);
        this.koi = new ParkKoi(materials, Array.from({ length: 5 }, (_, index) => KOI_COLORS[(index + Math.floor(random() * KOI_COLORS.length)) % KOI_COLORS.length]!));
        this.swingPhases = [random() * 6, random() * 6];
        this.lights = new ParkLights(blend, materials, grounds.lamps, grounds.floods, [-2.6, 2.6].map(x => new THREE.Vector3(x, 2.35, LANTERN_LINE.from[2])));
        this.root.add(this.world, bannerFace, this.lanterns.group, this.petals.points, this.koi.mesh, this.lights.group);

        this.weather = {
            half: MACHI_BASE.half,
            groundY: LEVEL.grass,
            roofs: [],
            drips: [],
            // 落进灯光里的雨丝被照亮：两盏园灯、横幅前。
            glints: [
                { position: grounds.lamps[0]!.clone().setY(1.8), radius: 1.5 },
                { position: grounds.lamps[1]!.clone().setY(1.8), radius: 1.5 },
                { position: grounds.banner.position.clone().add(new THREE.Vector3(Math.sin(STAGE.rotationY), -0.6, Math.cos(STAGE.rotationY)).multiplyScalar(1)), radius: 1.9 },
            ],
            windYaw: (random() - 0.5) * 1.2,
            windSlant: 0.06 + random() * 0.12,
        };
        this.framing = { points: parkFramingPoints(), view: { ...PARK_VIEW } };
        // 雾里的两处灯：前面那串提灯、舞台。
        this.glowA = new THREE.Vector4(0, 0, LANTERN_LINE.from[2], 3.8);
        this.glowB = new THREE.Vector4(STAGE.x, 0, STAGE.z + 1.2, 2.6);
        this.syncColors();
        context.invalidateShadows();
    }

    setContent(content: MachiSceneContent) {
        this.content = content;
        const { palette, song, font } = content;
        const accent = vivid(palette.brand[0], 0.62, 0.3, 0.46);
        this.banner.setContent({
            palette,
            font,
            measure: createMachiMeasure(font),
            matchers: prepareWordColorMatchers(content.theme.wordColors),
            cardTitle: `桜まつり ♪ ${song.title || ''}`.trim(),
            cardSubtitle: song.artist || song.album || '',
            banner: { cloth: BANNER_CLOTH, border: palette.brand[0], ink: adjustLightnessForContrast(accent, BANNER_CLOTH, 4.5) },
        });
        this.lanternTarget = null;
    }

    swapSong(_song: MachiSongContext, content: MachiSceneContent) {
        this.setContent(content);
    }

    direct(frame: MachiSceneFrame) {
        const { ambientTime, chorus, staticMode, environment, look } = frame;
        if (frame.targetChanged) this.banner.show(frame.target, frame.lines, frame.immediate, frame.showText);
        else if (frame.preheat) this.banner.preheat(frame.preheat, frame.lines, frame.showText);
        const wind = Math.min(1, 0.35 + 0.35 * frame.rain + 0.2 * environment.snow + 0.15 * frame.audio);
        // 横幅：白天日光照着，夜里两盏灯照着（略暗一点，暖一点）。
        this.banner.update({
            songTime: frame.songTime,
            ambientTime,
            delta: frame.delta,
            staticMode,
            chorus,
            audio: frame.audio,
            light: (0.82 + 0.18 * environment.daylight) * (1 - 0.25 * environment.fog),
            wind,
        });
        // 提灯：换牌面时写下一句。
        const content = this.content;
        if (content && (frame.targetChanged || !this.lanternTarget)) {
            this.lanternTarget = frame.target;
            const glyphs = frame.showText ? resolveLanternGlyphs(frame.target, frame.lines, content.song, this.lanterns.count) : resolveLanternGlyphs({ kind: 'card' }, frame.lines, content.song, this.lanterns.count);
            this.lanterns.setGlyphs(glyphs, content.font, '#2a1b16', ambientTime, frame.immediate);
        }
        const lit = look.streetLamps;
        // 纸里透出来的光：不能太亮，不然白灯笼上的字被 bloom 晕没了。
        this.lanterns.update(staticMode ? 0 : ambientTime, staticMode ? 0 : wind, 0.85 + 0.35 * lit + 0.15 * chorus, environment.daylight);
        this.lights.setLevels({
            lamps: lit,
            floods: Math.max(lit, 0.15) * (1 + 0.15 * chorus),
            lanterns: lit * (1 + 0.2 * chorus),
            pools: 1 - 0.85 * environment.daylight,
        });
        const materials = this.context.materials;
        materials.setGlowLevel('lampGlobe', 0.25 + 0.75 * lit);
        materials.setGlowLevel('floodHead', 0.2 + 0.8 * lit);
        materials.setGlowLevel('vendingGlow', look.artificial);
        // 花瓣：晴天最多，下雨少，下雪没有；副歌时多一点。
        const petals = (1 - environment.snow) * (1 - 0.65 * environment.rain) * (1 - 0.3 * environment.fog) * (0.75 + 0.25 * chorus);
        this.petals.update(staticMode ? 0 : ambientTime, petals, frame.pixelsPerUnit, frame.atmosphere.wind, this.context.blend.get('petal'));
        this.koi.update(staticMode ? 0 : ambientTime);
        // 秋千随风摆，跷跷板慢慢起伏，摇摇马轻轻晃。
        const t = staticMode ? 0 : ambientTime;
        this.playground.swings.forEach((swing, index) => {
            swing.rotation.x = Math.sin(t * 1.9 + this.swingPhases[index]!) * (0.12 + 0.18 * wind + 0.1 * frame.audio);
        });
        this.playground.seesaw.rotation.z = Math.sin(t * 0.8) * 0.2;
        this.playground.rider.rotation.x = Math.sin(t * 2.6) * 0.06;
        // 公园时钟：本地时间。
        const now = new Date();
        const minutes = now.getMinutes() + now.getSeconds() / 60;
        this.clock.minute.rotation.z = -(minutes / 60) * Math.PI * 2;
        this.clock.hour.rotation.z = -(((now.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2;
        const night = 1 - 0.85 * environment.daylight;
        const atmosphere = frame.atmosphere;
        atmosphere.glowA.copy(this.glowA);
        atmosphere.glowB.copy(this.glowB);
        atmosphere.glowColorA.copy(this.context.blend.get('lanternGlow')).multiplyScalar(0.45 * lit * night);
        atmosphere.glowColorB.copy(this.context.blend.get('streetLight')).multiplyScalar(0.3 * lit * night);
    }

    syncColors() {
        this.context.materials.syncColors();
        this.lights.sync();
        const blend = this.context.blend;
        this.lanterns.setColors(blend.get('lanternRed'), blend.get('lanternWhite'), blend.get('brand0'));
    }

    /** 提灯翻字跟氛围时钟走，暂停时不翻，所以只看横幅。 */
    get busy() {
        return this.banner.busy;
    }

    dispose() {
        const geometries = new Set<THREE.BufferGeometry>(this.context.geometryCache.values());
        this.world.traverse(object => {
            if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry);
        });
        geometries.forEach(geometry => geometry.dispose());
        this.banner.dispose();
        this.lanterns.dispose();
        this.petals.dispose();
        this.koi.dispose();
        this.lights.dispose();
        this.context.materials.dispose();
        this.root.removeFromParent();
    }
}

export const PARK_SCENE: MachiSceneDefinition = {
    resolveArt: resolveParkArt,
    create: context => new ParkScene(context),
};
