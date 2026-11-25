"""真实浏览器冒烟：加载 demo，等症状就绪，抓控制台错误，截四张图。

只依赖 python playwright（本机已验证可用）。服务器要由调用方先起好：
    node serve.mjs
    python tools/smoke.py
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
URL = os.environ.get("MOEBIUS_URL", "http://127.0.0.1:5180/")

CHECKS = {}
ERRORS = []


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page.on("pageerror", lambda error: ERRORS.append(f"pageerror: {error}"))
        page.on(
            "console",
            lambda message: ERRORS.append(f"console.{message.type}: {message.text}")
            if message.type == "error"
            else None,
        )
        failed = []
        page.on("requestfailed", lambda request: failed.append(f"{request.url} {request.failure}"))

        page.goto(URL, wait_until="load", timeout=60000)
        page.wait_for_function("() => window.__MOEBIUS_READY__ === true", timeout=60000)
        # 软件渲染下 Chrome 的 GPU 进程会在首帧编译期丢掉 context，随后 three 自动
        # 恢复（实测 ~0.3s 丢、~1.3s 恢复）。必须等"恢复之后又画了若干帧"再取证，
        # 否则截到的是恢复前的白屏窗口。
        page.wait_for_function(
            """() => {
              const { renderer } = window.__MOEBIUS__ || {};
              if (!renderer) return false;
              const lost = renderer.getContext().isContextLost();
              return !lost && (window.__MOEBIUS_FRAMES__ ?? 0) > 30;
            }""",
            timeout=90000,
        )
        page.wait_for_timeout(600)

        CHECKS["ready"] = page.evaluate("() => window.__MOEBIUS_READY__ === true")
        CHECKS["three_revision"] = page.evaluate("() => window.__MOEBIUS__.engine.revision")
        CHECKS["hdr"] = page.evaluate("() => window.__MOEBIUS__.pipeline.hdr")
        CHECKS["software_gl"] = page.evaluate("() => window.__MOEBIUS__.softwareGL")
        CHECKS["color_target"] = page.evaluate(
            "() => [window.__MOEBIUS__.pipeline.colorTarget.width, window.__MOEBIUS__.pipeline.colorTarget.height]"
        )
        CHECKS["normal_target"] = page.evaluate(
            "() => [window.__MOEBIUS__.pipeline.normalTarget.width, window.__MOEBIUS__.pipeline.normalTarget.height]"
        )
        CHECKS["frames"] = page.evaluate("() => window.__MOEBIUS_FRAMES__")
        CHECKS["context_lost"] = page.evaluate(
            "() => window.__MOEBIUS__.renderer.getContext().isContextLost()"
        )

        # 非空画面：读离屏颜色缓冲（不是默认帧缓冲 —— 后者在帧结束后已被清空）。
        # HalfFloat 目标必须用 Uint16Array 读回，用 Uint8Array 会静默得到全零。
        CHECKS["pixel_stats"] = page.evaluate(
            """() => {
              const { renderer, pipeline } = window.__MOEBIUS__;
              const target = pipeline.colorTarget;
              const w = target.width, h = target.height;
              const Buffer = target.texture.type === 1016 ? Uint16Array : Uint8Array;
              const buffer = new Buffer(w * h * 4);
              renderer.readRenderTargetPixels(target, 0, 0, w, h, buffer);
              let lit = 0, maxValue = 0;
              for (let i = 0; i < buffer.length; i += 4) {
                const a = buffer[i + 3];
                const value = buffer[i] + buffer[i + 1] + buffer[i + 2];
                if (a > 0) lit += 1;
                if (value > maxValue) maxValue = value;
              }
              return { total: w * h, litRatio: lit / (w * h), maxValue, canvas: [w, h] };
            }"""
        )

        shots = [
            ("composite", 0),
            ("outline-mask", 1),
            ("hatch-mask", 2),
            ("normal-buffer", 3),
        ]
        sizes = {}
        for name, level in shots:
            page.evaluate(f"() => window.__MOEBIUS__.setDebug({level})")
            page.wait_for_timeout(320)
            path = ARTIFACTS / f"demo-{name}.png"
            page.screenshot(path=str(path))
            sizes[name] = path.stat().st_size

        # 速度线：推进合成速度滑杆，确认动态 uniform 真的写进了管线。
        page.evaluate("() => window.__MOEBIUS__.setDebug(0)")
        page.evaluate(
            """() => {
              const speed = document.getElementById('synth-speed');
              speed.value = '76';
              speed.dispatchEvent(new Event('input', { bubbles: true }));
            }"""
        )
        page.wait_for_timeout(420)
        CHECKS["speed_uniform"] = page.evaluate(
            "() => window.__MOEBIUS__.pipeline.postMaterial.uniforms.uSpeed.value"
        )
        page.screenshot(path=str(ARTIFACTS / "demo-speed-edge.png"))

        page.evaluate(
            """() => {
              const speed = document.getElementById('synth-speed');
              speed.value = '0';
              speed.dispatchEvent(new Event('input', { bubbles: true }));
            }"""
        )
        page.wait_for_timeout(200)

        browser.close()

    pixels = CHECKS.get("pixel_stats") or {}
    results = {
        "ready": CHECKS["ready"] is True,
        "three_revision": CHECKS["three_revision"],
        "hdr": CHECKS["hdr"],
        "software_gl": CHECKS["software_gl"],
        "context_alive": CHECKS["context_lost"] is False,
        "renders_frames": isinstance(CHECKS["frames"], int) and CHECKS["frames"] > 12,
        "scene_not_empty": (pixels.get("litRatio") or 0) > 0.05,
        "normal_half_res": CHECKS["normal_target"][0] * 2 <= CHECKS["color_target"][0] + 1,
        # 纯色/空白截图的 PNG 压得极小；真实场景 1280×800 在 60KB 以上。
        "screenshot_has_detail": min(sizes.values()) > 25_000,
        "masks_differ": len({sizes["composite"], sizes["outline-mask"], sizes["hatch-mask"]}) == 3,
        "speed_input_reaches_shader": CHECKS["speed_uniform"] == 76,
        "no_console_errors": not ERRORS,
        "no_failed_requests": not failed,
    }

    report = {
        "url": URL,
        "checks": results,
        "pixel_stats": pixels,
        "screenshot_bytes": sizes,
        "errors": ERRORS,
        "failed_requests": failed,
    }
    (ARTIFACTS / "smoke-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
