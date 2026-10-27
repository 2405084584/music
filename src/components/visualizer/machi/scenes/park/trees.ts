import * as THREE from 'three';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import { group, mesh } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { LEVEL, TREES } from './layout';

// src/components/visualizer/machi/scenes/park/trees.ts
// 樱花树：一根略弯、上细下粗的树干，顶上分出几根斜伸的枝，枝头一团团花（压扁一点、表面抖动过的二十面体球，
// 三种粉色混着），树下和草地上散着落下的花瓣（一个 InstancedMesh）。都按 seed 抖一点，每首歌的树形略有不同。

const BLOSSOM_ROLES = ['blossom', 'blossomLight', 'blossomDeep'] as const;

/** 两点之间一段上下粗细不同的圆柱（树干、树枝）。 */
const taperedBetween = (material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, name: string) => {
    const length = from.distanceTo(to);
    const geometry = new THREE.CylinderGeometry(r1, r0, length, 9, 1);
    const result = mesh(geometry, material, { name });
    result.position.copy(from).add(to).multiplyScalar(0.5);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    return result;
};

/** 一团花：二十面体球，顶点按噪声往外推一点，像一团蓬松的花。 */
const blossomGeometry = (radius: number, random: () => number) => {
    const geometry = new THREE.IcosahedronGeometry(radius, 2);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    const seeds = [random() * 10, random() * 10, random() * 10];
    for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index);
        const n = Math.sin(point.x * 3.1 + seeds[0]!) * Math.sin(point.y * 2.7 + seeds[1]!) * Math.sin(point.z * 3.4 + seeds[2]!);
        point.multiplyScalar(1 + 0.16 * n);
        point.y *= 0.82;
        position.setXYZ(index, point.x, point.y, point.z);
    }
    geometry.computeVertexNormals();
    return geometry;
};

export interface SakuraParts {
    group: THREE.Group;
    /** 树冠的大致中心与半径（花瓣从这里飘下来）。 */
    crowns: { center: THREE.Vector3; radius: number }[];
}

export const buildSakuraTrees = (materials: MachiMaterials, seed: string | number): SakuraParts => {
    const random = createVisualizerRng(`sakura:${seed}`);
    const bark = materials.toon('bark');
    const trees: THREE.Object3D[] = [];
    const crowns: SakuraParts['crowns'] = [];
    TREES.forEach((tree, treeIndex) => {
        const s = tree.scale * (0.92 + 0.16 * random());
        const parts: THREE.Object3D[] = [];
        const lean = new THREE.Vector3((random() - 0.5) * 0.5, 0, (random() - 0.5) * 0.5).multiplyScalar(s);
        const base = new THREE.Vector3(tree.x, LEVEL.grass, tree.z);
        const fork = base.clone().add(new THREE.Vector3(lean.x, 1.75 * s, lean.z));
        parts.push(taperedBetween(bark, base, fork, 0.2 * s, 0.13 * s, 'Trunk'));
        // 根部一圈略粗。
        parts.push(taperedBetween(bark, base, base.clone().setY(LEVEL.grass + 0.35 * s), 0.3 * s, 0.2 * s, 'Root'));
        const branchCount = 4 + Math.floor(random() * 2);
        const spin = random() * Math.PI * 2;
        const tips: THREE.Vector3[] = [];
        for (let index = 0; index < branchCount; index += 1) {
            const angle = spin + (index / branchCount) * Math.PI * 2 + (random() - 0.5) * 0.5;
            const reach = (0.95 + random() * 0.6) * s;
            const tip = fork.clone().add(new THREE.Vector3(Math.cos(angle) * reach, (0.75 + random() * 0.75) * s, Math.sin(angle) * reach));
            parts.push(taperedBetween(bark, fork, tip, 0.11 * s, 0.045 * s, 'Branch'));
            tips.push(tip);
        }
        const top = fork.clone().add(new THREE.Vector3(0, 1.7 * s, 0));
        parts.push(taperedBetween(bark, fork, top, 0.1 * s, 0.04 * s, 'Leader'));
        tips.push(top);
        // 枝头的花团：每个枝头两三团，再在中间补几团把树冠连起来。
        const blobs: { at: THREE.Vector3; radius: number }[] = [];
        tips.forEach(tip => {
            const count = 2 + Math.floor(random() * 2);
            for (let index = 0; index < count; index += 1) {
                const offset = new THREE.Vector3(random() - 0.5, (random() - 0.3) * 0.6, random() - 0.5).multiplyScalar(0.7 * s);
                blobs.push({ at: tip.clone().add(offset), radius: (0.48 + random() * 0.32) * s });
            }
        });
        for (let index = 0; index < 3; index += 1) {
            const angle = random() * Math.PI * 2;
            blobs.push({ at: fork.clone().add(new THREE.Vector3(Math.cos(angle) * 0.5 * s, (1.4 + random() * 0.5) * s, Math.sin(angle) * 0.5 * s)), radius: (0.6 + random() * 0.25) * s });
        }
        blobs.forEach((blob, index) => {
            const role = BLOSSOM_ROLES[(index + treeIndex + Math.floor(random() * 3)) % BLOSSOM_ROLES.length]!;
            const ball = mesh(blossomGeometry(blob.radius, random), materials.toon(role), { name: 'Blossom' });
            ball.position.copy(blob.at);
            ball.rotation.y = random() * Math.PI;
            parts.push(ball);
        });
        const center = blobs.reduce((sum, blob) => sum.add(blob.at), new THREE.Vector3()).multiplyScalar(1 / blobs.length);
        crowns.push({ center, radius: 1.5 * s });
        trees.push(group(`Sakura${treeIndex}`, ...parts));
    });

    // 地上的落花：树下密、草地上稀。
    const petals: { x: number; z: number; angle: number }[] = [];
    crowns.forEach(crown => {
        for (let index = 0; index < 46; index += 1) {
            const angle = random() * Math.PI * 2;
            const distance = Math.sqrt(random()) * crown.radius * 1.2;
            petals.push({ x: crown.center.x + Math.cos(angle) * distance, z: crown.center.z + Math.sin(angle) * distance, angle: random() * Math.PI });
        }
    });
    for (let index = 0; index < 160; index += 1) {
        petals.push({ x: (random() * 2 - 1) * 5.7, z: (random() * 2 - 1) * 5.7, angle: random() * Math.PI });
    }
    const inside = petals.filter(petal => Math.abs(petal.x) < 5.85 && Math.abs(petal.z) < 5.85);
    const petalGeometry = new THREE.CircleGeometry(0.045, 5).rotateX(-Math.PI / 2);
    petalGeometry.scale(1, 1, 0.6);
    const petalMesh = new THREE.InstancedMesh(petalGeometry, materials.toon('blossomLight'), inside.length);
    petalMesh.name = 'FallenPetals';
    petalMesh.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    inside.forEach((petal, index) => {
        matrix.makeRotationY(petal.angle);
        matrix.setPosition(petal.x, LEVEL.path + 0.004, petal.z);
        petalMesh.setMatrixAt(index, matrix);
    });
    return { group: group('Trees', ...trees, petalMesh), crowns };
};
