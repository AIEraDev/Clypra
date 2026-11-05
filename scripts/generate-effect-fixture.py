#!/usr/bin/env python3
"""
Generate synthetic ProRes 4444 test fixture with alpha channel.
Specification:
- Resolution: 640x360 (quarter HD)
- Frame rate: 30 FPS
- Duration: 60 frames (2.0 seconds)
- Codec: Apple ProRes 4444 (prores_ks, profile 4444, yuva444p10le)
- Alpha mode: Straight alpha (NOT premultiplied) in source
- Color space: Rec.709 (bt709)
- Quadrants:
  1. Top-Left: Transparent (alpha = 0, RGB = 0, 0, 0)
  2. Top-Right: Opaque pure red (alpha = 255, RGB = 255, 0, 0)
  3. Bottom-Left: Semitransparent pure blue (alpha = 128, RGB = 0, 0, 255)
  4. Bottom-Right: Gradient pure green (alpha 0->255, RGB = 0, 255, 0)
- Diagonal edge: 1-pixel white line at 45 degrees
- Animated geometry: Rotate frame 360 degrees over 60 frames (6 deg/frame)
"""

import os
import sys
import shutil
import subprocess
import numpy as np
from PIL import Image, ImageDraw

WIDTH = 640
HEIGHT = 360
FPS = 30
DURATION_SEC = 2
TOTAL_FRAMES = FPS * DURATION_SEC  # 60 frames

def create_base_frame():
    """Create the unrotated base frame (frame 0) with straight alpha."""
    arr = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    
    # 1. Top-Left: Transparent (alpha=0)
    arr[0:180, 0:320] = [0, 0, 0, 0]
    
    # 2. Top-Right: Opaque pure red (alpha=255)
    arr[0:180, 320:640] = [255, 0, 0, 255]
    
    # 3. Bottom-Left: Semitransparent pure blue (alpha=128) - STRAIGHT alpha
    arr[180:360, 0:320] = [0, 0, 255, 128]
    
    # 4. Bottom-Right: Gradient pure green (alpha 0 -> 255) - STRAIGHT alpha
    for x in range(320, 640):
        alpha = int(round(255.0 * (x - 320) / (320 - 1)))
        arr[180:360, x] = [0, 255, 0, alpha]
        
    img = Image.fromarray(arr, 'RGBA')
    
    # 5. Diagonal edge: 1-pixel white line at 45 degrees passing through center (320, 180)
    # y - 180 = x - 320 -> x - y = 140. At y=0, x=140. At y=360, x=500.
    draw = ImageDraw.Draw(img)
    draw.line([(140, 0), (500, 360)], fill=(255, 255, 255, 255), width=1)
    
    return img

def generate_fixture(output_path):
    print(f"Generating synthetic ProRes 4444 fixture: {output_path}")
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    base_frame = create_base_frame()
    center = (WIDTH // 2, HEIGHT // 2)
    
    cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', f'{WIDTH}x{HEIGHT}',
        '-pix_fmt', 'rgba',
        '-r', str(FPS),
        '-i', '-',
        '-c:v', 'prores_ks',
        '-profile:v', '4444',
        '-pix_fmt', 'yuva444p10le',
        '-vendor', 'appl',
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-frames:v', str(TOTAL_FRAMES),
        '-movflags', '+faststart',
        output_path
    ]
    
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    for frame_idx in range(TOTAL_FRAMES):
        if frame_idx == 0:
            frame_img = base_frame
        else:
            # Rotate clockwise by frame_idx * 6.0 degrees
            angle = frame_idx * (360.0 / TOTAL_FRAMES)
            frame_img = base_frame.rotate(-angle, resample=Image.Resampling.BILINEAR, center=center, fillcolor=(0, 0, 0, 0))
            
        raw_bytes = frame_img.tobytes()
        proc.stdin.write(raw_bytes)
        
    stdout, stderr = proc.communicate()
    if proc.returncode != 0:
        print("FFmpeg encoding failed:", stderr.decode(), file=sys.stderr)
        sys.exit(proc.returncode)
        
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Successfully generated {output_path} ({size_mb:.2f} MB, {TOTAL_FRAMES} frames)")

if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, '..', '..'))
    
    target_primary = os.path.join(repo_root, 'test-effect-fixture.mov')
    target_fixtures = os.path.join(repo_root, 'clypra', 'tests', 'fixtures', 'test-effect-fixture.mov')
    target_clypra_fixtures = os.path.join(repo_root, 'clypra', 'fixtures', 'test-effect-fixture.mov')
    
    generate_fixture(target_primary)
    
    # Also replicate to tests/fixtures and clypra/fixtures for test discovery
    for copy_dest in [target_fixtures, target_clypra_fixtures]:
        os.makedirs(os.path.dirname(copy_dest), exist_ok=True)
        shutil.copyfile(target_primary, copy_dest)
        print(f"Copied to {copy_dest}")
