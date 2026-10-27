import * as THREE from 'three';
import { LEVEL } from '../geometry/layout';
import type { KonbiniMaterials } from '../konbiniMaterials';
import { createCanvas, drawIcon, fontSpec, type KonbiniFont } from '../konbiniSignRaster';

// src/components/visualizer/konbini/actors/konbiniNobori.ts
// 店门口的のぼり旗：三面竖长的布旗插在场地边上，随风飘（顶点着色器里沿布面法线的波，离旗杆越远摆得越大，
// 只读氛围时钟，暂停时停住）。布面画的是曲名（竖排）、主题图标 + 主题名、经典的「おでん」，底色用主题的品牌色。

const FLAG = { width: 0.46, height: 1.5, bottom: 0.62 };
/** 旗的位置（门左边的场地边上，避开自行车和进出店的路线）。 */
const SPOTS = [-3.25, -2.5, -1.78].map(x => ({ x, z: 1.9 }));
const WAVE_SEGMENTS = 10;

const WAVE_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uPhase;
`;

const WAVE_VERTEX = /* glsl */ `
// 布面沿本地 +x 从旗杆往外，离旗杆越远摆幅越大。
float kFlagU = clamp(position.x / ${FLAG.width.toFixed(3)}, 0.0, 1.0);
float kWave = sin(position.x * 7.0 - uTime * (3.2 + uWind * 2.0) + uPhase + position.y * 1.3)
    + 0.4 * sin(position.x * 13.0 - uTime * 5.1 + uPhase * 1.7);
transformed.z += kWave * kFlagU * (0.035 + 0.05 * uWind);
transformed.x -= abs(kWave) * kFlagU * 0.012;
`;

export interface KonbiniNoboriPaint {
    font: KonbiniFont;
    title: string;
    themeName: string;
    icon?: string;
    fallbacks: readonly string[];
    brand: readonly [string, string, string];
    ink: string;
}

/** 竖排写字：中日韩逐字竖排，拉丁字转 90° 顺着写；放不下就缩字。 */
const drawVertical = (context: CanvasRenderingContext2D, font: KonbiniFont, text: string, x: number, top: number, bottom: number, maxWidth: number) => {
    const chars = Array.from(text.trim() || ' ');
    const latin = !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
    const available = bottom - top;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (latin) {
        let px = maxWidth * 0.8;
        context.font = fontSpec(font, px);
        const width = context.measureText(text).width;
        if (width > available) px = (px * available) / width;
        context.font = fontSpec(font, px);
        context.save();
        context.translate(x, (top + bottom) / 2);
        context.rotate(Math.PI / 2);
        context.fillText(text, 0, 0);
        context.restore();
        return;
    }
    const px = Math.min(maxWidth * 0.82, available / chars.length / 1.04);
    context.font = fontSpec(font, px);
    const step = px * 1.04;
    const start = top + (available - step * chars.length) / 2 + step / 2;
    chars.forEach((char, index) => context.fillText(char, x, start + index * step));
};

export class KonbiniNobori {
    readonly group = new THREE.Group();
    private readonly flags: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }[] = [];
    private readonly uniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } };
    private readonly geometries: THREE.BufferGeometry[] = [];

    constructor(materials: KonbiniMaterials) {
        this.group.name = 'Nobori';
        const cloth = new THREE.PlaneGeometry(FLAG.width, FLAG.height, WAVE_SEGMENTS, 4).translate(FLAG.width / 2, FLAG.height / 2, 0);
        const pole = new THREE.CylinderGeometry(0.018, 0.022, FLAG.bottom + FLAG.height + 0.12, 6).translate(0, (FLAG.bottom + FLAG.height + 0.12) / 2, 0);
        const bar = new THREE.CylinderGeometry(0.012, 0.012, FLAG.width + 0.04, 5).rotateZ(Math.PI / 2).translate(FLAG.width / 2, 0, 0);
        const base = new THREE.CylinderGeometry(0.14, 0.16, 0.12, 10).translate(0, 0.06, 0);
        this.geometries.push(cloth, pole, bar, base);
        const poleMaterial = materials.toon('white');
        const baseMaterial = materials.toon('darkMetal');
        SPOTS.forEach((spot, index) => {
            const canvas = createCanvas(128, 416);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            this.flags.push({ canvas, texture });
            const material = materials.track(new THREE.MeshToonMaterial({ map: texture, gradientMap: materials.gradient, side: THREE.DoubleSide }));
            material.emissive.setScalar(0.18);
            material.emissiveMap = texture;
            const phase = index * 1.9;
            material.onBeforeCompile = shader => {
                Object.assign(shader.uniforms, this.uniforms, { uPhase: { value: phase } });
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', `#include <common>\n${WAVE_PARS}`)
                    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WAVE_VERTEX}`);
            };
            material.customProgramCacheKey = () => `konbini-nobori-${index}`;
            const flag = new THREE.Group();
            flag.name = `Nobori${index}`;
            const clothMesh = new THREE.Mesh(cloth, material);
            clothMesh.position.y = FLAG.bottom;
            clothMesh.castShadow = false;
            const poleMesh = new THREE.Mesh(pole, poleMaterial);
            const barMesh = new THREE.Mesh(bar, poleMaterial);
            barMesh.position.y = FLAG.bottom + FLAG.height + 0.01;
            const baseMesh = new THREE.Mesh(base, baseMaterial);
            flag.add(clothMesh, poleMesh, barMesh, baseMesh);
            flag.position.set(spot.x, LEVEL.lot, spot.z);
            // 布面朝前右（大致对着默认镜头），旗杆在左。
            flag.rotation.y = 0.35;
            this.group.add(flag);
        });
    }

    /** 换歌 / 换主题时重画三面旗。 */
    paint(paint: KonbiniNoboriPaint) {
        const contents = [
            { background: paint.brand[0], ink: '#ffffff', text: paint.title, icon: undefined as string | undefined },
            { background: paint.brand[2], ink: '#ffffff', text: paint.themeName || '新発売', icon: paint.icon },
            { background: paint.brand[1], ink: paint.ink, text: 'おでん', icon: undefined },
        ];
        this.flags.forEach((flag, index) => {
            const content = contents[index]!;
            const context = flag.canvas.getContext('2d')!;
            const { width, height } = flag.canvas;
            context.fillStyle = content.background;
            context.fillRect(0, 0, width, height);
            // 上下各一道白边、旗杆一侧一条深色的穿杆布。
            context.fillStyle = 'rgba(255,255,255,0.85)';
            context.fillRect(0, height * 0.03, width, height * 0.012);
            context.fillRect(0, height * 0.955, width, height * 0.012);
            context.fillStyle = 'rgba(0,0,0,0.18)';
            context.fillRect(0, 0, width * 0.08, height);
            context.fillStyle = content.ink;
            let top = height * 0.07;
            if (content.icon) {
                const size = width * 0.62;
                drawIcon(context, content.icon, paint.fallbacks, (width - size) / 2 + width * 0.03, top, size, content.ink, 2.2);
                top += size + height * 0.03;
            }
            drawVertical(context, paint.font, content.text, width * 0.53, top, height * 0.93, width);
            flag.texture.needsUpdate = true;
        });
    }

    update(time: number, wind: number) {
        this.uniforms.uTime.value = time;
        this.uniforms.uWind.value = wind;
    }

    dispose() {
        this.flags.forEach(flag => flag.texture.dispose());
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
