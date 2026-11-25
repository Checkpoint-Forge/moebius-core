import * as THREE from 'three';
import { seededRandom } from './rng.js';

/**
 * 程序化纸纹贴图：唯一由本模块产出的贴图资源。
 *
 * 256² 的灰噪声 + 少量纤维笔触，合成时按 `uPaperStrength` 乘到最终色上，
 * 给平涂区域一点纸的颗粒。排线本身是程序化的（合成 pass 里的 uHatch*），
 * 不在这里烘焙。
 *
 * 种子固定，所以同一版本永远得到同一张纸 —— 换种子等于换画风。
 */
export function createPaperMap(anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const random = seededRandom(719);
  const image = context.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.floor(112 + random() * 32);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  context.globalAlpha = 0.12;
  for (let i = 0; i < 420; i += 1) {
    const x = random() * 256;
    const y = random() * 256;
    const length = 3 + random() * 14;
    context.strokeStyle = random() > 0.5 ? '#f4f4f4' : '#545454';
    context.lineWidth = 0.35 + random() * 0.55;
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(x + length * 0.5, y + (random() - 0.5) * 2, x + length, y + (random() - 0.5) * 3);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'procedural_paper';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
