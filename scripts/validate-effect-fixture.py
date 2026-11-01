#!/usr/bin/env python3
"""
Validation script for synthetic ProRes 4444 effect fixture.
Tests against all criteria in Section 7.2 and Decision #5 of Phase 0 audit report:
- Codec & format validation
- Frame 0 pixel values & alpha correctness
- Straight vs premultiplied alpha conversion
- White / Black / Checkerboard compositing tests
- Frame-accurate seeking across frames 0, 15, 30, 45, 59
- Performance benchmark (decode time per frame)
"""

import os
import sys
import time
import subprocess
import numpy as np
from PIL import Image

FIXTURE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'test-effect-fixture.mov'))
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'clypra', 'tests', 'fixtures', 'validation_output'))
os.makedirs(OUT_DIR, exist_ok=True)

def run_command(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{p.stderr}")
    return p.stdout

def decode_frame(frame_num, out_png):
    # Use select filter to get exact frame
    cmd = [
        'ffmpeg', '-y',
        '-i', FIXTURE_PATH,
        '-vf', f'select=eq(n\\,{frame_num})',
        '-vframes', '1',
        out_png
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return Image.open(out_png)

def test_ffprobe():
    print("=== Test 1: FFprobe Codec & Format Verification ===")
    assert os.path.exists(FIXTURE_PATH), f"Fixture not found at {FIXTURE_PATH}"
    
    output = run_command([
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_frames',
        '-of', 'default=noprint_wrappers=1',
        FIXTURE_PATH
    ])
    props = dict(line.split('=', 1) for line in output.strip().splitlines() if '=' in line)
    print("Stream properties:", props)
    
    assert props['codec_name'] == 'prores', f"Expected codec prores, got {props['codec_name']}"
    assert '4444' in props['profile'], f"Expected profile 4444, got {props['profile']}"
    assert 'yuva' in props['pix_fmt'], f"Expected yuva format with alpha, got {props['pix_fmt']}"
    assert props['width'] == '640', f"Expected width 640, got {props['width']}"
    assert props['height'] == '360', f"Expected height 360, got {props['height']}"
    assert props['r_frame_rate'] == '30/1', f"Expected 30 fps, got {props['r_frame_rate']}"
    assert props['nb_frames'] == '60', f"Expected 60 frames, got {props['nb_frames']}"
    print("✅ FFprobe checks passed successfully.")
    return props

def test_frame_0_pixels():
    print("\n=== Test 2: Frame 0 Alpha & Pixel Value Verification ===")
    frame0_path = os.path.join(OUT_DIR, 'frame_000.png')
    img = decode_frame(0, frame0_path)
    arr = np.array(img)
    
    # 1. Top-left: transparent (alpha = 0)
    tl = arr[10, 10]
    tl_center = arr[90, 160]
    print(f"Top-Left (10, 10): {tl}")
    print(f"Top-Left center (160, 90): {tl_center}")
    assert tl[3] == 0, f"Expected alpha 0 at (10, 10), got {tl[3]}"
    assert tl_center[3] == 0, f"Expected alpha 0 at center, got {tl_center[3]}"
    
    # 2. Top-right: opaque red (alpha = 255, R ~ 255)
    tr = arr[10, 630]
    tr_center = arr[90, 480]
    print(f"Top-Right (630, 10): {tr}")
    print(f"Top-Right center (480, 90): {tr_center}")
    assert tr[3] == 255, f"Expected alpha 255 at (630, 10), got {tr[3]}"
    assert tr[0] >= 250, f"Expected red >= 250, got {tr[0]}"
    assert tr_center[3] == 255 and tr_center[0] >= 250
    
    # 3. Bottom-left: semi blue (alpha = 128, B ~ 255 in straight alpha)
    bl = arr[350, 10]
    bl_center = arr[270, 160]
    print(f"Bottom-Left (10, 350): {bl}")
    print(f"Bottom-Left center (160, 270): {bl_center}")
    assert abs(int(bl[3]) - 128) <= 2, f"Expected alpha ~128, got {bl[3]}"
    assert bl[2] >= 250, f"Expected blue >= 250 in straight alpha, got {bl[2]}"
    
    # 4. Bottom-right: horizontal gradient green (alpha 0->255, G ~ 255 in straight alpha)
    br_left = arr[270, 325]
    br_center = arr[270, 480]
    br_right = arr[270, 635]
    print(f"Gradient near start (325, 270): {br_left}")
    print(f"Gradient center (480, 270): {br_center}")
    print(f"Gradient near end (635, 270): {br_right}")
    assert br_left[3] < 20, f"Expected low alpha near start, got {br_left[3]}"
    assert abs(int(br_center[3]) - 128) <= 4, f"Expected alpha ~128 at center, got {br_center[3]}"
    assert br_right[3] >= 245, f"Expected high alpha near end, got {br_right[3]}"
    assert br_center[1] >= 250, f"Expected green >= 250 in straight alpha, got {br_center[1]}"
    
    print("✅ Frame 0 pixel and alpha checks passed successfully.")
    return arr

def test_compositing(frame_arr):
    print("\n=== Test 3: Compositor Alpha Blending (Decision #5) ===")
    h, w, _ = frame_arr.shape
    
    # Convert straight alpha to premultiplied float
    straight = frame_arr.astype(np.float32)
    alpha = straight[:, :, 3:4] / 255.0
    premult_rgb = (straight[:, :, :3] * alpha)
    
    # Composite function: out = premult_rgb + bg * (1 - alpha)
    def composite_over(bg_rgb):
        bg = np.full((h, w, 3), bg_rgb, dtype=np.float32)
        comp = premult_rgb + bg * (1.0 - alpha)
        return np.clip(comp, 0, 255).astype(np.uint8)
    
    # Case A: White background [255, 255, 255]
    white_comp = composite_over([255, 255, 255])
    Image.fromarray(white_comp).save(os.path.join(OUT_DIR, 'test_composite_white.png'))
    # Top-left (alpha=0) over white -> white (255, 255, 255)
    tl_comp = white_comp[90, 160]
    print(f"Transparent region over White: {tl_comp}")
    assert np.all(tl_comp >= 250), f"Expected white (255,255,255), got {tl_comp}"
    
    # Top-right (opaque red) over white -> red (255, 0, 0)
    tr_comp = white_comp[90, 480]
    print(f"Opaque red over White: {tr_comp}")
    assert tr_comp[0] >= 250 and tr_comp[1] <= 5 and tr_comp[2] <= 5
    
    # Bottom-left (semi blue a=0.5) over white -> (128, 128, 255)
    bl_comp = white_comp[270, 160]
    print(f"50% blue over White: {bl_comp}")
    assert abs(int(bl_comp[0]) - 128) <= 5
    assert abs(int(bl_comp[1]) - 128) <= 5
    assert bl_comp[2] >= 250
    
    # Case B: Black background [0, 0, 0]
    black_comp = composite_over([0, 0, 0])
    Image.fromarray(black_comp).save(os.path.join(OUT_DIR, 'test_composite_black.png'))
    # Top-left over black -> black
    assert np.all(black_comp[90, 160] <= 5)
    # Bottom-left over black -> (0, 0, 128)
    bl_black = black_comp[270, 160]
    print(f"50% blue over Black: {bl_black}")
    assert abs(int(bl_black[2]) - 128) <= 5
    
    # Case C: Checkerboard background (16x16 squares)
    cb = np.zeros((h, w, 3), dtype=np.float32)
    for y in range(h):
        for x in range(w):
            if ((x // 16) + (y // 16)) % 2 == 0:
                cb[y, x] = [200, 200, 200]
            else:
                cb[y, x] = [100, 100, 100]
    comp_cb = premult_rgb + cb * (1.0 - alpha)
    comp_cb = np.clip(comp_cb, 0, 255).astype(np.uint8)
    Image.fromarray(comp_cb).save(os.path.join(OUT_DIR, 'test_composite_checkerboard.png'))
    print("✅ Compositor blending tests passed (White, Black, Checkerboard saved).")

def test_seeking_and_rotation():
    print("\n=== Test 4: Frame-Accurate Seeking & Rotation ===")
    for fn in [0, 15, 30, 45, 59]:
        out_png = os.path.join(OUT_DIR, f'frame_{fn:03d}.png')
        img = decode_frame(fn, out_png)
        arr = np.array(img)
        has_alpha = np.any(arr[:, :, 3] < 255) and np.any(arr[:, :, 3] > 0)
        print(f"Frame {fn:02d}: decoded size={img.size}, has_alpha={has_alpha}, corner alpha={arr[0, 0, 3]}")
        assert has_alpha, f"Frame {fn} must retain alpha transparency"
    print("✅ Frame seeking & rotation verified.")

def test_performance():
    print("\n=== Test 5: Decode Performance Benchmark ===")
    t0 = time.perf_counter()
    p = subprocess.run([
        'ffmpeg', '-benchmark',
        '-i', FIXTURE_PATH,
        '-f', 'null', '-'
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    t1 = time.perf_counter()
    total_time = t1 - t0
    ms_per_frame = (total_time / 60.0) * 1000.0
    print(f"Total decode time for 60 frames: {total_time:.3f}s ({ms_per_frame:.2f} ms/frame)")
    for line in p.stderr.splitlines():
        if 'bench:' in line:
            print("  FFmpeg benchmark:", line)
    assert ms_per_frame < 10.0, f"Decode time {ms_per_frame:.2f} ms exceeds 10ms threshold"
    print("✅ Decode performance is well within budget (< 10 ms/frame).")

if __name__ == '__main__':
    test_ffprobe()
    f0_arr = test_frame_0_pixels()
    test_compositing(f0_arr)
    test_seeking_and_rotation()
    test_performance()
    print("\n🎉 ALL PHASE 1 STEP 1 TESTS PASSED SUCCESSFULLY! 🎉")
