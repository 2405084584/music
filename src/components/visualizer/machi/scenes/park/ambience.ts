import * as THREE from 'three';
import type { MachiMaterials } from '../../engine/materials';
import { LEVEL, POND } from './layout';

// src/components/visualizer/machi/scenes/park/ambience.ts
// 公园里慢慢动的小东西：从树冠飘下来的樱花瓣（一个 Points，打着旋往下落，落到草地上淡掉，只读氛围时钟）、
// 池子里几条锦鲤（一个 InstancedMesh，沿各自的椭圆慢慢游，每帧摆一次位置）。

const PETAL_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform float uPixelsPerUnit;
uniform vec2 uWind;
attribute vec4 aSeed;   // xz 起点、相位、大小与密度门槛
attribute float aTop;
varying float vAlpha;
varying float vSpin;
void main() {
    float fall = aTop - ${LEVEL.grass.toFixed(3)};
    float speed = 0.32 + 0.22 * aSeed.w;
    float drop = mod(uTime * speed + aSeed.z * fall, fall);
    float y = aTop - drop;
    // 打着旋落：绕一个小圈，再被风带着走。
    float swirl = uTime * (1.2 + aSeed.w) + aSeed.z * 30.0;
    vec3 position = vec3(aSeed.x + cos(swirl) * 0.25 + uWind.x * drop * 2.5, y, aSeed.y + sin(swirl) * 0.25 + uWind.y * drop * 2.5);
    float visible = step(aSeed.w, uAmount);
    vAlpha = visible * smoothstep(0.0, 0.25, y - ${LEVEL.grass.toFixed(3)}) * smoothstep(0.0, 0.4, drop);
    vSpin = swirl * 1.7;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (0.07 + 0.04 * aSeed.w) * uPixelsPerUnit * visible;
}
`;

const PETAL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vSpin;
void main() {
    // 一片花瓣：转着的扁椭圆，翻面时变窄。
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vSpin);
    float s = sin(vSpin);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float flip = 0.35 + 0.65 * abs(sin(vSpin * 0.7));
    float d = length(p / vec2(0.5 * flip, 0.28));
    float alpha = (1.0 - smoothstep(0.7, 1.0, d)) * vAlpha;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export class ParkPetals {
    readonly points: THREE.Points;
    private readonly material: THREE.ShaderMaterial;

    /** crowns：树冠的中心与半径，花瓣从树冠里落下来。 */
    constructor(materials: MachiMaterials, crowns: { center: THREE.Vector3; radius: number }[], count: number) {
        const seeds = new Float32Array(count * 4);
        const tops = new Float32Array(count);
        for (let index = 0; index < count; index += 1) {
            const crown = crowns[index % crowns.length]!;
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.sqrt(Math.random()) * crown.radius;
            seeds.set([crown.center.x + Math.cos(angle) * distance, crown.center.z + Math.sin(angle) * distance, Math.random(), Math.random()], index * 4);
            tops[index] = crown.center.y + (Math.random() - 0.3) * 0.8;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
        geometry.setAttribute('aTop', new THREE.BufferAttribute(tops, 1));
        this.material = materials.track(new THREE.ShaderMaterial({
            vertexShader: PETAL_VERTEX,
            fragmentShader: PETAL_FRAGMENT,
            uniforms: {
                uTime: { value: 0 },
                uAmount: { value: 0.8 },
                uPixelsPerUnit: { value: 60 },
                uWind: { value: new THREE.Vector2() },
                uColor: { value: new THREE.Color(0xf9cfdb) },
            },
            transparent: true,
            depthWrite: false,
        }));
        this.points = new THREE.Points(geometry, this.material);
        this.points.name = 'Petals';
        this.points.frustumCulled = false;
        this.points.renderOrder = 5;
    }

    update(time: number, amount: number, pixelsPerUnit: number, wind: THREE.Vector2, color: THREE.Color) {
        this.points.visible = amount > 0.01;
        this.material.uniforms.uTime!.value = time;
        this.material.uniforms.uAmount!.value = amount;
        this.material.uniforms.uPixelsPerUnit!.value = pixelsPerUnit;
        (this.material.uniforms.uWind!.value as THREE.Vector2).copy(wind);
        (this.material.uniforms.uColor!.value as THREE.Color).copy(color);
    }

    dispose() {
        this.points.geometry.dispose();
    }
}

/** 锦鲤：沿池中各自的椭圆慢慢游，头朝前进方向，身子左右摆一点。 */
export class ParkKoi {
    readonly mesh: THREE.InstancedMesh;
    private readonly fish: { radius: number; speed: number; phase: number; wobble: number }[];
    private readonly matrix = new THREE.Matrix4();
    private readonly quaternion = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3(1, 1, 1);
    private readonly position = new THREE.Vector3();
    private readonly up = new THREE.Vector3(0, 1, 0);

    constructor(materials: MachiMaterials, colors: string[]) {
        const body = new THREE.SphereGeometry(1, 12, 8).scale(0.07, 0.03, 0.2);
        const tail = new THREE.ConeGeometry(0.06, 0.12, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.24);
        tail.scale(1, 0.25, 1);
        const geometry = new THREE.BufferGeometry();
        const merged = [body, tail].map(part => part.toNonIndexed());
        const positions = merged.flatMap(part => Array.from(part.getAttribute('position').array as Float32Array));
        const normals = merged.flatMap(part => Array.from(part.getAttribute('normal').array as Float32Array));
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        [body, tail, ...merged].forEach(part => part.dispose());
        this.mesh = new THREE.InstancedMesh(geometry, materials.toon('white'), colors.length);
        this.mesh.name = 'Koi';
        this.mesh.castShadow = false;
        this.fish = colors.map((color, index) => {
            this.mesh.setColorAt(index, new THREE.Color(color));
            return { radius: 0.35 + 0.45 * ((index * 0.37) % 1), speed: (0.18 + 0.1 * ((index * 0.61) % 1)) * (index % 2 === 0 ? 1 : -1), phase: index * 1.7, wobble: index * 2.3 };
        });
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        this.update(0);
    }

    update(time: number) {
        this.fish.forEach((fish, index) => {
            const angle = time * fish.speed + fish.phase;
            const rx = POND.rx * 0.75 * fish.radius / 0.8;
            const rz = POND.rz * 0.75 * fish.radius / 0.8;
            this.position.set(POND.x + Math.cos(angle) * rx, LEVEL.water + 0.012, POND.z + Math.sin(angle) * rz);
            // 前进方向是椭圆的切线；身子随游动左右摆。
            const heading = Math.atan2(-Math.sin(angle) * rx * Math.sign(fish.speed), Math.cos(angle) * rz * Math.sign(fish.speed));
            this.quaternion.setFromAxisAngle(this.up, heading + Math.sin(time * 3 + fish.wobble) * 0.15);
            this.matrix.compose(this.position, this.quaternion, this.scale);
            this.mesh.setMatrixAt(index, this.matrix);
        });
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        this.mesh.geometry.dispose();
    }
}
