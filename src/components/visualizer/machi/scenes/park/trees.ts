import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import { group, mesh } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { LEVEL, TREES } from './layout';

// src/components/visualizer/machi/scenes/park/trees.ts
// 樱花树：一根略弯、上细下粗的树干，顶上分出几根斜伸的枝；树冠是一整块平滑的“云团”——枝头与一圈伞形的花团
// 当成元球（MarchingCubes 在建场景时算一次等值面），并顶点后按噪声沿法线推出细碎的扇贝边，顶点色做出一簇簇深浅
// 不一的花（亮粉、深粉、近白的花尖），底面略深。一整块曲面没有球与球之间的折痕，描边只落在轮廓上。
// 树下和草地上散着落下的花瓣（一个 InstancedMesh）。都按 seed 抖一点，每首歌的树形略有不同。

/** 元球的等值面参数：subtract 越大，球之间融合得越少。 */
const CROWN_ISOLATION = 80;
const CROWN_SUBTRACT = 26;
const CROWN_RESOLUTION = 44;

/** 两点之间一段上下粗细不同的圆柱（树干、树枝）。 */
const taperedBetween = (material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, name: string) => {
    const length = from.distanceTo(to);
    const geometry = new THREE.CylinderGeometry(r1, r0, length, 9, 1);
    const result = mesh(geometry, material, { name });
    result.position.copy(from).add(to).multiplyScalar(0.5);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    return result;
};

/** 三维值噪声（0..1），树冠的起伏与花簇的深浅都用它。 */
const hash3 = (x: number, y: number, z: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return h - Math.floor(h);
};
const noise3 = (x: number, y: number, z: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const corner = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
    return lerp(
        lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), ux), lerp(corner(0, 1, 0), corner(1, 1, 0), ux), uy),
        lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), ux), lerp(corner(0, 1, 1), corner(1, 1, 1), ux), uy),
        uz,
    );
};

/** 花簇的颜色倍数（乘在材质的粉色上）：亮粉、深粉、近白的花尖。 */
const BLOOM_LIGHT = new THREE.Color(1.08, 1.12, 1.1);
const BLOOM_DEEP = new THREE.Color(0.95, 0.74, 0.84);
const BLOOM_TIP = new THREE.Color(1.1, 1.2, 1.16);

/**
 * 一棵树的树冠：一组花团当元球，求一次等值面，得到一整块平滑曲面；并顶点后按噪声沿法线起伏（扇贝似的边），
 * 再按噪声上顶点色。
 */
const buildCrownGeometry = (blobs: { at: THREE.Vector3; radius: number }[], scale: number, seed: number) => {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    blobs.forEach(blob => {
        min.min(blob.at.clone().subScalar(blob.radius * 1.6));
        max.max(blob.at.clone().addScalar(blob.radius * 1.6));
    });
    const center = min.clone().add(max).multiplyScalar(0.5);
    const half = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2 * 1.08;
    const scratch = new THREE.MeshBasicMaterial();
    const cubes = new MarchingCubes(CROWN_RESOLUTION, scratch, false, false, 60000);
    cubes.isolation = CROWN_ISOLATION;
    cubes.reset();
    blobs.forEach(blob => {
        const p = blob.at.clone().sub(center).divideScalar(2 * half).addScalar(0.5);
        const r = blob.radius / (2 * half);
        cubes.addBall(p.x, p.y, p.z, (CROWN_ISOLATION + CROWN_SUBTRACT) * r * r, CROWN_SUBTRACT);
    });
    cubes.update();
    const count = cubes.count;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count * 3; index += 3) {
        positions[index] = center.x + cubes.positionArray[index]! * half;
        positions[index + 1] = center.y + cubes.positionArray[index + 1]! * half;
        positions[index + 2] = center.z + cubes.positionArray[index + 2]! * half;
    }
    cubes.geometry.dispose();
    scratch.dispose();
    const soup = new THREE.BufferGeometry();
    soup.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const geometry = mergeVertices(soup, 1e-4);
    soup.dispose();
    geometry.computeVertexNormals();
    // 沿法线按噪声起伏：低频的鼓包加高频的扇贝边。
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    const n = new THREE.Vector3();
    const offset = seed % 97;
    for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index);
        n.fromBufferAttribute(normal, index);
        const bump = noise3(point.x * 1.4 + offset, point.y * 1.4, point.z * 1.4) - 0.5;
        const scallop = noise3(point.x * 5.2, point.y * 5.2 + offset, point.z * 5.2) - 0.5;
        // 起伏要缓：太碎的小褶子会被描边 pass 当成折痕，画出一片排线。
        point.addScaledVector(n, (bump * 0.16 + scallop * 0.035) * scale);
        position.setXYZ(index, point.x, point.y, point.z);
    }
    geometry.computeVertexNormals();
    // 顶点色：一簇簇深浅（低频）、零星的近白花尖（高频）、底面压深一点。
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index);
        n.fromBufferAttribute(normal, index);
        const cluster = noise3(point.x * 2.1, point.y * 2.1 + offset, point.z * 2.1);
        color.copy(BLOOM_DEEP).lerp(BLOOM_LIGHT, THREE.MathUtils.smoothstep(cluster, 0.32, 0.68));
        const tip = noise3(point.x * 8.3 + offset, point.y * 8.3, point.z * 8.3);
        color.lerp(BLOOM_TIP, THREE.MathUtils.smoothstep(tip, 0.68, 0.82) * 0.8);
        if (n.y < 0) color.multiplyScalar(1 + n.y * 0.14);
        colors.set([color.r, color.g, color.b], index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
    // 树冠只有这一种材质：粉色，顶点色乘出深浅（只有树冠用它，可以开顶点色）。
    const blossom = materials.toon('blossom');
    blossom.vertexColors = true;
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
        // 花团：每个枝头两三团，再在树冠中心周围铺一圈伞形的（宽、扁，外沿略往下垂），连成一整块树冠。
        const blobs: { at: THREE.Vector3; radius: number }[] = [];
        tips.forEach(tip => {
            const count = 2 + Math.floor(random() * 2);
            for (let index = 0; index < count; index += 1) {
                const offset = new THREE.Vector3(random() - 0.5, (random() - 0.35) * 0.5, random() - 0.5).multiplyScalar(0.6 * s);
                blobs.push({ at: tip.clone().add(offset), radius: (0.42 + random() * 0.22) * s });
            }
        });
        const crownCenter = fork.clone().add(new THREE.Vector3(0, 1.3 * s, 0));
        const shell = 22 + Math.floor(random() * 6);
        for (let index = 0; index < shell; index += 1) {
            const angle = (index / shell) * Math.PI * 2 * 1.618 + random() * 0.5;
            const rise = random();
            const reach = (0.75 + 0.6 * (1 - rise) + random() * 0.2) * s;
            const droop = (1 - rise) * 0.3 * s;
            blobs.push({
                at: crownCenter.clone().add(new THREE.Vector3(Math.cos(angle) * reach, (rise * 0.85 - 0.2) * s - droop, Math.sin(angle) * reach)),
                radius: (0.3 + random() * 0.17) * s,
            });
        }
        blobs.push({ at: crownCenter.clone().add(new THREE.Vector3(0, 0.45 * s, 0)), radius: 0.62 * s });
        blobs.push({ at: crownCenter.clone(), radius: 0.7 * s });
        const crown = mesh(buildCrownGeometry(blobs, s, treeIndex * 13 + Math.floor(random() * 50)), blossom, { name: 'Blossom' });
        parts.push(crown);
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
