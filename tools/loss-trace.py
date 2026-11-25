"""抓"谁调了 loseContext"：钩住 WEBGL_lose_context 扩展并记录调用栈。

Chrome 打出的 "CONTEXT_LOST_WEBGL: loseContext: context lost" 只在 context 被
主动销毁时出现（移除 canvas、合成器回收等）。这里把调用方钉出来，而不是继续猜。
"""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)

INIT = """
window.__GL_TRACE__ = { events: [], loseCalls: [] };

// 1) 记录所有 context lost / restored，带帧号与时间
window.addEventListener('webglcontextlost', (event) => {
  window.__GL_TRACE__.events.push({
    type: 'lost',
    at: Math.round(performance.now()),
    frame: window.__MOEBIUS_FRAMES__ ?? -1,
    status: event.statusMessage || '',
  });
}, true);
window.addEventListener('webglcontextrestored', (event) => {
  window.__GL_TRACE__.events.push({
    type: 'restored',
    at: Math.round(performance.now()),
    frame: window.__MOEBIUS_FRAMES__ ?? -1,
  });
}, true);

// 2) 钩住扩展：任何 loseContext()/restoreContext() 调用都留下栈
for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
  const original = proto.getExtension;
  proto.getExtension = function patchedGetExtension(name) {
    const result = original.call(this, name);
    if (name !== 'WEBGL_lose_context' || !result) return result;
    const loseContext = result.loseContext;
    const restoreContext = result.restoreContext;
    result.loseContext = function patchedLose() {
      window.__GL_TRACE__.loseCalls.push({
        call: 'loseContext',
        at: Math.round(performance.now()),
        frame: window.__MOEBIUS_FRAMES__ ?? -1,
        stack: new Error('loseContext trace').stack,
      });
      return loseContext.apply(this, arguments);
    };
    result.restoreContext = function patchedRestore() {
      window.__GL_TRACE__.loseCalls.push({
        call: 'restoreContext',
        at: Math.round(performance.now()),
        frame: window.__MOEBIUS_FRAMES__ ?? -1,
      });
      return restoreContext.apply(this, arguments);
    };
    return result;
  };
}

// 3) 记录 canvas 尺寸变化：合成器回收常与尺寸归零有关
window.__GL_TRACE__.resizes = [];
"""

PROBE = """
() => {
  const { renderer } = window.__MOEBIUS__ || {};
  const canvas = renderer ? renderer.domElement : null;
  return {
    trace: window.__GL_TRACE__,
    isLost: canvas ? canvas.getContext('webgl2')?.isContextLost?.() ?? null : null,
    canvasBuffer: canvas ? [canvas.width, canvas.height] : null,
    canvasCss: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
    frames: window.__MOEBIUS_FRAMES__ ?? 0,
    readout: document.getElementById('readout')?.textContent,
  };
}
"""


def run(page, name, viewport, wait_ms, screenshot=True):
    page.set_viewport_size(viewport)
    page.goto("http://127.0.0.1:5180/", wait_until="load", timeout=60000)
    page.wait_for_function("() => window.__MOEBIUS_READY__ === true", timeout=60000)
    page.wait_for_timeout(wait_ms)
    info = page.evaluate(PROBE)
    info["name"] = name
    info["viewport"] = viewport
    if screenshot:
        page.screenshot(path=str(ARTIFACTS / f"trace-{name}.png"))
        info["after_screenshot"] = page.evaluate(PROBE)
    return info


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
    )
    context = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    context.add_init_script(INIT)
    page = context.new_page()
    logs = []
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text[:120]}"))
    page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))

    results = [run(page, "1280x800", {"width": 1280, "height": 800}, 1200)]
    browser.close()

print(json.dumps(results, ensure_ascii=False, indent=2)[:6000])
print("--- console ---")
for line in logs[:24]:
    print(line)
