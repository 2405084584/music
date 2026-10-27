import * as THREE from 'three';
import type { KonbiniMaterials } from '../konbiniMaterials';
import { createSoftEllipseTexture } from './konbiniTraffic';
import {
    KONBINI_ENTER_PATH,
    KONBINI_EXIT_PATH,
    KONBINI_STROLL_ROUTES,
    resolveKonbiniCustomers,
    resolveKonbiniStroll,
    samplePath,
    type KonbiniDoorEvent,
    type KonbiniPathPoint,
} from './konbiniSchedules';

// src/components/visualizer/konbini/actors/konbiniWalkers.ts
// 撑伞的小人：两个顾客位（进店、出店，跟着开门的时刻表）和一个沿路边走过的路人。小人是几块简单的形体
// （腿、外套、头、举伞的手、伞），走路时腿摆、身子轻轻起伏，进店后收着伞在货架前站着逛。俯视时主要看得到伞面，
// 一半是日本街头常见的透明塑料伞。都带底座边缘的裁切面，脚下一块软阴影。

const COATS = ['#2c3446', '#8a7a62', '#5a6070', '#45503a', '#7a3b3b', '#d8d2c4'];
const UMBRELLAS = ['clear', '#2f5f9e', '#c24b5a', '#2f3640', 'clear', '#e0a63a'];
const SKIN = '#e9c7a8';

class KonbiniFigure {
    readonly root = new THREE.Group();
    private readonly legs: THREE.Mesh[] = [];
    private readonly umbrella = new THREE.Group();
    private readonly coat: THREE.MeshToonMaterial;
    private readonly canopy: THREE.MeshToonMaterial;
    private look = -1;

    constructor(materials: KonbiniMaterials, clipping: THREE.Plane[], shared: { legs: THREE.Material; skin: THREE.Material; shadow: THREE.Material; geometries: Record<string, THREE.BufferGeometry> }) {
        const clip = <T extends THREE.Material>(material: T) => {
            material.clippingPlanes = clipping;
            return materials.track(material);
        };
        this.coat = clip(new THREE.MeshToonMaterial({ color: COATS[0], gradientMap: materials.gradient }));
        this.canopy = clip(new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: materials.gradient, side: THREE.DoubleSide }));
        const g = shared.geometries;
        const add = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            parent.add(mesh);
            return mesh;
        };
        // 腿：绕胯部摆动，几何的原点在腿的上端。
        [-0.075, 0.075].forEach(x => this.legs.push(add(g.leg!, shared.legs, this.root, x, 0.8, 0)));
        add(g.body!, this.coat, this.root, 0, 1.12, 0);
        add(g.head!, shared.skin, this.root, 0, 1.56, 0);
        add(g.arm!, this.coat, this.root, 0.16, 1.28, 0.1).rotation.x = -0.6;
        // 伞：伞杆从手里伸上去，伞面在头顶。
        add(g.shaft!, shared.legs, this.umbrella, 0, 0.42, 0);
        add(g.canopy!, this.canopy, this.umbrella, 0, 0.78, 0);
        this.umbrella.position.set(0.16, 1.24, 0.2);
        this.root.add(this.umbrella);
        const shadow = add(g.shadow!, shared.shadow, this.root, 0, 0.006, 0);
        shadow.renderOrder = 1;
        this.root.visible = false;
    }

    /** 换一身行头（外套、伞的颜色；透明伞半透明）。 */
    dress(look: number) {
        if (look === this.look) return;
        this.look = look;
        this.coat.color.set(COATS[look % COATS.length]!);
        const umbrella = UMBRELLAS[(look * 7 + 3) % UMBRELLAS.length]!;
        const clear = umbrella === 'clear';
        this.canopy.color.set(clear ? '#eef4f8' : umbrella);
        this.canopy.transparent = clear;
        this.canopy.opacity = clear ? 0.42 : 1;
        this.canopy.depthWrite = !clear;
        this.canopy.needsUpdate = true;
    }

    /** 摆到路径上的某处：走路时腿摆、身子起伏；站着逛时收伞、轻轻晃。 */
    pose(x: number, y: number, z: number, heading: number, walking: boolean, phase: number, umbrellaOpen: boolean) {
        this.root.visible = true;
        this.root.position.set(x, y + (walking ? Math.abs(Math.sin(phase)) * 0.03 : 0), z);
        this.root.rotation.y = heading;
        const swing = walking ? Math.sin(phase) * 0.45 : 0;
        this.legs[0]!.rotation.x = swing;
        this.legs[1]!.rotation.x = -swing;
        this.umbrella.visible = umbrellaOpen;
        this.umbrella.rotation.z = walking ? Math.sin(phase * 0.5) * 0.04 : 0;
        if (!walking) this.root.rotation.y = heading + Math.sin(phase * 0.15) * 0.25;
    }

    hide() {
        this.root.visible = false;
    }
}

export interface KonbiniWalkersFrame {
    songTime: number;
    ambientTime: number;
    doorEvents: readonly KonbiniDoorEvent[];
    seed: string | number;
}

export class KonbiniWalkers {
    readonly group = new THREE.Group();
    private readonly figures: KonbiniFigure[];
    private readonly geometries: THREE.BufferGeometry[];
    private readonly shadowTexture = createSoftEllipseTexture();

    constructor(materials: KonbiniMaterials, clipping: THREE.Plane[]) {
        this.group.name = 'Walkers';
        const geometries: Record<string, THREE.BufferGeometry> = {
            leg: new THREE.CapsuleGeometry(0.055, 0.6, 3, 6).translate(0, -0.33, 0),
            body: new THREE.CapsuleGeometry(0.17, 0.42, 4, 10).scale(1, 1, 0.78),
            head: new THREE.SphereGeometry(0.115, 12, 10),
            arm: new THREE.CapsuleGeometry(0.045, 0.32, 3, 6),
            shaft: new THREE.CylinderGeometry(0.012, 0.012, 0.86, 5),
            canopy: new THREE.ConeGeometry(0.56, 0.26, 12, 1, true),
            shadow: new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
        };
        this.geometries = Object.values(geometries);
        const clip = <T extends THREE.Material>(material: T) => {
            material.clippingPlanes = clipping;
            return materials.track(material);
        };
        const shared = {
            legs: clip(new THREE.MeshToonMaterial({ color: '#1d2028', gradientMap: materials.gradient })),
            skin: clip(new THREE.MeshToonMaterial({ color: SKIN, gradientMap: materials.gradient })),
            shadow: clip(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: this.shadowTexture, transparent: true, opacity: 0.5, depthWrite: false })),
            geometries,
        };
        this.figures = [0, 1, 2].map(() => new KonbiniFigure(materials, clipping, shared));
        this.figures.forEach(figure => this.group.add(figure.root));
    }

    update(frame: KonbiniWalkersFrame) {
        const [enter, exit] = resolveKonbiniCustomers(frame.doorEvents, frame.songTime);
        const place = (figure: KonbiniFigure, path: readonly KonbiniPathPoint[], distance: number, look: number, browsing: boolean, time: number) => {
            const sample = samplePath(path, distance);
            figure.dress(look);
            // 走进店门（门槛之后）收伞。
            const inside = sample.y > 0.14 && sample.z < 0.45;
            figure.pose(sample.x, sample.y, sample.z, sample.heading, !browsing, (browsing ? time : distance) * 5.6, !inside);
        };
        if (enter) place(this.figures[0]!, KONBINI_ENTER_PATH, enter.distance, enter.look, enter.browsing, frame.songTime);
        else this.figures[0]!.hide();
        if (exit) place(this.figures[1]!, KONBINI_EXIT_PATH, exit.distance, exit.look, false, frame.songTime);
        else this.figures[1]!.hide();
        const stroll = resolveKonbiniStroll(frame.ambientTime, frame.seed);
        if (stroll) {
            const route = KONBINI_STROLL_ROUTES[stroll.route]!;
            place(this.figures[2]!, stroll.reverse ? [...route].reverse() : route, stroll.distance, stroll.look + 2, false, frame.ambientTime);
        } else this.figures[2]!.hide();
    }

    dispose() {
        this.geometries.forEach(geometry => geometry.dispose());
        this.shadowTexture.dispose();
    }
}
