import * as THREE from 'three';
import { BASE, FASCIA, LEVEL, STORE } from './geometry/layout';
import type { KonbiniColorBlend, KonbiniMaterials } from './konbiniMaterials';
import type { KonbiniVariation } from './konbiniSeed';

// src/components/visualizer/konbini/konbiniWeather.ts
// 雨：雨丝（一个 LineSegments，几千条，顶点着色器按氛围时钟往下推、绕回顶上；落在店顶上的停在屋顶）、
// 落地水花（InstancedMesh 的扁圆环，每个实例按周期换位置）、店招下沿与落水管口的滴水（InstancedMesh，
// 一段下落、一段溅开）。都只读 uTime，暂停时定格；不写深度，所以不被描边。三个 draw call。

const RAIN_TOP = 9.5;
const HALF = BASE.half;

const ROOF_UNIFORM = () => new THREE.Vector4(
    STORE.x0 - STORE.overhang,
    STORE.z0 - STORE.overhang,
    STORE.x1 + STORE.overhang,
    STORE.z1 + STORE.overhang,
);

const GROUND_GLSL = /* glsl */ `
uniform vec4 uRoof;
uniform float uRoofY;
float kGround(vec2 p) {
    bool onRoof = p.x > uRoof.x && p.x < uRoof.z && p.y > uRoof.y && p.y < uRoof.w;
    return onRoof ? uRoofY : ${LEVEL.lot.toFixed(3)} * 0.5;
}
float kHash1(float n) { return fract(sin(n) * 43758.5453123); }
`;

const RAIN_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uLength;
uniform float uSpeed;
uniform float uDensity;
attribute vec4 aSeed;
attribute float aEnd;
varying float vAlpha;
${GROUND_GLSL}
void main() {
    vec2 base = aSeed.xy;
    float ground = kGround(base);
    float fall = ${RAIN_TOP.toFixed(2)} - ground;
    float speed = uSpeed * (0.85 + 0.3 * aSeed.w);
    float y = ${RAIN_TOP.toFixed(2)} - mod(uTime * speed + aSeed.z * fall, fall);
    float drop = ${RAIN_TOP.toFixed(2)} - y;
    vec3 head = vec3(base.x + uWind.x * drop, y, base.y + uWind.y * drop);
    vec3 dir = normalize(vec3(-uWind.x, 1.0, -uWind.y));
    vec3 position = head + dir * uLength * aEnd * (0.75 + 0.5 * aSeed.w);
    position.y = max(position.y, ground);
    float inside = step(abs(head.x), ${(HALF + 0.1).toFixed(2)}) * step(abs(head.z), ${(HALF + 0.1).toFixed(2)});
    float visible = step(aSeed.w, uDensity);
    vAlpha = (1.0 - aEnd * 0.85) * inside * visible * smoothstep(0.0, 0.6, y - ground);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
    gl_FragColor = vec4(uColor * vAlpha * uOpacity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const SPLASH_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uRate;
uniform float uDensity;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vLife;
${GROUND_GLSL}
void main() {
    float cycle = uTime * uRate * (0.8 + 0.4 * aSeed.w) + aSeed.z;
    float index = floor(cycle);
    float life = fract(cycle);
    vec2 p = vec2(kHash1(index * 12.9898 + aSeed.x * 78.233), kHash1(index * 39.346 + aSeed.y * 11.135)) * 2.0 - 1.0;
    p *= ${(HALF - 0.05).toFixed(2)};
    float ground = kGround(p);
    float visible = step(aSeed.w, uDensity);
    float size = (0.06 + 0.24 * life) * visible;
    vUv = uv;
    vLife = life;
    vec3 local = vec3(position.x * size, 0.0, position.y * size);
    vec4 world = modelMatrix * vec4(local + vec3(p.x, ground + 0.012, p.y), 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SPLASH_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vLife;
void main() {
    float d = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.62, 0.86, d) * (1.0 - smoothstep(0.86, 1.0, d));
    float alpha = ring * (1.0 - vLife) * 1.1;
    gl_FragColor = vec4(uColor * alpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const DRIP_VERTEX = /* glsl */ `
uniform float uTime;
attribute vec4 aDrip; // x, z, 起点高度, 落点高度
attribute vec2 aTiming; // 周期, 相位
varying vec2 vUv;
varying float vMode;
varying float vFade;
void main() {
    float height = aDrip.z - aDrip.w;
    float fallTime = sqrt(2.0 * height / 9.8);
    float splashTime = 0.28;
    float t = mod(uTime + aTiming.y * aTiming.x, aTiming.x);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world;
    if (t < fallTime) {
        // 下落：越落越拉长的水滴，朝镜头的小竖条。
        float y = aDrip.z - 0.5 * 9.8 * t * t;
        float stretch = 0.03 + 0.05 * (t / fallTime);
        world = vec3(aDrip.x, y, aDrip.y) + right * position.x * 0.026 + vec3(0.0, 1.0, 0.0) * position.y * stretch;
        vMode = 0.0;
        vFade = 1.0;
    } else if (t < fallTime + splashTime) {
        // 溅开：地上一个扩散的扁圆环。
        float s = (t - fallTime) / splashTime;
        world = vec3(aDrip.x + position.x * (0.05 + 0.16 * s), aDrip.w + 0.014, aDrip.y + position.y * (0.05 + 0.16 * s));
        vMode = 1.0;
        vFade = 1.0 - s;
    } else {
        world = vec3(0.0, -50.0, 0.0);
        vMode = 0.0;
        vFade = 0.0;
    }
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const DRIP_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vMode;
varying float vFade;
void main() {
    vec2 c = vUv - 0.5;
    float alpha;
    if (vMode < 0.5) {
        alpha = 1.0 - smoothstep(0.3, 0.5, length(c * vec2(1.0, 0.55)));
    } else {
        float d = length(c) * 2.0;
        alpha = smoothstep(0.6, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d)) * 0.8;
    }
    gl_FragColor = vec4(uColor * alpha * vFade * 1.3, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const additive = (material: THREE.ShaderMaterial) => {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    return material;
};

export interface KonbiniWeatherFrame {
    time: number;
    /** 雨量 0..1（音频、主题动效强度、副歌推它）。 */
    intensity: number;
}

export class KonbiniWeather {
    readonly group = new THREE.Group();
    private readonly rainMaterial: THREE.ShaderMaterial;
    private readonly splashMaterial: THREE.ShaderMaterial;
    private readonly dripMaterial: THREE.ShaderMaterial;
    private readonly geometries: THREE.BufferGeometry[] = [];

    constructor(materials: KonbiniMaterials, private readonly blend: KonbiniColorBlend, variation: KonbiniVariation, counts: { rain: number; splash: number }) {
        this.group.name = 'Weather';
        const shared = {
            uRoof: { value: ROOF_UNIFORM() },
            uRoofY: { value: STORE.roofTop },
        };
        const wind = new THREE.Vector2(Math.sin(variation.windYaw), Math.cos(variation.windYaw)).multiplyScalar(variation.windSlant);

        // 雨丝。
        const rainGeometry = new THREE.BufferGeometry();
        const seeds = new Float32Array(counts.rain * 2 * 4);
        const ends = new Float32Array(counts.rain * 2);
        const positions = new Float32Array(counts.rain * 2 * 3);
        for (let index = 0; index < counts.rain; index += 1) {
            const seed = [(Math.random() * 2 - 1) * (HALF + 0.6), (Math.random() * 2 - 1) * (HALF + 0.6), Math.random(), Math.random()];
            for (let end = 0; end < 2; end += 1) {
                seeds.set(seed, (index * 2 + end) * 4);
                ends[index * 2 + end] = end;
            }
        }
        rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        rainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
        rainGeometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
        rainGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, RAIN_TOP / 2, 0), 14);
        this.rainMaterial = materials.track(additive(new THREE.ShaderMaterial({
            vertexShader: RAIN_VERTEX,
            fragmentShader: RAIN_FRAGMENT,
            uniforms: {
                ...shared,
                uTime: { value: 0 },
                uWind: { value: wind },
                uLength: { value: 0.42 },
                uSpeed: { value: 11 },
                uDensity: { value: 0.8 },
                uColor: { value: new THREE.Color() },
                uOpacity: { value: 0.3 },
            },
        })));
        const rain = new THREE.LineSegments(rainGeometry, this.rainMaterial);
        rain.name = 'Weather/rain';
        rain.frustumCulled = false;
        rain.renderOrder = 5;

        // 落地水花。
        const splashGeometry = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        splashGeometry.index = quad.index;
        splashGeometry.setAttribute('position', quad.getAttribute('position'));
        splashGeometry.setAttribute('uv', quad.getAttribute('uv'));
        const splashSeeds = new Float32Array(counts.splash * 4);
        for (let index = 0; index < counts.splash; index += 1) {
            splashSeeds.set([Math.random(), Math.random(), Math.random() * 10, Math.random()], index * 4);
        }
        splashGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(splashSeeds, 4));
        splashGeometry.instanceCount = counts.splash;
        this.splashMaterial = materials.track(additive(new THREE.ShaderMaterial({
            vertexShader: SPLASH_VERTEX,
            fragmentShader: SPLASH_FRAGMENT,
            uniforms: {
                ...shared,
                uTime: { value: 0 },
                uRate: { value: 1.6 },
                uDensity: { value: 0.8 },
                uColor: { value: new THREE.Color() },
            },
        })));
        const splashes = new THREE.Mesh(splashGeometry, this.splashMaterial);
        splashes.name = 'Weather/splashes';
        splashes.frustumCulled = false;
        splashes.renderOrder = 4;

        // 滴水：店招下沿（前面、右面）每隔一段一滴，落水管口一串。
        const drips: number[][] = [];
        const timings: number[][] = [];
        const frontZ = STORE.z1 + FASCIA.depth + 0.07;
        const rightX = STORE.x1 + FASCIA.depth + 0.07;
        for (let x = STORE.x0 + 0.3; x < STORE.x1; x += 0.42) {
            drips.push([x + (Math.random() - 0.5) * 0.12, frontZ, FASCIA.y0 - 0.02, LEVEL.lot]);
            timings.push([1.1 + Math.random() * 1.8, Math.random()]);
        }
        for (let z = STORE.z1; z > STORE.z0 + 0.5; z -= 0.45) {
            drips.push([rightX, z + (Math.random() - 0.5) * 0.12, FASCIA.y0 - 0.02, LEVEL.lot]);
            timings.push([1.1 + Math.random() * 1.8, Math.random()]);
        }
        for (let index = 0; index < 4; index += 1) {
            drips.push([STORE.x0 - 0.12 + (Math.random() - 0.5) * 0.04, STORE.z1 + 0.06, LEVEL.lot + 0.08, LEVEL.lot]);
            timings.push([0.32 + Math.random() * 0.12, index / 4]);
        }
        const dripGeometry = new THREE.InstancedBufferGeometry();
        dripGeometry.index = quad.index;
        dripGeometry.setAttribute('position', quad.getAttribute('position'));
        dripGeometry.setAttribute('uv', quad.getAttribute('uv'));
        dripGeometry.setAttribute('aDrip', new THREE.InstancedBufferAttribute(new Float32Array(drips.flat()), 4));
        dripGeometry.setAttribute('aTiming', new THREE.InstancedBufferAttribute(new Float32Array(timings.flat()), 2));
        dripGeometry.instanceCount = drips.length;
        this.dripMaterial = materials.track(additive(new THREE.ShaderMaterial({
            vertexShader: DRIP_VERTEX,
            fragmentShader: DRIP_FRAGMENT,
            uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() } },
        })));
        this.dripMaterial.side = THREE.DoubleSide;
        const dripMesh = new THREE.Mesh(dripGeometry, this.dripMaterial);
        dripMesh.name = 'Weather/drips';
        dripMesh.frustumCulled = false;
        dripMesh.renderOrder = 5;

        this.geometries.push(rainGeometry, splashGeometry, dripGeometry, quad);
        this.group.add(rain, splashes, dripMesh);
        this.syncColors();
    }

    syncColors() {
        // 雨丝偏天空色、提亮；被店里的暖光照着的部分由加色混合自然带出。
        const rain = this.blend.get('skyBottom').clone().lerp(new THREE.Color(0xdfe9ff), 0.72);
        (this.rainMaterial.uniforms.uColor!.value as THREE.Color).copy(rain);
        (this.splashMaterial.uniforms.uColor!.value as THREE.Color).copy(rain).multiplyScalar(0.8);
        (this.dripMaterial.uniforms.uColor!.value as THREE.Color).copy(rain).lerp(this.blend.get('interiorLight'), 0.25);
    }

    update(frame: KonbiniWeatherFrame) {
        const intensity = Math.max(0.15, Math.min(1, frame.intensity));
        this.rainMaterial.uniforms.uTime!.value = frame.time;
        this.rainMaterial.uniforms.uDensity!.value = 0.35 + 0.65 * intensity;
        this.splashMaterial.uniforms.uTime!.value = frame.time;
        this.splashMaterial.uniforms.uDensity!.value = 0.3 + 0.7 * intensity;
        this.dripMaterial.uniforms.uTime!.value = frame.time;
    }

    dispose() {
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
