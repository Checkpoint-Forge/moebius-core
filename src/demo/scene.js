import * as THREE from 'three';
import { PALETTE, toonFlat, toonScene, toonGround, toonVivid } from '../engine/toon.js';

const GROUND = 0;
const PLINTH_TOP = 0.6;
const PLINTH_RADIUS = 4.4;
const POST_RING = 5.35;
const SOLID_RING = 7.1;
const CLUSTER_RING = 9.0;

/**
 * 展示色板：色相刻意分散。
 *
 * 引擎的 PALETTE 是低饱和的纸与沙，整幅画面在同一色系里；摆一堆几何会糊成
 * 一片。这里换成一条跨色相的展示色板，让每个体块在大片排线底下仍能分辨；
 * 底色（地面 / 圆台）继续用引擎的纸色与沙色，彩色才压得住。
 */
const SHOWCASE = Object.freeze({
  vermilion: 0xdd5340,
  clay: 0xd8804f,
  ochre: 0xe0a83c,
  mustard: 0xc2a02a,
  moss: 0x7d9a52,
  jade: 0x4fa88f,
  mint: 0x8fd0c8,
  lagoon: 0x4a8fb5,
  indigo: 0x4d5fa3,
  violet: 0x8f6fb0,
  rose: 0xc76b8e,
  coral: 0xef8f76,
  cream: 0xf6e7c8,
  bone: 0xcfc7b8,
  slate: 0x6b7683,
  charcoal: 0x39454f,
});

/** 环形布点的世界坐标：绕开固定角度布点，转到任何方向看都均匀。 */
function ring(index, count, radius, phase = 0) {
  const angle = (index / count) * Math.PI * 2 + phase;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/**
 * 展示台。
 *
 * 摆放规则只有两条，但必须严格执行，否则一眼就露怯：
 *   1. 平底的东西踩实：底面正好落在所在平面上（地面 / 圆台顶 / 另一块的顶面）。
 *      高度由几何尺寸算出来，不手填 y，既不会悬空也不会陷进去。
 *   2. 非平底的东西才浮空：球、环、纽结、多面体没有稳定支撑面，
 *      统一悬在圆台上方当"标本"，而不是斜插在地里或压出穿模。
 *
 * 布局用同心环：圆台（主）→ 立柱 → 平底几何一圈 → 密集方塔一圈。
 * 环是旋转对称的，相机绕到任何角度都不会出现"全挤在一边"或互相遮挡。
 *
 * 场景完全静止：这是给"看光"用的样板，物件一动，光角度的差异就被运动糊掉了。
 */
export function buildScene(scene) {
  const stage = new THREE.Group();
  stage.name = 'stage';
  scene.add(stage);

  function sit(mesh, height, { x, z, top = GROUND, rotY = 0 }) {
    mesh.position.set(x, top + height / 2, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    stage.add(mesh);
    return mesh;
  }

  function hover(mesh, { x, y, z, rotX = 0, rotY = 0 }) {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    stage.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- 底面
  // 800×800 不是为了"大地"，而是让地面边缘落在两道光闸之外：雾在 22–95 已把远处
  // 压成雾色，描边在 outlineFadeFar(180) 之后归零，于是"平面到哪里结束"这条硬边
  // 不会以墨线形式出现在地平线上。
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800, 1, 1),
    toonGround({ color: PALETTE.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  stage.add(ground);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS + 0.3, PLINTH_TOP, 72),
    toonFlat({ color: PALETTE.surface }),
  );
  sit(plinth, PLINTH_TOP, { x: 0, z: 0 });
  plinth.name = 'plinth';

  // ---------------------------------------------------------------- 圆台一圈立柱
  // 半径大于台底半径、小于平底几何那一圈：既插不进圆台，也不碰外圈。
  const postGeometry = new THREE.CylinderGeometry(0.22, 0.26, 1.1, 20);
  for (let index = 0; index < 8; index += 1) {
    const [x, z] = ring(index, 8, POST_RING, 0.35);
    const post = new THREE.Mesh(
      postGeometry,
      toonFlat({ color: index % 2 ? SHOWCASE.charcoal : SHOWCASE.slate }),
    );
    sit(post, 1.1, { x, z, rotY: index * 0.4 });
    post.name = `post-${index}`;
  }

  // ---------------------------------------------------------------- 平底组
  // 六种有稳定底面的体：每种换一个色相，方便比较"同一套光下的剪影差异"。
  const solids = [
    [new THREE.BoxGeometry(1.7, 1.7, 1.7), SHOWCASE.vermilion, 1.7],
    [new THREE.CylinderGeometry(0.8, 0.8, 1.9, 40), SHOWCASE.ochre, 1.9],
    [new THREE.ConeGeometry(0.95, 2.1, 40), SHOWCASE.lagoon, 2.1],
    [new THREE.CylinderGeometry(0, 1.15, 1.7, 4), SHOWCASE.jade, 1.7],
    [new THREE.CylinderGeometry(1.0, 1.0, 1.7, 3), SHOWCASE.violet, 1.7],
    [new THREE.CylinderGeometry(1.0, 1.0, 1.5, 6), SHOWCASE.coral, 1.5],
  ];
  solids.forEach(([geometry, color, height], index) => {
    const [x, z] = ring(index, 7, SOLID_RING, 0.2);
    const mesh = new THREE.Mesh(geometry, toonScene({ color }));
    sit(mesh, height, { x, z, rotY: index * 0.6 });
    mesh.name = `solid-${index}`;
  });

  // 第七个位置放五角星柱：ExtrudeGeometry 挤出的棱柱，平底，专门考"内部结构线"。
  const starShape = new THREE.Shape();
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? 1.15 : 0.48;
    const angle = (index / 10) * Math.PI * 2 + Math.PI / 2;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (index === 0) starShape.moveTo(px, py);
    else starShape.lineTo(px, py);
  }
  starShape.closePath();
  const starGeometry = new THREE.ExtrudeGeometry(starShape, { depth: 0.62, bevelEnabled: false });
  starGeometry.center();
  // 挤出方向是 +Z，转 90° 立起来：厚度沿 Y，底面自然水平。
  starGeometry.rotateX(-Math.PI / 2);
  const star = new THREE.Mesh(starGeometry, toonVivid({ color: SHOWCASE.mustard }));
  const [starX, starZ] = ring(6, 7, SOLID_RING, 0.2);
  sit(star, 0.62, { x: starX, z: starZ, rotY: -0.2 });
  star.name = 'star-prism';

  // 平躺的方形薄板：朝上的面，用来看"坡度补偿"有没有吃掉内部结构。
  const squareFlat = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.16, 2.4),
    toonScene({ color: SHOWCASE.clay }),
  );
  const [flatX, flatZ] = ring(3, 3, CLUSTER_RING + 0.6, 0.9);
  sit(squareFlat, 0.16, { x: flatX, z: flatZ, rotY: -0.3 });
  squareFlat.name = 'square-flat';

  // ---------------------------------------------------------------- 密集组：叠放不穿模
  // 三级方塔：每一级的中心都由下一级的顶面算出来，绝不会插进去。
  const [stackX, stackZ] = ring(0, 3, CLUSTER_RING, 2.2);
  let stackTop = GROUND;
  [[1.7, SHOWCASE.jade], [1.25, SHOWCASE.ochre], [0.85, SHOWCASE.rose]].forEach(
    ([size, color], index) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), toonScene({ color }));
      sit(mesh, size, { x: stackX, z: stackZ, top: stackTop, rotY: 0.2 + index * 0.28 });
      stackTop += size;
      mesh.name = `stack-${index}`;
    },
  );

  // 围着方塔一圈小方块：半径大于"塔底半宽 + 小方块半宽"(0.85+0.31)，互不相碰。
  const chipGeometry = new THREE.BoxGeometry(0.62, 0.62, 0.62);
  for (let index = 0; index < 7; index += 1) {
    const [chipX, chipZ] = ring(index, 7, 1.72, 0.3);
    const chip = new THREE.Mesh(
      chipGeometry,
      toonFlat({ color: index % 2 ? SHOWCASE.charcoal : SHOWCASE.bone }),
    );
    sit(chip, 0.62, {
      x: stackX + chipX,
      z: stackZ + chipZ,
      rotY: index * 0.9,
    });
    chip.name = `chip-${index}`;
  }

  // ---------------------------------------------------------------- 圆台顶：圆组
  // 圆盘与圆环都有"面"，可以踏实平躺，不必浮空。
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 72),
    toonScene({ color: SHOWCASE.cream, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(1.5, PLINTH_TOP + 0.012, 0.6);
  disc.castShadow = true;
  disc.receiveShadow = true;
  stage.add(disc);
  disc.name = 'disc';

  const ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.7, 72),
    toonFlat({ color: SHOWCASE.indigo, side: THREE.DoubleSide }),
  );
  ringMesh.rotation.x = -Math.PI / 2;
  // 抬 0.02 而不是 0.012：两块平躺件高度错开，才不会共面打架闪条纹。
  ringMesh.position.set(-1.6, PLINTH_TOP + 0.02, 1.4);
  ringMesh.receiveShadow = true;
  stage.add(ringMesh);
  ringMesh.name = 'ring';

  // 立着的方形：底边落在台面上，厚度方向不倾斜，所以是"踏实站住"而不是插进台面。
  const square = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.2, 0.18),
    toonScene({ color: SHOWCASE.vermilion }),
  );
  sit(square, 2.2, { x: -1.9, z: -2.3, top: PLINTH_TOP, rotY: 0.55 });
  square.name = 'square';

  // ---------------------------------------------------------------- 浮空组
  // 没有稳定底面：球、多面体、圆环体、纽结、胶囊。沿一条"螺旋"摆开 ——
  // 角度递增、半径与高度交错，任何视角下都不会挤成一团，也不会互相穿插。
  const spiral = (index, count, radius, height) => {
    const angle = (index / count) * Math.PI * 2 + 0.35;
    return {
      x: Math.cos(angle) * radius,
      y: height,
      z: Math.sin(angle) * radius,
      rotX: 0.25 + index * 0.18,
      rotY: angle,
    };
  };

  const hovered = [
    [new THREE.SphereGeometry(0.92, 40, 26), toonFlat, SHOWCASE.mint, spiral(0, 7, 3.5, 1.75)],
    [new THREE.CapsuleGeometry(0.34, 0.86, 8, 24), toonFlat, SHOWCASE.rose, spiral(1, 7, 2.7, 2.75)],
    [new THREE.IcosahedronGeometry(0.7, 0), toonFlat, SHOWCASE.violet, spiral(2, 7, 3.9, 3.55)],
    [new THREE.OctahedronGeometry(0.78, 0), toonScene, SHOWCASE.bone, spiral(3, 7, 2.9, 4.75)],
    [new THREE.TorusGeometry(0.9, 0.28, 24, 64), toonScene, SHOWCASE.lagoon, spiral(4, 7, 3.7, 2.35)],
    [new THREE.DodecahedronGeometry(0.64, 0), toonScene, SHOWCASE.coral, spiral(5, 7, 2.5, 5.6)],
    [new THREE.TorusKnotGeometry(0.48, 0.16, 72, 12), toonVivid, SHOWCASE.mustard, spiral(6, 7, 4.0, 3.15)],
  ];
  hovered.forEach(([geometry, factory, color, placement], index) => {
    const mesh = new THREE.Mesh(geometry, factory({ color }));
    hover(mesh, placement);
    mesh.name = `float-${index}`;
  });

  // 圆台上再叠一个小方堆：给"复杂"留一处密度对比，两级都用顶面推算高度。
  let miniTop = PLINTH_TOP;
  [[0.9, SHOWCASE.slate], [0.62, SHOWCASE.mustard]].forEach(([size, color], index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), toonScene({ color }));
    sit(mesh, size, { x: 2.5, z: -2.6, top: miniTop, rotY: 0.3 + index * 0.5 });
    miniTop += size;
    mesh.name = `mini-stack-${index}`;
  });

  return { stage, ground, plinth };
}
