import * as THREE from 'three';
import { hashVisualizerSeed, visualizerHash01 } from '../../../visualizerSeedHash';
import { boxSpan, group, mesh } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { JET } from './layout';

// src/components/visualizer/machi/scenes/kowloon/jet.ts
// 启德的进场航线：一架客机隔一阵从右往左低低地掠过楼顶（微缩里放大了比例才看得出是飞机），尾翼是主题色的涂装。
// 机身一排亮着的舷窗，左红右绿的航行灯、一闪一闪的白色频闪与红色信标，翼根两盏着陆灯（夜里像两颗星一路扫过去）。
// 什么时候飞按氛围时钟与 seed 决定（纯函数），暂停时定格，静态模式下不飞。

/** 每 42 秒一个窗口，按哈希决定这个窗口里飞不飞、什么时候飞。 */
const WINDOW_SECONDS = 42;

/** 时刻 time 飞到航线的哪里（0..1），没在飞是 null。 */
export const resolveKowloonJet = (time: number, seed: string | number): number | null => {
    const index = Math.floor(time / WINDOW_SECONDS);
    const key = hashVisualizerSeed(`jet:${seed}`);
    if (visualizerHash01(key, index, 0x13) > 0.72) return null;
    const start = index * WINDOW_SECONDS + 4 + visualizerHash01(key, index, 0x29) * (WINDOW_SECONDS - JET.duration - 8);
    const progress = (time - start) / JET.duration;
    return progress >= 0 && progress <= 1 ? progress : null;
};

export class KowloonJet {
    readonly group: THREE.Group;
    private readonly from = new THREE.Vector3(...JET.from);
    private readonly to = new THREE.Vector3(...JET.to);
    private readonly geometries: THREE.BufferGeometry[] = [];

    constructor(private readonly materials: MachiMaterials) {
        const body = materials.toon('jetBody');
        const tail = materials.toon('jetTail');
        const engine = materials.toon('jetEngine');
        const parts: THREE.Object3D[] = [];
        const add = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string, setup: (object: THREE.Mesh) => void) => {
            this.geometries.push(geometry);
            const result = mesh(geometry, material, { name, castShadow: false, receiveShadow: false });
            setup(result);
            parts.push(result);
        };
        // 机身（沿 +x 是机头）、机鼻、往上收的机尾。
        add(new THREE.CylinderGeometry(0.3, 0.3, 3.6, 14), body, 'Fuselage', object => { object.rotation.z = Math.PI / 2; });
        add(new THREE.SphereGeometry(0.3, 14, 10), body, 'Nose', object => {
            object.scale.set(1.7, 1, 1);
            object.position.x = 1.8;
        });
        add(new THREE.CylinderGeometry(0.3, 0.07, 1.1, 14), body, 'TailCone', object => {
            object.rotation.z = Math.PI / 2;
            object.position.set(-2.33, 0.08, 0);
        });
        // 主翼：两片后掠的薄板；翼下两台发动机。
        [-1, 1].forEach(side => {
            add(new THREE.BoxGeometry(1.15, 0.05, 2.2), body, 'Wing', object => {
                object.position.set(-0.35, -0.12, side * 1.2);
                object.rotation.y = -side * 0.5;
            });
            add(new THREE.CylinderGeometry(0.15, 0.13, 0.7, 12), engine, 'Engine', object => {
                object.rotation.z = Math.PI / 2;
                object.position.set(0.1, -0.33, side * 0.95);
            });
            add(new THREE.BoxGeometry(0.5, 0.04, 0.85), body, 'Stabilizer', object => {
                object.position.set(-2.5, 0.14, side * 0.5);
                object.rotation.y = -side * 0.45;
            });
        });
        // 垂直尾翼：主题色涂装。
        add(new THREE.BoxGeometry(0.85, 1.0, 0.05), tail, 'Fin', object => {
            object.position.set(-2.45, 0.62, 0);
            object.rotation.z = -0.5;
        });
        // 舷窗：一条贴着机身两侧的发光带。
        parts.push(boxSpan(materials.glow('jetWindow'), -1.6, 1.4, 0.06, 0.11, -0.302, 0.302, { radius: 0, name: 'Windows', castShadow: false }));
        // 灯：翼尖左红右绿、翼尖与机尾的白频闪、机腹与机背的红信标、翼根的着陆灯。
        const light = (role: string, x: number, y: number, z: number, radius: number) => {
            add(new THREE.SphereGeometry(radius, 8, 6), materials.glow(role), `Light/${role}`, object => object.position.set(x, y, z));
        };
        const tip = (side: number) => new THREE.Vector3(-0.35 - Math.sin(0.5) * 1.1, -0.12, side * (1.2 + Math.cos(0.5) * 1.1));
        const left = tip(1);
        const right = tip(-1);
        light('jetRed', left.x, left.y, left.z, 0.06);
        light('jetGreen', right.x, right.y, right.z, 0.06);
        light('jetStrobe', left.x - 0.08, left.y, left.z, 0.05);
        light('jetStrobe', right.x - 0.08, right.y, right.z, 0.05);
        light('jetStrobe', -2.85, 0.3, 0, 0.05);
        light('jetBeacon', 0, -0.32, 0, 0.06);
        light('jetBeacon', -0.4, 0.32, 0, 0.06);
        light('jetLanding', 0.45, -0.16, 0.42, 0.08);
        light('jetLanding', 0.45, -0.16, -0.42, 0.08);
        this.group = group('Jet', ...parts);
        this.group.visible = false;
        this.group.scale.setScalar(0.85);
    }

    /** progress 是这一趟飞到哪（null 不在飞）；time 让灯闪；night 是夜里程度（着陆灯、舷窗夜里才显眼）。 */
    update(progress: number | null, time: number, night: number) {
        this.group.visible = progress !== null;
        if (progress === null) return;
        const position = this.from.clone().lerp(this.to, progress);
        this.group.position.copy(position);
        const direction = this.to.clone().sub(this.from).normalize();
        const yaw = Math.atan2(-direction.z, direction.x);
        const pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) + 0.05;
        this.group.rotation.set(0.04 * Math.sin(time * 0.7), yaw, pitch, 'YZX');
        const materials = this.materials;
        const strobe = (time * 1.1) % 1 < 0.08 ? 1 : 0.05;
        const beacon = ((time + 0.45) * 0.85) % 1 < 0.15 ? 1 : 0.15;
        materials.setGlowLevel('jetStrobe', strobe);
        materials.setGlowLevel('jetBeacon', beacon);
        materials.setGlowLevel('jetLanding', 0.4 + 0.6 * night);
        materials.setGlowLevel('jetWindow', 0.25 + 0.75 * night);
    }

    dispose() {
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
