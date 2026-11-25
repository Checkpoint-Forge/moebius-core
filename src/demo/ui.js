import { PARAM_META, PARAMS_VERSION, RENDER_PARAMS } from '../engine/render-params.js';
import { LIGHT_DEFAULTS } from './lights.js';
import {
  AUTO_SUN_DEFAULT,
  AUTO_SUN_ROW,
  DEBUG_VIEWS,
  LAYER_TOGGLES,
  LIGHT_FIELDS,
  PARAM_GROUPS,
  PRESETS,
} from './controls.js';

// 面板只做三件事：把 controls.js 的描述翻成 DOM、把改动写回状态、把状态汇总到顶部。
// 排版靠一套固定网格（标签 | 数值 | 单位 + 通栏滑杆），所有行等高、数值列同 x 对齐。

function el(tag, props = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function decimalsOf(step) {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

/** 一条参数行：标签 / 可编辑数值 / 单位 + 通栏滑杆。无单位也保留空列，数值才对齐。 */
function createRow(field, value, onInput) {
  const row = el('div', { class: 'row' });
  const label = el('label', { class: 'row-label' }, field.label);
  const decimals = decimalsOf(field.step);

  const input = el('input', { type: 'number', class: 'row-value' });
  input.min = field.min;
  input.max = field.max;
  input.step = field.step;
  input.setAttribute('aria-label', `${field.label} 精确值`);

  const unit = el('span', { class: 'row-unit' }, field.unit ?? '');
  const range = el('input', { type: 'range', class: 'row-range' });
  range.min = field.min;
  range.max = field.max;
  range.step = field.step;
  range.setAttribute('aria-label', field.label);
  if (field.id) {
    input.id = `${field.id}-value`;
    range.id = field.id;
  }

  let current = value;

  function paint(next, notify) {
    current = next;
    range.value = String(next);
    input.value = Number(next).toFixed(decimals);
    if (notify) onInput(next);
  }
  paint(value, false);

  range.addEventListener('input', () => paint(Number(range.value), true));
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    const clamped = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, field.min), field.max)
      : current;
    paint(clamped, true);
  });

  row.append(label, input, unit, range);
  return { row, input, range, set: (next) => paint(next, false), get: () => current };
}

function createSelect(label, options, value, onChange) {
  const wrapper = el('div', { class: 'select-row' });
  wrapper.append(el('label', { class: 'row-label' }, label));
  const select = el('select');
  for (const [optionValue, optionLabel] of options) {
    select.append(el('option', { value: String(optionValue) }, optionLabel));
  }
  select.value = String(value);
  select.addEventListener('change', () => onChange(select.value));
  wrapper.append(select);
  return { wrapper, select };
}

export function installUI({ pipeline, renderer, defaults, state, actions }) {
  const panel = document.getElementById('panel');
  const readout = document.getElementById('readout');
  panel.replaceChildren();

  const paramRows = new Map();
  const lightRows = new Map();
  let shadowTypeSelect = null;
  let layers = { outline: true, hatch: true, grain: true, shadows: true };
  let autoSun = false;

  // ---------------------------------------------------------------- 头部
  const header = el('header');
  header.append(
    el('h1', {}, 'Moebius Core'),
    el('p', { class: 'sub' }, `墨线后期内核 · three.js · 参数 v${PARAMS_VERSION}`),
  );

  const bar = el('div', { class: 'bar' });
  const presetSelect = el('select', { id: 'preset', 'aria-label': '预设' });
  presetSelect.append(el('option', { value: '' }, '选择预设…'));
  for (const preset of PRESETS) presetSelect.append(el('option', { value: preset.id }, preset.label));
  const resetButton = el('button', { type: 'button', class: 'ghost' }, '全部默认');
  bar.append(presetSelect, resetButton);
  header.append(bar);

  // ---------------------------------------------------------------- 汇总
  const summary = el('dl', { class: 'summary' });
  const summarySun = el('dd');
  const summaryLayers = el('dd');
  const summaryChanged = el('dd');
  summary.append(
    el('dt', {}, '主光'), summarySun,
    el('dt', {}, '图层'), summaryLayers,
    el('dt', {}, '改动'), summaryChanged,
  );
  header.append(summary);
  panel.append(header);

  // ---------------------------------------------------------------- 分区
  function section(title, note) {
    const details = el('details', { class: 'section' });
    details.open = true;
    const heading = el('summary');
    heading.append(el('span', { class: 'section-title' }, title));
    if (note) heading.append(el('span', { class: 'section-note' }, note));
    details.append(heading);
    panel.append(details);
    return details;
  }

  // ---------------------------------------------------------------- 光照
  const lightSection = section('光照', '角度决定排线分档');
  const autoRow = el('label', { class: 'toggle toggle-wide', for: 'toggle-autoSun' });
  const autoInput = el('input', { type: 'checkbox', id: 'toggle-autoSun' });
  autoInput.addEventListener('change', () => {
    autoSun = autoInput.checked;
    actions.setAutoSun(autoSun);
    const azimuth = lightRows.get('sunAzimuth');
    if (azimuth) {
      azimuth.row.classList.toggle('is-driven', autoSun);
      azimuth.range.disabled = autoSun;
      azimuth.input.disabled = autoSun;
      azimuth.set(state.lights.sunAzimuth);
    }
    syncSummary();
  });
  autoRow.append(autoInput, el('span', { text: '主光自动绕行（只转方位角）' }));
  lightSection.append(autoRow);

  // 绕光速度：单独一行，缺省值来自 controls.js，不写进 LIGHT_DEFAULTS
  // （它不是灯光状态，是动画参数）。
  const autoSpeedRow = createRow(AUTO_SUN_ROW, state.autoSunSpeed ?? AUTO_SUN_DEFAULT, (value) => {
    state.autoSunSpeed = value;
  });
  lightSection.append(autoSpeedRow.row);

  for (const field of LIGHT_FIELDS) {
    const row = createRow(field, state.lights[field.key], (value) => {
      state.lights[field.key] = value;
      actions.setLights(state.lights);
      syncSummary();
    });
    lightRows.set(field.key, row);
    lightSection.append(row.row);
  }

  // ---------------------------------------------------------------- 图层
  const layerSection = section('图层');
  const layerGrid = el('div', { class: 'toggle-grid' });
  for (const [key, label] of LAYER_TOGGLES) {
    const id = `toggle-${key}`;
    const wrapper = el('label', { class: 'toggle', for: id });
    const input = el('input', { type: 'checkbox', id });
    input.checked = layers[key];
    input.addEventListener('change', () => {
      layers[key] = input.checked;
      actions.setLayer(key, input.checked);
      syncSummary();
    });
    wrapper.append(input, el('span', { text: label }));
    layerGrid.append(wrapper);
  }
  layerSection.append(layerGrid);

  // ---------------------------------------------------------------- 画法参数
  const metaByKey = new Map(PARAM_META.map((meta) => [meta.key, meta]));
  for (const group of PARAM_GROUPS) {
    const details = section(group.title, group.note);
    for (const field of group.fields) {
      const row = createRow(field, RENDER_PARAMS[field.key], (value) => {
        RENDER_PARAMS[field.key] = value;
        pipeline.applyParams();
        markRow(field.key);
        syncSummary();
      });
      paramRows.set(field.key, row);
      details.append(row.row);
    }
    if (group.select === 'shadowType') {
      const meta = metaByKey.get('shadowType');
      const options = meta.options.map((option) => [option.value, option.label]);
      const { wrapper, select } = createSelect('图案', options, RENDER_PARAMS.shadowType, (value) => {
        RENDER_PARAMS.shadowType = Number(value);
        pipeline.applyParams();
        syncSummary();
      });
      details.append(wrapper);
      shadowTypeSelect = select;
    }
  }

  // ---------------------------------------------------------------- 速度线输入
  const speedSection = section('速度线输入');
  const speedRow = createRow(
    { label: '合成速度', id: 'synth-speed', min: 0, max: 76, step: 1 },
    state.speed,
    (value) => { state.speed = value; },
  );
  speedSection.append(speedRow.row);

  // ---------------------------------------------------------------- 视图
  const viewSection = section('视图通道');
  const { wrapper: viewWrapper, select: viewSelect } = createSelect(
    '通道',
    DEBUG_VIEWS,
    0,
    (value) => pipeline.setDebug(Number(value)),
  );
  viewSection.append(viewWrapper);

  // ---------------------------------------------------------------- 预设
  function applyPreset(preset) {
    // 预设只写"与默认不同"的项，其余必须显式回默认，否则会残留上一个预设。
    for (const [key, row] of paramRows) {
      const value = key in preset.params ? preset.params[key] : defaults[key];
      RENDER_PARAMS[key] = value;
      row.set(value);
      markRow(key);
    }
    for (const [key, row] of lightRows) {
      const value = key in preset.lights
        ? preset.lights[key]
        : (LIGHT_DEFAULTS[key] ?? state.lights[key]);
      state.lights[key] = value;
      row.set(value);
    }
    actions.setLights(state.lights);

    for (const [key, label] of LAYER_TOGGLES) {
      const enabled = preset.layers[key] ?? true;
      layers[key] = enabled;
      const input = document.getElementById(`toggle-${key}`);
      if (input && input.checked !== enabled) {
        input.checked = enabled;
        actions.setLayer(key, enabled);
      }
    }
    if (autoSun) document.getElementById('toggle-autoSun').checked = true;
    if (shadowTypeSelect) shadowTypeSelect.value = String(RENDER_PARAMS.shadowType);
    pipeline.applyParams();
    syncSummary();
  }

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((item) => item.id === presetSelect.value);
    if (preset) applyPreset(preset);
    presetSelect.value = '';
  });

  resetButton.addEventListener('click', () => applyPreset(PRESETS[0]));

  // ---------------------------------------------------------------- 汇总与读数
  let frames = 0;
  let elapsed = 0;
  let changed = 0;

  function markRow(key) {
    paramRows.get(key)?.row.classList.toggle('is-changed', RENDER_PARAMS[key] !== defaults[key]);
  }

  function syncSummary() {
    let paramChanges = 0;
    for (const [key, row] of paramRows) {
      const isChanged = RENDER_PARAMS[key] !== defaults[key];
      row.row.classList.toggle('is-changed', isChanged);
      if (isChanged) paramChanges += 1;
    }
    let lightChanges = 0;
    for (const key of Object.keys(LIGHT_DEFAULTS)) {
      if (Math.abs(state.lights[key] - LIGHT_DEFAULTS[key]) > 1e-6) lightChanges += 1;
    }
    changed = paramChanges + lightChanges;

    summarySun.textContent = describeSun();

    const on = LAYER_TOGGLES.filter(([key]) => layers[key]).map(([, label]) => label);
    summaryLayers.textContent = on.length ? on.join(' / ') : '全部关闭';

    summaryChanged.textContent = changed ? `${changed} 项偏离默认` : '全部默认';
    summaryChanged.classList.toggle('is-changed', changed > 0);
  }

  function setStatus(text) {
    readout.textContent = text;
  }

  function updateReadout(dt) {
    frames += 1;
    elapsed += dt;
    if (elapsed < 0.4) return;
    const fps = Math.round(frames / elapsed);
    frames = 0;
    elapsed = 0;
    const { colorTarget, normalTarget, hdr } = pipeline;
    setStatus(
      `${fps} fps`
      + `  ${colorTarget.width}×${colorTarget.height} ${hdr ? 'HDR' : 'LDR'}`
      + `  法线 ${normalTarget.width}×${normalTarget.height}`
      + `  阴影${renderer.shadowMap.enabled ? '开' : '关'}`,
    );
  }

  syncSummary();

  // 自动绕光每帧都会调用这里。读数按 0.1° 刷新 —— 按整度取整会让方位角
  // 一格一格跳，看起来像卡住；0.1° 在 6°/s 下约每秒 60 次更新，视觉连续。
  let lastAzimuth = null;

  function describeSun() {
    const azimuth = state.lights.sunAzimuth;
    const formatted = autoSun ? azimuth.toFixed(1) : String(Math.round(azimuth));
    return `仰角 ${state.lights.sunElevation.toFixed(1)}° · 方位 ${formatted}°`
      + (autoSun ? ' · 自动' : '');
  }

  return {
    setStatus,
    updateReadout,
    /** 自动绕行时外部驱动方位角：只更新控件显示，不再回调（避免每帧重写状态）。 */
    setAzimuth(value) {
      // 0.1° 量化：低于这个分辨率时不做任何 DOM 写入。
      const quantized = Math.round(value * 10);
      if (quantized === lastAzimuth) return;
      lastAzimuth = quantized;
      lightRows.get('sunAzimuth')?.set(quantized / 10);
      summarySun.textContent = describeSun();
    },
    get layers() { return { ...layers }; },
  };
}
