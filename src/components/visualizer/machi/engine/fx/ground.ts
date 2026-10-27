import * as THREE from 'three';
import type { MachiColorBlend, MachiMaterials } from '../materials';
import { injectMachiSnow, type MachiSnowUniforms } from '../snow';

// src/components/visualizer/machi/engine/fx/ground.ts
// 湿路面：沥青和人行道顶面换成注入了水洼的卡通材质。水洼位置是按 seed 平移的两层值噪声；水洼里压暗底色、
// 映出天空色与倒影贴图（按雨点涟漪的法线扰动），水洼外只有一层弱的湿润反光。涟漪是格子里随机生灭的圆环，
// 只用氛围时钟，暂停时定格。所有湿面共用一组 uniform。湿度（uWet）随天气变：干的时候没有水洼、没有反光；
// 积雪时雪盖住路面（与卡通材质同一段积雪着色），水洼也被盖住。

export interface MachiGroundUniforms {
    uTime: { value: number };
    uReflection: { value: THREE.Texture | null };
    uReflectMatrix: { value: THREE.Matrix4 };
    uPuddleOffset: { value: THREE.Vector2 };
    uPuddleAmount: { value: number };
    uRain: { value: number };
    /** 路面湿度 0..1（雨停后慢慢干）。 */
    uWet: { value: number };
    uSky: { value: THREE.Color };
    uReflectStrength: { value: number };
}

const PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uReflection;
uniform mat4 uReflectMatrix;
uniform vec2 uPuddleOffset;
uniform float uPuddleAmount;
uniform float uRain;
uniform float uWet;
uniform vec3 uSky;
uniform float uReflectStrength;
uniform float uPuddleBias;
uniform float uWater;
varying vec3 vKWorld;

float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(kHash(i), kHash(i + vec2(1.0, 0.0)), u.x), mix(kHash(i + vec2(0.0, 1.0)), kHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float kPuddle(vec2 p) {
    float n = kNoise(p * 0.62 + uPuddleOffset) * 0.62 + kNoise(p * 1.7 - uPuddleOffset * 1.3) * 0.38;
    float threshold = mix(0.78, 0.46, uPuddleAmount) + uPuddleBias;
    return smoothstep(threshold, threshold + 0.05, n);
}
// 一层涟漪：每格一个随机中心的扩散圆环，返回 xz 方向的法线扰动与环的亮度。
vec3 kRippleLayer(vec2 p, float scale, float t, float salt) {
    vec2 q = p * scale;
    vec2 cell = floor(q);
    vec2 center = cell + 0.22 + 0.56 * vec2(kHash(cell + salt), kHash(cell + salt + 7.13));
    float period = 0.75 + 0.9 * kHash(cell + salt + 3.31);
    float phase = fract(t / period + kHash(cell + salt + 11.7));
    float alive = step(kHash(cell + salt + floor(t / period + kHash(cell + salt + 11.7)) * 0.37), uRain);
    vec2 d = q - center;
    float dist = length(d);
    float radius = phase * 0.46;
    float band = 1.0 - smoothstep(0.0, 0.07, abs(dist - radius));
    float fade = (1.0 - phase) * alive;
    float wave = sin((dist - radius) * 48.0) * band * fade;
    return vec3(normalize(d + 1e-4) * wave, band * fade);
}
`;

const OUTPUT = /* glsl */ `
{
    vec2 kp = vKWorld.xz;
    // 干的时候没有水洼；积雪盖住水洼。
    float puddle = uWater > 0.5 ? 1.0 : kPuddle(kp) * smoothstep(0.15, 0.85, uWet) * (1.0 - min(1.0, uMachiSnow * 1.5));
    float wetness = max(uWet, uWater);
    vec3 ripple = kRippleLayer(kp, 2.3, uTime, 0.0) + kRippleLayer(kp, 3.9, uTime * 1.13, 19.0) * 0.7;
    vec4 rc = uReflectMatrix * vec4(vKWorld, 1.0);
    vec2 ruv = rc.xy / rc.w + ripple.xy * mix(0.004, 0.018, puddle);
    vec3 reflection = texture2D(uReflection, ruv).rgb;
    // 水洼：压暗、映天空、映倒影；水洼外：湿润的一层弱反光。
    vec3 wet = outgoingLight * mix(1.0, 0.78, wetness) + reflection * uReflectStrength * 0.16 * wetness;
    vec3 pool = outgoingLight * 0.42 + uSky * 0.18 + reflection * uReflectStrength + ripple.z * uSky * 0.6;
    outgoingLight = mix(wet, pool, puddle);
}
`;

export class MachiGround {
    readonly uniforms: MachiGroundUniforms = {
        uTime: { value: 0 },
        uReflection: { value: null },
        uReflectMatrix: { value: new THREE.Matrix4() },
        uPuddleOffset: { value: new THREE.Vector2() },
        uPuddleAmount: { value: 0.6 },
        uRain: { value: 0.75 },
        uWet: { value: 1 },
        uSky: { value: new THREE.Color() },
        uReflectStrength: { value: 0.75 },
    };
    readonly asphalt: THREE.MeshToonMaterial;
    readonly concrete: THREE.MeshToonMaterial;
    /** 池水：整片都是“水洼”，一直湿着，不积雪。 */
    readonly water: THREE.MeshToonMaterial;

    private readonly gradient: THREE.Texture;

    constructor(materials: MachiMaterials, private readonly blend: MachiColorBlend, private readonly snow: MachiSnowUniforms) {
        this.gradient = materials.gradient;
        this.asphalt = materials.track(this.create('asphalt', 0));
        this.concrete = materials.track(this.create('concrete', 0.08));
        this.water = materials.track(this.create('water', 0, true));
    }

    private create(key: 'asphalt' | 'concrete' | 'water', puddleBias: number, water = false) {
        const material = new THREE.MeshToonMaterial({ color: this.blend.get(key), gradientMap: this.gradient });
        material.name = `machi:wet:${key}`;
        material.onBeforeCompile = shader => {
            injectMachiSnow(shader, this.snow);
            Object.assign(shader.uniforms, this.uniforms, { uPuddleBias: { value: puddleBias }, uWater: { value: water ? 1 : 0 } });
            if (water) shader.uniforms.uMachiSnow = { value: 0 };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vKWorld;')
                .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvKWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>\n${PARS}`)
                .replace('#include <opaque_fragment>', `${OUTPUT}\n#include <opaque_fragment>`);
        };
        material.customProgramCacheKey = () => `machi-wet-${puddleBias}-${water ? 1 : 0}`;
        return material;
    }

    syncColors() {
        this.asphalt.color.copy(this.blend.get('asphalt'));
        this.concrete.color.copy(this.blend.get('concrete'));
        this.water.color.copy(this.blend.get('water'));
        this.uniforms.uSky.value.copy(this.blend.get('skyBottom'));
    }
}
