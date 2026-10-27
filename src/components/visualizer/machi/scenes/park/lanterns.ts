import * as THREE from 'three';
import type { Line } from '../../../../../types';
import type { MachiSongContext } from '../../createMachiRuntime';
import type { MachiBoardTarget } from '../../engine/director';
import { sagWire } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { context2d, createCanvas, fitFont, type MachiFont } from '../../engine/signRaster';

// src/components/visualizer/machi/scenes/park/lanterns.ts
// 提灯：几串挂在下垂的绳上的纸灯笼（一个 InstancedMesh 画灯身、一个画字），随风轻轻摆，夜里亮起来。
// 前面那一串每盏写一个字，连起来是下一句（太长就截断）；换行时字一盏接一盏翻过去，换成新的。
// 字画在一张图集上：两半各 16 格，新字画进不在用的那一半，着色器按每盏的翻转进度决定显示哪一半。

const ATLAS = { columns: 8, rows: 4, cell: 128 } as const;
const HALF_SLOTS = (ATLAS.columns * ATLAS.rows) / 2;
const FLIP_SECONDS = 0.38;
const FLIP_STAGGER = 0.07;
const RADIUS = 0.2;
const HEIGHT = 0.5;

const BODY_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWind;
attribute vec3 aColor;
attribute float aPhase;
varying vec3 vColor;
varying vec2 vUv;
varying vec3 vLocal;
mat3 swing(float phase) {
    float a = sin(uTime * 1.4 + phase) * (0.05 + 0.1 * uWind);
    float b = sin(uTime * 1.1 + phase * 1.7) * (0.03 + 0.06 * uWind);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(a), sin(a), 0.0, -sin(a), cos(a));
    mat3 rz = mat3(cos(b), sin(b), 0.0, -sin(b), cos(b), 0.0, 0.0, 0.0, 1.0);
    return rx * rz;
}
void main() {
    vColor = aColor;
    vUv = uv;
    vLocal = position;
    vec3 p = swing(aPhase) * position;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const BODY_FRAGMENT = /* glsl */ `
uniform float uGlow;
uniform float uDay;
varying vec3 vColor;
varying vec2 vUv;
varying vec3 vLocal;
void main() {
    // 竹骨：沿高度一道道细的暗纹；上下两头是黑色的木圈。
    float rib = 0.86 + 0.14 * smoothstep(0.0, 0.35, abs(fract(vUv.y * 9.0) - 0.5));
    float cap = step(vUv.y, 0.07) + step(0.93, vUv.y);
    // 纸里透出来的光：中间亮、两头暗；白天就是纸的颜色。
    float belly = 1.0 - pow(abs(vUv.y - 0.5) * 2.0, 2.0) * 0.45;
    vec3 paper = vColor * rib * mix(belly * uGlow, 0.95, uDay);
    vec3 color = mix(paper, vec3(0.06, 0.05, 0.05), clamp(cap, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const LABEL_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uFlipStart;
uniform float uFlipSeconds;
uniform float uStagger;
attribute float aPhase;
attribute float aIndex;
attribute float aSlot;
varying vec2 vUv;
varying float vHalf;
varying float vSlot;
mat3 swing(float phase) {
    float a = sin(uTime * 1.4 + phase) * (0.05 + 0.1 * uWind);
    float b = sin(uTime * 1.1 + phase * 1.7) * (0.03 + 0.06 * uWind);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(a), sin(a), 0.0, -sin(a), cos(a));
    mat3 rz = mat3(cos(b), sin(b), 0.0, -sin(b), cos(b), 0.0, 0.0, 0.0, 1.0);
    return rx * rz;
}
void main() {
    // 翻字：每盏晚一点开始，前一半旧字转到侧面，后一半新字转回来。
    float f = clamp((uTime - uFlipStart - aIndex * uStagger) / uFlipSeconds, 0.0, 1.0);
    vHalf = step(0.5, f);
    vUv = uv;
    vSlot = aSlot;
    vec3 p = position;
    p.x *= abs(cos(f * 3.14159));
    p = swing(aPhase) * p;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const LABEL_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCurrent;
uniform float uDay;
varying vec2 vUv;
varying float vHalf;
varying float vSlot;
void main() {
    // 翻过一半之前显示旧的那一半图集，之后显示新的。
    float side = vHalf > 0.5 ? uCurrent : 1.0 - uCurrent;
    float slot = vSlot + side * ${HALF_SLOTS.toFixed(1)};
    vec2 cell = vec2(mod(slot, ${ATLAS.columns.toFixed(1)}), floor(slot / ${ATLAS.columns.toFixed(1)}));
    vec2 uv = (cell + vec2(vUv.x, 1.0 - vUv.y)) / vec2(${ATLAS.columns.toFixed(1)}, ${ATLAS.rows.toFixed(1)});
    uv.y = 1.0 - uv.y;
    vec4 ink = texture2D(uAtlas, uv);
    if (ink.a < 0.05) discard;
    gl_FragColor = vec4(ink.rgb * mix(0.85, 1.0, uDay), ink.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/** 一盏灯的放法：挂点、颜色、摆动相位、写不写字（-1 不写）。 */
interface LanternSpot {
    hang: THREE.Vector3;
    /** 0 红、1 白、2 主题色。 */
    kind: number;
    phase: number;
    slot: number;
}

const sagPoints = (from: THREE.Vector3, to: THREE.Vector3, sag: number, count: number, inset = 0.5) => Array.from({ length: count }, (_, index) => {
    const t = (index + inset) / count;
    const point = from.clone().lerp(to, t);
    point.y -= sag * 4 * t * (1 - t);
    return point;
});

/** 下一句（没有就译文；曲名卡时是曲名）拆成一个个字：去掉空白，太长截断，不够两边留空灯。 */
export const resolveLanternGlyphs = (target: MachiBoardTarget, lines: readonly Line[], song: Pick<MachiSongContext, 'title'>, count: number) => {
    let text: string;
    if (target.kind === 'card') text = song.title || '桜まつり';
    else {
        const next = lines.slice(target.index + 1).find(line => line.fullText.trim());
        text = next?.fullText ?? lines[target.index]?.translation ?? '';
    }
    let glyphs = Array.from(text.replace(/\s+/g, ''));
    if (glyphs.length === 0) glyphs = Array.from('桜まつり');
    if (glyphs.length > count) glyphs = [...glyphs.slice(0, count - 1), '…'];
    const pad = Math.floor((count - glyphs.length) / 2);
    return Array.from({ length: count }, (_, index) => glyphs[index - pad] ?? '');
};

export class ParkLanterns {
    readonly group = new THREE.Group();
    private readonly bodyMaterial: THREE.ShaderMaterial;
    private readonly labelMaterial: THREE.ShaderMaterial;
    private readonly atlas = createCanvas(ATLAS.columns * ATLAS.cell, ATLAS.rows * ATLAS.cell);
    private readonly atlasTexture: THREE.CanvasTexture;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly textCount: number;
    private glyphs: string[] = [];
    private current = 0;
    private readonly kinds: number[];
    private readonly colors: THREE.InstancedBufferAttribute;

    /** textLine：前面写字那一串的两头与下垂；plainLines：不写字的几串。 */
    constructor(
        materials: MachiMaterials,
        textLine: { from: THREE.Vector3; to: THREE.Vector3; sag: number; count: number },
        plainLines: { from: THREE.Vector3; to: THREE.Vector3; sag: number; count: number }[],
    ) {
        this.group.name = 'Lanterns';
        this.textCount = textLine.count;
        const wire = materials.toon('rubber');
        const spots: LanternSpot[] = [];
        const lines = [{ ...textLine, text: true }, ...plainLines.map(line => ({ ...line, text: false }))];
        lines.forEach((line, lineIndex) => {
            this.group.add(sagWire(wire, line.from, line.to, line.sag, 0.008));
            sagPoints(line.from, line.to, line.sag, line.count).forEach((point, index) => {
                const kind = index % 3 === 2 ? 2 : index % 2 === 0 ? 0 : 1;
                spots.push({ hang: point.clone().setY(point.y - 0.06), kind, phase: lineIndex * 2.1 + index * 0.9, slot: line.text ? index : -1 });
            });
        });

        // 灯身：车床出来的鼓形，uv.y 沿高度。挂点在顶上（本地原点），灯身往下垂。
        const profile = [
            [0.07, 0], [0.12, -0.02], [RADIUS * 0.92, -0.08], [RADIUS, -HEIGHT * 0.5], [RADIUS * 0.92, -HEIGHT + 0.08], [0.12, -HEIGHT + 0.02], [0.07, -HEIGHT],
        ].map(([x, y]) => new THREE.Vector2(x!, y!)).reverse();
        const bodyGeometry = new THREE.LatheGeometry(profile, 16);
        this.geometries.push(bodyGeometry);
        const phases = new Float32Array(spots.map(spot => spot.phase));
        this.kinds = spots.map(spot => spot.kind);
        this.colors = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
        bodyGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        bodyGeometry.setAttribute('aColor', this.colors);
        const shared = { uTime: { value: 0 }, uWind: { value: 0.5 } };
        this.bodyMaterial = materials.track(new THREE.ShaderMaterial({
            vertexShader: BODY_VERTEX,
            fragmentShader: BODY_FRAGMENT,
            uniforms: { ...shared, uGlow: { value: 1.6 }, uDay: { value: 0 } },
        }));
        const bodies = new THREE.InstancedMesh(bodyGeometry, this.bodyMaterial, spots.length);
        bodies.name = 'Lanterns/bodies';
        bodies.castShadow = false;
        const matrix = new THREE.Matrix4();
        spots.forEach((spot, index) => {
            matrix.makeTranslation(spot.hang.x, spot.hang.y, spot.hang.z);
            bodies.setMatrixAt(index, matrix);
        });
        bodies.frustumCulled = false;
        this.group.add(bodies);

        // 字：前面一串每盏一块朝前的小片（在灯身前面一点），翻字、摆动都和灯身同一套。
        this.atlasTexture = new THREE.CanvasTexture(this.atlas);
        this.atlasTexture.colorSpace = THREE.SRGBColorSpace;
        this.atlasTexture.anisotropy = 4;
        const textSpots = spots.filter(spot => spot.slot >= 0);
        const labelGeometry = new THREE.PlaneGeometry(0.3, 0.3).translate(0, -HEIGHT * 0.5, RADIUS + 0.012);
        this.geometries.push(labelGeometry);
        labelGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(textSpots.map(spot => spot.phase)), 1));
        labelGeometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(new Float32Array(textSpots.map(spot => spot.slot)), 1));
        labelGeometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Float32Array(textSpots.map(spot => spot.slot)), 1));
        this.labelMaterial = materials.track(new THREE.ShaderMaterial({
            vertexShader: LABEL_VERTEX,
            fragmentShader: LABEL_FRAGMENT,
            uniforms: {
                ...shared,
                uAtlas: { value: this.atlasTexture },
                uCurrent: { value: 0 },
                uDay: { value: 0 },
                uFlipStart: { value: -1000 },
                uFlipSeconds: { value: FLIP_SECONDS },
                uStagger: { value: FLIP_STAGGER },
            },
            transparent: true,
            depthWrite: false,
        }));
        const labels = new THREE.InstancedMesh(labelGeometry, this.labelMaterial, textSpots.length);
        labels.name = 'Lanterns/labels';
        labels.frustumCulled = false;
        labels.renderOrder = 3;
        textSpots.forEach((spot, index) => {
            matrix.makeTranslation(spot.hang.x, spot.hang.y, spot.hang.z);
            labels.setMatrixAt(index, matrix);
        });
        this.group.add(labels);
    }

    /** 把一组字画进图集的某一半。 */
    private paintHalf(half: number, glyphs: string[], font: MachiFont, ink: string) {
        const context = context2d(this.atlas);
        const top = half * (ATLAS.rows / 2) * ATLAS.cell;
        context.clearRect(0, top, this.atlas.width, (ATLAS.rows / 2) * ATLAS.cell);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        glyphs.forEach((glyph, index) => {
            if (!glyph) return;
            const x = (index % ATLAS.columns) * ATLAS.cell;
            const y = top + Math.floor(index / ATLAS.columns) * ATLAS.cell;
            context.fillStyle = ink;
            fitFont(context, font, glyph, ATLAS.cell * 0.86, ATLAS.cell * 0.8);
            context.fillText(glyph, x + ATLAS.cell / 2, y + ATLAS.cell * 0.54);
        });
        this.atlasTexture.needsUpdate = true;
    }

    get count() {
        return this.textCount;
    }

    /** 灯纸的颜色（红、白、主题色，插值后的）。 */
    setColors(red: THREE.Color, white: THREE.Color, accent: THREE.Color) {
        const choices = [red, white, accent];
        this.kinds.forEach((kind, index) => {
            const color = choices[kind]!;
            this.colors.setXYZ(index, color.r, color.g, color.b);
        });
        this.colors.needsUpdate = true;
    }

    /** 换字：一样就不动；immediate（静态模式、暂停、换主题）直接换上，不翻。 */
    setGlyphs(glyphs: string[], font: MachiFont, ink: string, time: number, immediate: boolean) {
        if (glyphs.join('\u0000') === this.glyphs.join('\u0000') && !immediate) return;
        this.glyphs = glyphs;
        const next = 1 - this.current;
        this.paintHalf(next, glyphs, font, ink);
        this.current = next;
        this.labelMaterial.uniforms.uCurrent!.value = next;
        this.labelMaterial.uniforms.uFlipStart!.value = immediate ? -1000 : time;
    }

    /** 每帧：摆动、亮度（夜里纸里透光，白天是纸色）。 */
    update(time: number, wind: number, glow: number, daylight: number) {
        this.bodyMaterial.uniforms.uTime!.value = time;
        this.bodyMaterial.uniforms.uWind!.value = wind;
        this.bodyMaterial.uniforms.uGlow!.value = glow;
        this.bodyMaterial.uniforms.uDay!.value = daylight;
        this.labelMaterial.uniforms.uDay!.value = daylight;
    }

    dispose() {
        this.atlasTexture.dispose();
        this.geometries.forEach(geometry => geometry.dispose());
        this.group.traverse(object => {
            if (object instanceof THREE.Mesh && !this.geometries.includes(object.geometry)) object.geometry.dispose();
        });
    }
}
