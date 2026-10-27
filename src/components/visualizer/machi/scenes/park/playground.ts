import * as THREE from 'three';
import { boxAt, boxSpan, cylinderAt, group, mesh, tubeBetween } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { LEVEL, PLAYGROUND } from './layout';

// src/components/visualizer/machi/scenes/park/playground.ts
// 游乐设施：秋千（A 字架、两只秋千随风轻摆）、滑梯（梯子、平台、滑道）、方格攀登架、跷跷板（慢慢起伏）、沙坑（木框、
// 小桶小铲）、弹簧摇摇马（一只圆滚滚的小动物）。颜色用主题的品牌色和商品色。会动的件单独返回，场景每帧转它们。

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface PlaygroundParts {
    group: THREE.Group;
    /** 秋千：绕顶梁转（rotation.x）。 */
    swings: THREE.Group[];
    /** 跷跷板：绕支点转（rotation.z）。 */
    seesaw: THREE.Group;
    /** 弹簧摇摇马：前后摇（rotation.x）。 */
    rider: THREE.Group;
}

const buildSwings = (materials: MachiMaterials) => {
    const S = PLAYGROUND.swings;
    const frame = materials.toon('brand2');
    const metal = materials.toon('metal');
    const y0 = LEVEL.grass;
    const top = y0 + S.height;
    const parts: THREE.Object3D[] = [];
    // 两头的 A 字架（沿 z 叉开）与顶梁（沿 x）。
    [-1, 1].forEach(side => {
        const x = S.x + side * S.width / 2;
        parts.push(tubeBetween(frame, v(x, y0, S.z - 0.75), v(x, top, S.z), 0.05, { name: 'Swing/leg' }));
        parts.push(tubeBetween(frame, v(x, y0, S.z + 0.75), v(x, top, S.z), 0.05, { name: 'Swing/leg' }));
    });
    parts.push(tubeBetween(frame, v(S.x - S.width / 2 - 0.08, top, S.z), v(S.x + S.width / 2 + 0.08, top, S.z), 0.055, { name: 'Swing/beam' }));
    const swings = [-0.5, 0.5].map((offset, index) => {
        const swing = new THREE.Group();
        swing.name = `Swing${index}`;
        swing.userData.dynamic = true;
        const chainLength = S.height - 0.55;
        [-0.24, 0.24].forEach(dx => {
            swing.add(tubeBetween(metal, v(dx, 0, 0), v(dx, -chainLength, 0), 0.012, { name: 'Swing/chain', castShadow: false }));
        });
        swing.add(boxAt(materials.toon(index === 0 ? 'brand0' : 'product2'), [0.56, 0.05, 0.26], [0, -chainLength - 0.05, 0], { radius: 0.02, name: 'Swing/seat' }));
        swing.position.set(S.x + offset * S.width * 0.6, top - 0.04, S.z);
        return swing;
    });
    return { group: group('Swings', ...parts, ...swings), swings };
};

const buildSlide = (materials: MachiMaterials) => {
    const S = PLAYGROUND.slide;
    const y0 = LEVEL.grass;
    const rail = materials.toon('brand0');
    const chute = materials.toon('product1');
    const parts: THREE.Object3D[] = [];
    const deck = 1.55;
    // 平台在后面（-z），梯子从后面爬上去，滑道往前（+z）滑下来。
    const back = S.z - 0.9;
    [-0.3, 0.3].forEach(dx => {
        parts.push(cylinderAt(rail, 0.045, deck + 0.75, [S.x + dx, y0, back - 0.25], { segments: 8, name: 'Slide/post' }));
        parts.push(cylinderAt(rail, 0.045, deck + 0.75, [S.x + dx, y0, back + 0.3], { segments: 8, name: 'Slide/post' }));
        parts.push(tubeBetween(rail, v(S.x + dx, y0, back - 0.95), v(S.x + dx, y0 + deck, back - 0.3), 0.035, { name: 'Slide/ladderRail' }));
    });
    for (let step = 1; step <= 5; step += 1) {
        const t = step / 6;
        const z = back - 0.95 + 0.65 * t;
        parts.push(tubeBetween(rail, v(S.x - 0.3, y0 + deck * t, z), v(S.x + 0.3, y0 + deck * t, z), 0.025, { name: 'Slide/rung' }));
    }
    parts.push(boxSpan(materials.toon('wood'), S.x - 0.36, S.x + 0.36, y0 + deck - 0.06, y0 + deck, back - 0.32, back + 0.36, { radius: 0.02, name: 'Slide/deck' }));
    parts.push(boxSpan(rail, S.x - 0.36, S.x + 0.36, y0 + deck + 0.55, y0 + deck + 0.62, back - 0.32, back + 0.36, { radius: 0.02, name: 'Slide/roofBar' }));
    // 滑道：一块斜板，两边低栏，底下一小段平的出口。
    const top = v(S.x, y0 + deck, back + 0.36);
    const bottom = v(S.x, y0 + 0.28, S.z + 1.25);
    const length = top.distanceTo(bottom);
    const slope = new THREE.Group();
    slope.add(boxAt(chute, [0.56, 0.05, length], [0, -0.025, 0], { radius: 0.02, name: 'Slide/chute' }));
    [-0.29, 0.29].forEach(dx => slope.add(boxAt(chute, [0.04, 0.14, length], [dx, 0, 0], { radius: 0.015, name: 'Slide/side' })));
    slope.position.copy(top).add(bottom).multiplyScalar(0.5);
    slope.rotation.x = Math.atan2(top.y - bottom.y, bottom.z - top.z);
    parts.push(slope);
    parts.push(boxSpan(chute, S.x - 0.28, S.x + 0.28, y0 + 0.2, y0 + 0.26, S.z + 1.2, S.z + 1.6, { radius: 0.02, name: 'Slide/exit' }));
    return group('Slide', ...parts);
};

const buildJungleGym = (materials: MachiMaterials) => {
    const J = PLAYGROUND.jungleGym;
    const y0 = LEVEL.grass;
    const step = J.size / 3;
    const bars: { from: THREE.Vector3; to: THREE.Vector3; color: number }[] = [];
    const x0 = J.x - J.size / 2;
    const z0 = J.z - J.size / 2;
    for (let i = 0; i <= 3; i += 1) {
        for (let j = 0; j <= 3; j += 1) {
            // 竖杆：只在四周与正中。
            if (i === 0 || i === 3 || j === 0 || j === 3) bars.push({ from: v(x0 + i * step, y0, z0 + j * step), to: v(x0 + i * step, y0 + J.size, z0 + j * step), color: 0 });
        }
    }
    for (let level = 1; level <= 3; level += 1) {
        const y = y0 + level * (J.size / 3);
        for (let k = 0; k <= 3; k += 1) {
            bars.push({ from: v(x0, y, z0 + k * step), to: v(x0 + J.size, y, z0 + k * step), color: level });
            bars.push({ from: v(x0 + k * step, y, z0), to: v(x0 + k * step, y, z0 + J.size), color: level });
        }
    }
    const geometry = new THREE.CylinderGeometry(0.028, 0.028, 1, 6);
    const roles = ['brand0', 'brand2', 'product0', 'product1'];
    const groups = roles.map(role => ({ role, bars: [] as typeof bars }));
    bars.forEach(bar => groups[bar.color % roles.length]!.bars.push(bar));
    const meshes = groups.filter(entry => entry.bars.length).map(entry => {
        const instanced = new THREE.InstancedMesh(geometry, materials.toon(entry.role), entry.bars.length);
        instanced.name = 'JungleGym';
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        entry.bars.forEach((bar, index) => {
            const length = bar.from.distanceTo(bar.to);
            quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bar.to.clone().sub(bar.from).normalize());
            matrix.compose(bar.from.clone().add(bar.to).multiplyScalar(0.5), quaternion, new THREE.Vector3(1, length, 1));
            instanced.setMatrixAt(index, matrix);
        });
        return instanced;
    });
    return group('JungleGym', ...meshes);
};

const buildSeesaw = (materials: MachiMaterials) => {
    const S = PLAYGROUND.seesaw;
    const y0 = LEVEL.grass;
    const parts: THREE.Object3D[] = [
        boxAt(materials.toon('metal'), [0.2, 0.42, 0.34], [S.x, y0, S.z], { radius: 0.04, name: 'Seesaw/pivot' }),
    ];
    const board = new THREE.Group();
    board.name = 'Seesaw/board';
    board.userData.dynamic = true;
    board.add(boxAt(materials.toon('product3'), [2.6, 0.06, 0.26], [0, -0.03, 0], { radius: 0.02, name: 'Seesaw/plank' }));
    [-1, 1].forEach(side => {
        board.add(boxAt(materials.toon('brand0'), [0.06, 0.24, 0.32], [side * 1.05, 0, 0], { radius: 0.02, name: 'Seesaw/handle' }));
        board.add(boxAt(materials.toon('rubber'), [0.16, 0.06, 0.2], [side * 1.24, -0.12, 0], { radius: 0.02, name: 'Seesaw/bumper' }));
    });
    board.position.set(S.x, y0 + 0.44, S.z);
    return { group: group('Seesaw', ...parts, board), board };
};

const buildSandbox = (materials: MachiMaterials) => {
    const S = PLAYGROUND.sandbox;
    const y0 = LEVEL.grass;
    const half = S.size / 2;
    const wood = materials.toon('wood');
    const parts: THREE.Object3D[] = [
        boxSpan(materials.toon('sand'), S.x - half + 0.08, S.x + half - 0.08, y0, y0 + 0.08, S.z - half + 0.08, S.z + half - 0.08, { radius: 0.02, name: 'Sand' }),
        boxSpan(wood, S.x - half, S.x + half, y0, y0 + 0.16, S.z - half, S.z - half + 0.1, { radius: 0.02, name: 'Sandbox/edge' }),
        boxSpan(wood, S.x - half, S.x + half, y0, y0 + 0.16, S.z + half - 0.1, S.z + half, { radius: 0.02, name: 'Sandbox/edge' }),
        boxSpan(wood, S.x - half, S.x - half + 0.1, y0, y0 + 0.16, S.z - half, S.z + half, { radius: 0.02, name: 'Sandbox/edge' }),
        boxSpan(wood, S.x + half - 0.1, S.x + half, y0, y0 + 0.16, S.z - half, S.z + half, { radius: 0.02, name: 'Sandbox/edge' }),
    ];
    // 小桶、小铲、沙堆。
    parts.push(cylinderAt(materials.toon('brand0'), 0.09, 0.16, [S.x + 0.3, y0 + 0.08, S.z - 0.2], { radiusTop: 0.11, segments: 12, name: 'Bucket' }));
    parts.push(boxAt(materials.toon('product2'), [0.22, 0.03, 0.08], [S.x - 0.25, y0 + 0.09, S.z + 0.25], { radius: 0.01, name: 'Shovel', rotationY: 0.6 }));
    const mound = mesh(new THREE.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), materials.toon('sand'), { name: 'Mound' });
    mound.position.set(S.x - 0.1, y0 + 0.08, S.z - 0.15);
    parts.push(mound);
    return group('Sandbox', ...parts);
};

/** 弹簧摇摇马：一根弹簧上坐着一只圆滚滚的小熊猫（白身子、黑耳朵、黑眼圈）。 */
const buildSpringRider = (materials: MachiMaterials) => {
    const S = PLAYGROUND.springRider;
    const y0 = LEVEL.grass;
    const parts: THREE.Object3D[] = [
        cylinderAt(materials.toon('concrete'), 0.28, 0.06, [S.x, y0, S.z], { segments: 16, name: 'Rider/base' }),
    ];
    const rider = new THREE.Group();
    rider.name = 'Rider';
    rider.userData.dynamic = true;
    const coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        return v(Math.cos(t * Math.PI * 10) * 0.1, t * 0.45, Math.sin(t * Math.PI * 10) * 0.1);
    })), 64, 0.018, 5, false);
    rider.add(mesh(coil, materials.toon('caution'), { name: 'Rider/spring' }));
    const white = materials.toon('white');
    const black = materials.toon('rubber');
    const body = mesh(new THREE.SphereGeometry(0.26, 14, 10).scale(1, 0.8, 1.25), white, { name: 'Rider/body' });
    body.position.set(0, 0.62, 0);
    const head = mesh(new THREE.SphereGeometry(0.19, 14, 10), white, { name: 'Rider/head' });
    head.position.set(0, 0.86, 0.26);
    rider.add(body, head);
    [-1, 1].forEach(side => {
        const ear = mesh(new THREE.SphereGeometry(0.06, 8, 6), black, { name: 'Rider/ear' });
        ear.position.set(side * 0.13, 1.02, 0.24);
        const eye = mesh(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 1.2, 0.5), black, { name: 'Rider/eye' });
        eye.position.set(side * 0.075, 0.89, 0.43);
        rider.add(ear, eye);
        rider.add(tubeBetween(materials.toon('brand0'), v(side * 0.16, 0.92, 0.18), v(side * 0.16, 1.02, 0.12), 0.02, { name: 'Rider/handle' }));
    });
    rider.position.set(S.x, y0 + 0.06, S.z);
    rider.rotation.y = 0.5;
    return { group: group('SpringRider', ...parts, rider), rider };
};

export const buildPlayground = (materials: MachiMaterials): PlaygroundParts => {
    const swings = buildSwings(materials);
    const seesaw = buildSeesaw(materials);
    const rider = buildSpringRider(materials);
    return {
        group: group('Playground', swings.group, buildSlide(materials), buildJungleGym(materials), seesaw.group, buildSandbox(materials), rider.group),
        swings: swings.swings,
        seesaw: seesaw.board,
        rider: rider.rider,
    };
};
