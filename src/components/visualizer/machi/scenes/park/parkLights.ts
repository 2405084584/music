import * as THREE from 'three';
import { createSoftEllipseTexture } from '../../engine/actors/traffic';
import type { MachiColorBlend, MachiMaterials } from '../../engine/materials';
import { LEVEL } from './layout';

// src/components/visualizer/machi/scenes/park/parkLights.ts
// 樱花公园的灯：三盏园灯（暖色点光，地上一圈光斑）、舞台两盏照横幅的聚光、前面那串提灯下两盏暖粉的弱光
// （夜樱：把树冠和草地从下面染暖）。黄昏点亮，白天熄。

export interface ParkLightLevels {
    lamps: number;
    floods: number;
    lanterns: number;
    pools: number;
}

export class ParkLights {
    readonly group = new THREE.Group();
    private readonly lamps: THREE.PointLight[];
    private readonly floods: THREE.SpotLight[];
    private readonly lanterns: THREE.PointLight[];
    private readonly pools: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];
    private readonly texture = createSoftEllipseTexture();
    private levels: ParkLightLevels = { lamps: 1, floods: 1, lanterns: 1, pools: 1 };

    constructor(
        private readonly blend: MachiColorBlend,
        materials: MachiMaterials,
        lampHeads: THREE.Vector3[],
        floods: { head: THREE.Vector3; target: THREE.Vector3 }[],
        lanternGlows: THREE.Vector3[],
    ) {
        this.group.name = 'ParkLights';
        this.lamps = lampHeads.map((head, index) => {
            const light = new THREE.PointLight(0xffffff, 4.5, 5.5, 2);
            light.position.copy(head);
            light.name = `Lights/lamp${index}`;
            const material = materials.track(new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2), material);
            pool.position.set(head.x, LEVEL.path + 0.008, head.z);
            pool.renderOrder = 1;
            pool.name = 'Pool/lamp';
            this.pools.push({ mesh: pool, material });
            this.group.add(pool);
            return light;
        });
        this.floods = floods.map((flood, index) => {
            const light = new THREE.SpotLight(0xffffff, 16, 9, 0.5, 0.6, 2);
            light.position.copy(flood.head);
            light.target.position.copy(flood.target);
            light.name = `Lights/flood${index}`;
            this.group.add(light.target);
            return light;
        });
        this.lanterns = lanternGlows.map((at, index) => {
            const light = new THREE.PointLight(0xffffff, 2.6, 5, 2);
            light.position.copy(at);
            light.name = `Lights/lantern${index}`;
            return light;
        });
        this.group.add(...this.lamps, ...this.floods, ...this.lanterns);
        this.sync();
    }

    setLevels(levels: ParkLightLevels) {
        const previous = this.levels;
        if (previous.lamps === levels.lamps && previous.floods === levels.floods && previous.lanterns === levels.lanterns && previous.pools === levels.pools) return;
        this.levels = levels;
        this.sync();
    }

    sync() {
        const levels = this.levels;
        this.lamps.forEach(light => {
            light.color.copy(this.blend.get('interiorLight'));
            light.intensity = 4.5 * levels.lamps;
        });
        this.floods.forEach(light => {
            light.color.copy(this.blend.get('streetLight'));
            light.intensity = 16 * levels.floods;
        });
        this.lanterns.forEach(light => {
            light.color.copy(this.blend.get('lanternGlow'));
            light.intensity = 2.6 * levels.lanterns;
        });
        this.pools.forEach(({ material }) => {
            material.color.copy(this.blend.get('interiorLight')).multiplyScalar(0.42 * levels.lamps * levels.pools);
        });
    }

    dispose() {
        this.pools.forEach(pool => pool.mesh.geometry.dispose());
        this.texture.dispose();
    }
}
