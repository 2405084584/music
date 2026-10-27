import * as THREE from 'three';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import { buildMachiPlinth, MACHI_BASE, machiSurface } from '../../engine/geometry/plinth';
import { boxAt, boxSpan, cylinderAt, group, mesh, roundedBox, tubeBetween } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { BENCHES, BRIDGE, CLOCK, LAMPS, LANTERN_LINE, LEVEL, PATHS, POND, STAGE, TREES, VENDING } from './layout';

// src/components/visualizer/machi/scenes/park/grounds.ts
// 樱花公园的地面与固定的东西：底座上一层草地、石子路（湿地面材质装在路面薄板上）、池塘（一直湿着的水面、一圈石头）
// 与红色拱桥、樱花祭的小舞台（红白幕、太鼓、两根挂横幅的高杆、照横幅的两盏灯）、提灯串的杆子、矮栅栏、长椅、园灯、
// 自动贩卖机、公园时钟（指针按本地时间走）。招牌、提灯另挂，这里返回它们的位置。

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface ParkGroundParts {
    group: THREE.Group;
    paths: THREE.Mesh[];
    water: THREE.Mesh;
    banner: { position: THREE.Vector3; rotationY: number; width: number; height: number };
    /** 舞台杆顶（提灯串从这里拉到后面两棵树）。 */
    poleTops: THREE.Vector3[];
    floods: { head: THREE.Vector3; target: THREE.Vector3 }[];
    lamps: THREE.Vector3[];
    clock: { hour: THREE.Object3D; minute: THREE.Object3D; face: THREE.Vector3 };
    vending: THREE.Vector3;
}

/** 舞台组的本地坐标 → 世界坐标（整组绕 y 转 STAGE.rotationY）。 */
const stageWorld = (x: number, y: number, z: number) => v(x, y, z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), STAGE.rotationY)
    .add(v(STAGE.x, 0, STAGE.z));

const buildStage = (materials: MachiMaterials) => {
    const S = STAGE;
    const root = new THREE.Group();
    root.name = 'Stage';
    const top = LEVEL.stage;
    // 台子：木台面，四周一圈红白相间的幕（竖条）。
    root.add(boxSpan(materials.toon('wood'), -S.width / 2, S.width / 2, top - 0.08, top, -S.depth / 2, S.depth / 2, { radius: 0.03, name: 'Stage/deck' }));
    const stripes = 14;
    for (let index = 0; index < stripes; index += 1) {
        const x0 = -S.width / 2 + (index / stripes) * S.width;
        const x1 = x0 + S.width / stripes;
        root.add(boxSpan(materials.toon(index % 2 === 0 ? 'stageRed' : 'stageWhite'), x0, x1, LEVEL.grass, top - 0.08, S.depth / 2 - 0.02, S.depth / 2 + 0.02, { radius: 0.005, name: 'Stage/kohaku' }));
    }
    root.add(boxSpan(materials.toon('stageWhite'), -S.width / 2 + 0.02, S.width / 2 - 0.02, LEVEL.grass, top - 0.08, -S.depth / 2 + 0.02, S.depth / 2 - 0.04, { radius: 0.02, name: 'Stage/body' }));
    // 前面两级台阶。
    [0, 1].forEach(step => {
        root.add(boxSpan(materials.toon('wood'), -0.5, 0.5, LEVEL.grass, LEVEL.grass + (top - LEVEL.grass) * (step + 1) / 3, S.depth / 2 + 0.02 + (1 - step) * 0.22, S.depth / 2 + 0.24 + (1 - step) * 0.22, { radius: 0.02, name: 'Stage/step' }));
    });
    // 太鼓：架子上一面大鼓。
    const drum = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.42, 20).rotateZ(Math.PI / 2), materials.toon('wood'), { name: 'Taiko/body' });
    drum.position.set(0.9, top + 0.52, -0.1);
    root.add(drum);
    [-1, 1].forEach(side => {
        const head = mesh(new THREE.CircleGeometry(0.3, 20), materials.toon('stageWhite'), { name: 'Taiko/head' });
        head.position.set(0.9 + side * 0.212, top + 0.52, -0.1);
        head.rotation.y = side * Math.PI / 2;
        root.add(head);
        root.add(tubeBetween(materials.toon('woodDark'), v(0.9 + side * 0.18, top, -0.1), v(0.9 + side * 0.1, top + 0.3, -0.1), 0.03, { name: 'Taiko/stand' }));
    });
    // 挂横幅的两根高杆（台子后沿两外侧），杆顶一面小旗。
    const poleTops: THREE.Vector3[] = [];
    [-1, 1].forEach(side => {
        const x = side * S.poleSpan / 2;
        root.add(cylinderAt(materials.toon('woodDark'), 0.09, S.poleHeight, [x, LEVEL.grass, -S.depth / 2 - S.poleBack], { radiusTop: 0.07, segments: 10, name: 'Stage/pole' }));
        root.add(boxAt(materials.toon('stageRed'), [0.42, 0.3, 0.02], [x + side * 0.22, S.poleHeight - 0.45, -S.depth / 2 - S.poleBack], { radius: 0.005, name: 'Stage/pennant' }));
        poleTops.push(stageWorld(x, S.poleHeight - 0.1, -S.depth / 2 - S.poleBack));
    });
    // 横幅上下的绳。
    const bannerZ = -S.depth / 2 - S.poleBack + 0.02;
    root.add(tubeBetween(materials.toon('woodDark'), v(-S.poleSpan / 2, S.bannerTop + 0.03, bannerZ), v(S.poleSpan / 2, S.bannerTop + 0.03, bannerZ), 0.015, { name: 'Stage/rope', castShadow: false }));
    // 照横幅的两盏灯：杆子半腰伸出来，朝着横幅。
    const floods: { head: THREE.Vector3; target: THREE.Vector3 }[] = [];
    [-1, 1].forEach(side => {
        const x = side * (S.poleSpan / 2 - 0.05);
        const head = v(x - side * 0.25, S.bannerTop - S.bannerHeight - 0.35, bannerZ + 0.9);
        root.add(tubeBetween(materials.toon('darkMetal'), v(x, head.y - 0.05, bannerZ), head, 0.025, { name: 'Flood/arm' }));
        const lamp = boxAt(materials.toon('darkMetal'), [0.22, 0.16, 0.18], [head.x, head.y - 0.08, head.z], { radius: 0.03, name: 'Flood/head' });
        root.add(lamp);
        const lens = mesh(new THREE.CircleGeometry(0.07, 12), materials.glow('floodHead'), { name: 'Flood/lens', castShadow: false, receiveShadow: false });
        lens.position.set(head.x, head.y, head.z - 0.095);
        lens.rotation.y = Math.PI;
        root.add(lens);
        floods.push({ head: stageWorld(head.x, head.y, head.z), target: stageWorld(-side * 0.6, S.bannerTop - S.bannerHeight / 2, bannerZ) });
    });
    root.position.set(S.x, 0, S.z);
    root.rotation.y = S.rotationY;
    const banner = {
        position: stageWorld(0, S.bannerTop - S.bannerHeight / 2, bannerZ),
        rotationY: S.rotationY,
        width: S.bannerWidth,
        height: S.bannerHeight,
    };
    return { group: root, poleTops, floods, banner };
};

/** 池塘：一直湿着的水面（椭圆）、一圈石头、一座红色拱桥。 */
const buildPond = (materials: MachiMaterials, random: () => number) => {
    const P = POND;
    const water = mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2).scale(P.rx, 1, P.rz), materials.toon('concrete'), { name: 'Pond/water', castShadow: false, dynamic: true });
    water.position.set(P.x, LEVEL.water, P.z);
    const parts: THREE.Object3D[] = [];
    const rock = materials.toon('rock');
    const rockDark = materials.toon('rockDark');
    const count = 34;
    for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2 + random() * 0.08;
        const size = 0.16 + random() * 0.16;
        const stone = mesh(new THREE.DodecahedronGeometry(size, 0).scale(1, 0.55, 1), index % 3 === 0 ? rockDark : rock, { name: 'Pond/rock' });
        stone.position.set(P.x + Math.cos(angle) * (P.rx + 0.05), LEVEL.grass + size * 0.2, P.z + Math.sin(angle) * (P.rz + 0.05));
        stone.rotation.set(random(), random() * Math.PI, random());
        parts.push(stone);
    }
    // 拱桥：沿 x 的一道弧，几段板拼成，两边红栏杆。
    const B = BRIDGE;
    const red = materials.toon('bridgeRed');
    const plank = materials.toon('wood');
    const segments = 9;
    const arc = (t: number) => LEVEL.grass + 0.08 + Math.sin(t * Math.PI) * B.rise;
    for (let index = 0; index < segments; index += 1) {
        const t0 = index / segments;
        const t1 = (index + 1) / segments;
        const a = v(B.x0 + (B.x1 - B.x0) * t0, arc(t0), B.z);
        const b = v(B.x0 + (B.x1 - B.x0) * t1, arc(t1), B.z);
        const length = a.distanceTo(b) + 0.02;
        const deck = mesh(roundedBox(length, 0.06, B.width, 0.01), plank, { name: 'Bridge/deck' });
        deck.position.copy(a).add(b).multiplyScalar(0.5);
        deck.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
        parts.push(deck);
    }
    [-1, 1].forEach(side => {
        const z = B.z + side * (B.width / 2 - 0.03);
        const rail: THREE.Vector3[] = [];
        for (let index = 0; index <= segments; index += 1) {
            const t = index / segments;
            const post = v(B.x0 + (B.x1 - B.x0) * t, arc(t), z);
            if (index % 3 === 0) parts.push(tubeBetween(red, post, post.clone().setY(post.y + 0.4), 0.03, { name: 'Bridge/post' }));
            rail.push(post.clone().setY(post.y + 0.38));
        }
        for (let index = 0; index < rail.length - 1; index += 1) parts.push(tubeBetween(red, rail[index]!, rail[index + 1]!, 0.025, { name: 'Bridge/rail' }));
        // 栏杆头上的宝珠（擬宝珠）。
        [rail[0]!, rail[rail.length - 1]!].forEach(cap => {
            const knob = mesh(new THREE.SphereGeometry(0.05, 10, 8), materials.toon('caution'), { name: 'Bridge/giboshi' });
            knob.position.copy(cap).setY(cap.y + 0.06);
            parts.push(knob);
        });
    });
    // 桥下的两根桥脚。
    [B.x0 + 0.5, B.x1 - 0.5].forEach(x => {
        parts.push(boxSpan(red, x - 0.05, x + 0.05, LEVEL.water - 0.02, arc((x - B.x0) / (B.x1 - B.x0)), B.z - B.width / 2 + 0.05, B.z + B.width / 2 - 0.05, { radius: 0.01, name: 'Bridge/pier' }));
    });
    return { group: group('Pond', ...parts), water };
};

const buildFence = (materials: MachiMaterials) => {
    const h = MACHI_BASE.half - 0.12;
    const posts: THREE.Vector3[] = [];
    for (let x = -h; x <= h + 1e-6; x += 0.8) posts.push(v(x, LEVEL.grass, -h));
    for (let z = -h + 0.8; z <= h - 0.5; z += 0.8) {
        posts.push(v(-h, LEVEL.grass, z));
        posts.push(v(h, LEVEL.grass, z));
    }
    const postGeometry = roundedBox(0.07, 0.55, 0.07, 0.015);
    const instanced = new THREE.InstancedMesh(postGeometry, materials.toon('fence'), posts.length);
    instanced.name = 'Fence/posts';
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    posts.forEach((post, index) => {
        matrix.makeTranslation(post.x, post.y + 0.275, post.z);
        instanced.setMatrixAt(index, matrix);
    });
    const rail = materials.toon('fence');
    const rails: THREE.Object3D[] = [];
    [0.2, 0.45].forEach(y => {
        rails.push(boxSpan(rail, -h, h, LEVEL.grass + y, LEVEL.grass + y + 0.04, -h - 0.02, -h + 0.02, { radius: 0.005, name: 'Fence/rail' }));
        rails.push(boxSpan(rail, -h - 0.02, -h + 0.02, LEVEL.grass + y, LEVEL.grass + y + 0.04, -h, h - 0.5, { radius: 0.005, name: 'Fence/rail' }));
        rails.push(boxSpan(rail, h - 0.02, h + 0.02, LEVEL.grass + y, LEVEL.grass + y + 0.04, -h, h - 0.5, { radius: 0.005, name: 'Fence/rail' }));
    });
    return group('Fence', instanced, ...rails);
};

const buildBench = (materials: MachiMaterials, x: number, z: number, rotationY: number) => {
    const wood = materials.toon('wood');
    const metal = materials.toon('darkMetal');
    const root = new THREE.Group();
    root.name = 'Bench';
    [-0.55, 0.55].forEach(dx => {
        root.add(boxAt(metal, [0.05, 0.42, 0.42], [dx, LEVEL.grass, 0], { radius: 0.01, name: 'Bench/leg' }));
        root.add(boxAt(metal, [0.05, 0.45, 0.05], [dx, LEVEL.grass + 0.42, -0.18], { radius: 0.01, name: 'Bench/back' }));
    });
    [-0.12, 0.0, 0.12].forEach(dz => root.add(boxAt(wood, [1.3, 0.04, 0.1], [0, LEVEL.grass + 0.42, dz], { radius: 0.01, name: 'Bench/slat' })));
    [0.62, 0.78].forEach(y => root.add(boxAt(wood, [1.3, 0.09, 0.03], [0, LEVEL.grass + y, -0.2], { radius: 0.01, name: 'Bench/backSlat' })));
    root.position.set(x, 0, z);
    root.rotation.y = rotationY;
    return root;
};

/** 园灯：细杆、顶上一盏乳白灯罩。返回灯罩中心。 */
const buildLamp = (materials: MachiMaterials, x: number, z: number) => {
    const height = 2.9;
    const parts: THREE.Object3D[] = [
        cylinderAt(materials.toon('darkMetal'), 0.06, height, [x, LEVEL.grass, z], { radiusTop: 0.045, segments: 10, name: 'Lamp/pole' }),
        cylinderAt(materials.toon('darkMetal'), 0.11, 0.25, [x, LEVEL.grass, z], { segments: 10, name: 'Lamp/foot' }),
        cylinderAt(materials.toon('darkMetal'), 0.16, 0.06, [x, LEVEL.grass + height + 0.32, z], { radiusTop: 0.05, segments: 12, name: 'Lamp/cap' }),
    ];
    const globe = mesh(new THREE.SphereGeometry(0.17, 14, 10), materials.glow('lampGlobe'), { name: 'Lamp/globe', castShadow: false, receiveShadow: false });
    globe.position.set(x, LEVEL.grass + height + 0.16, z);
    parts.push(globe);
    return { group: group('Lamp', ...parts), head: globe.position.clone() };
};

/** 公园时钟：方柱上一个圆钟面，两根指针按本地时间转（场景每帧设 rotation.z）。 */
const buildClock = (materials: MachiMaterials) => {
    const C = CLOCK;
    const root = new THREE.Group();
    root.name = 'Clock';
    root.add(boxAt(materials.toon('fence'), [0.14, C.height, 0.14], [0, LEVEL.grass, 0], { radius: 0.02, name: 'Clock/post' }));
    root.add(cylinderAt(materials.toon('darkMetal'), 0.33, 0.12, [0, 0, 0], { segments: 24, name: 'Clock/rim' }).rotateX(Math.PI / 2));
    const rim = root.children[root.children.length - 1]!;
    rim.position.set(0, LEVEL.grass + C.height + 0.2, 0.02);
    const face = mesh(new THREE.CircleGeometry(0.29, 24), materials.glow('clockFace'), { name: 'Clock/face', castShadow: false, receiveShadow: false });
    face.position.set(0, LEVEL.grass + C.height + 0.2, 0.085);
    root.add(face);
    const hand = (length: number, width: number, name: string) => {
        const pivot = new THREE.Group();
        pivot.name = name;
        pivot.userData.dynamic = true;
        pivot.add(boxAt(materials.toon('rubber'), [width, length, 0.012], [0, 0, 0], { radius: 0.004, name: `${name}/blade`, castShadow: false }));
        pivot.position.set(0, LEVEL.grass + C.height + 0.2, 0.095);
        root.add(pivot);
        return pivot;
    };
    const hour = hand(0.17, 0.035, 'Clock/hour');
    const minute = hand(0.25, 0.022, 'Clock/minute');
    root.position.set(C.x, 0, C.z);
    root.rotation.y = 0.6;
    return { group: root, hour, minute, face: face.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6).add(v(C.x, 0, C.z)) };
};

/** 自动贩卖机（简化版：机身、亮着的陈列窗、取物口）。返回陈列窗中心。 */
const buildVending = (materials: MachiMaterials) => {
    const V = VENDING;
    const parts: THREE.Object3D[] = [
        boxAt(materials.toon('vendingBody'), [0.95, 1.8, 0.72], [V.x, LEVEL.path, V.z], { radius: 0.04, name: 'Vending/body' }),
        boxAt(materials.toon('rubber'), [0.6, 0.18, 0.04], [V.x, LEVEL.path + 0.2, V.z + 0.36], { radius: 0.01, name: 'Vending/slot' }),
    ];
    const window = mesh(new THREE.PlaneGeometry(0.78, 0.82), materials.glow('vendingGlow'), { name: 'Vending/window', castShadow: false, receiveShadow: false });
    window.position.set(V.x, LEVEL.path + 1.28, V.z + 0.365);
    parts.push(window);
    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 5; col += 1) {
            parts.push(boxAt(materials.toon(`product${(row * 5 + col) % 8}`), [0.08, 0.17, 0.05], [V.x - 0.28 + col * 0.14, LEVEL.path + 0.96 + row * 0.26, V.z + 0.38], { radius: 0.01, name: 'Vending/can' }));
        }
    }
    return { group: group('Vending', ...parts), window: window.position.clone() };
};

export const buildParkGrounds = (materials: MachiMaterials, seed: string | number): ParkGroundParts => {
    const random = createVisualizerRng(`park-grounds:${seed}`);
    const h = MACHI_BASE.half;
    const grass = boxSpan(materials.toon('grass'), -h + 0.01, h - 0.01, 0, LEVEL.grass, -h + 0.01, h - 0.01, { radius: 0.03, name: 'Grass' });
    // 草地上一小簇一小簇深一点的草（实例化的小锥）。
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.12, 5), materials.toon('grassDark'), 220);
    tufts.name = 'Grass/tufts';
    const matrix = new THREE.Matrix4();
    let count = 0;
    while (count < 220) {
        const x = (random() * 2 - 1) * (h - 0.3);
        const z = (random() * 2 - 1) * (h - 0.3);
        const onPath = PATHS.some(path => x > path.x0 - 0.1 && x < path.x1 + 0.1 && z > path.z0 - 0.1 && z < path.z1 + 0.1);
        const inPond = ((x - POND.x) / (POND.rx + 0.2)) ** 2 + ((z - POND.z) / (POND.rz + 0.2)) ** 2 < 1;
        const nearStage = Math.abs(x - STAGE.x) < STAGE.width / 2 + 0.6 && Math.abs(z - STAGE.z) < STAGE.depth / 2 + 0.6;
        if (onPath || inPond || nearStage) continue;
        matrix.makeScale(1, 0.7 + random() * 0.8, 1);
        matrix.setPosition(x, LEVEL.grass + 0.05, z);
        tufts.setMatrixAt(count, matrix);
        count += 1;
    }
    const paths = PATHS.map((path, index) => machiSurface(materials.toon('concrete'), path.x0, path.x1, path.z0, path.z1, LEVEL.path - 0.002, `Surface/path${index}`));
    const pathSlabs = PATHS.map((path, index) => boxSpan(materials.toon('curb'), path.x0 - 0.04, path.x1 + 0.04, LEVEL.grass - 0.01, LEVEL.path - 0.004, path.z0 - 0.04, path.z1 + 0.04, { radius: 0.02, name: `Path/edge${index}` }));
    const pond = buildPond(materials, random);
    const surfaces = group('Base/Surfaces', ...paths, pond.water);
    surfaces.userData.dynamic = true;
    const stage = buildStage(materials);
    // 提灯串的杆子：前面一串的两头。
    const lanternPoles = [LANTERN_LINE.from, LANTERN_LINE.to].map(([x, y, z]) => cylinderAt(materials.toon('woodDark'), 0.07, y + 0.15, [x, LEVEL.grass, z], { radiusTop: 0.055, segments: 8, name: 'LanternPole' }));
    const lamps = LAMPS.map(([x, z]) => buildLamp(materials, x, z));
    const clock = buildClock(materials);
    const vending = buildVending(materials);
    const base = group('Base', buildMachiPlinth(materials), grass, tufts, ...pathSlabs, surfaces);
    // 树下一圈深色的树坑（看起来是土）。
    const pits = TREES.map(tree => {
        const pit = mesh(new THREE.CircleGeometry(0.55 * tree.scale, 16).rotateX(-Math.PI / 2), materials.toon('soil'), { name: 'TreePit', castShadow: false });
        pit.position.set(tree.x, LEVEL.grass + 0.003, tree.z);
        return pit;
    });
    return {
        group: group(
            'Park',
            base,
            group('TreePits', ...pits),
            pond.group,
            stage.group,
            buildFence(materials),
            group('Benches', ...BENCHES.map(bench => buildBench(materials, bench.x, bench.z, bench.rotationY))),
            group('Lamps', ...lamps.map(lamp => lamp.group)),
            group('LanternPoles', ...lanternPoles),
            clock.group,
            vending.group,
        ),
        paths,
        water: pond.water,
        banner: stage.banner,
        poleTops: stage.poleTops,
        floods: stage.floods,
        lamps: lamps.map(lamp => lamp.head),
        clock: { hour: clock.hour, minute: clock.minute, face: clock.face },
        vending: vending.window,
    };
};
