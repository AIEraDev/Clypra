# Clypra Mathematical Precision & System Invariants

This document specifies the exact mathematical formulas, coordinate spaces, frame rate handling, audio sample mapping, and snapping precision implemented across Clypra (TypeScript frontend and Rust native backend).

---

## 1. Timeline Coordinates & Snapping Invariants

### 1.1 Time-to-Pixel and Pixel-to-Time Conversion
Timeline time $t$ (seconds) and screen-space horizontal coordinates $x$ (pixels) are converted using canonical linear mapping:

$$x = \text{timeToPixel}(t, \text{PPS}) = \operatorname{round}(t \times \text{PPS})$$
$$t = \text{pixelToTime}(x, \text{PPS}) = \frac{x}{\text{PPS}}$$

- **Invariant**: Clip widths, preview widths, and indicator widths MUST be computed as:
  $$\text{widthPx} = \text{timeToPixel}(t_{\text{end}}, \text{PPS}) - \text{timeToPixel}(t_{\text{start}}, \text{PPS})$$
  *(Never compute width directly from duration alone $\operatorname{round}(\text{duration} \times \text{PPS})$ as $\operatorname{round}(a+b) \neq \operatorname{round}(a) + \operatorname{round}(b)$).*

### 1.2 Zoom-Scaled Magnetic Snapping
Snapping thresholds are defined in **screen-space pixels** ($\text{SNAP\_PX} = 8\text{px}$) to maintain consistent physical feel across all zoom levels:

$$\text{snapThresholdSeconds} = \frac{\text{SNAP\_PX}}{\text{pixelsPerSecond}}$$

- **Overview Zoom ($10\text{ px/s}$)**: Snap window $= 8 / 10 = 0.8\text{s}$ ($8\text{px}$ screen radius).
- **Deep Zoom ($500\text{ px/s}$)**: Snap window $= 8 / 500 = 0.016\text{s}$ ($8\text{px}$ screen radius).

### 1.3 Playhead Visual Center Alignment
The playhead interactive touch target is $8\text{px}$ wide with container centering at $-4\text{px}$ (`marginLeft: "-4px"`). The visual line is centered at $50\%$ with transform $-50\%$, placing the rendered $2\text{px}$ playhead line exactly on the true coordinate pixel $x = \text{timeToPixel}(t, \text{PPS})$.

---

## 2. Audio Waveform Pipeline & Quantization

### 2.1 Integer Remainder Proportional Sample Mapping
To prevent trailing sample loss in waveform extraction (Rust FFmpeg decoder and WebAudio JS fallback), bucket sample boundaries are proportionally distributed across the total audio length:

$$\text{start}(i) = \left\lfloor \frac{i \times N_{\text{samples}}}{N_{\text{buckets}}} \right\rfloor, \quad \text{end}(i) = \min\left(N_{\text{samples}}, \left\lfloor \frac{(i + 1) \times N_{\text{samples}}}{N_{\text{buckets}}} \right\rfloor\right)$$

### 2.2 Hierarchical Level of Detail (LOD) Quantization
To eliminate cache misses during continuous zoom and avoid repeated FFmpeg subprocess execution:
$$N_{\text{buckets}}(\text{width}) = \begin{cases}
256 & \text{if } \text{width} / 1.5 \le 256 \\
512 & \text{if } \text{width} / 1.5 \le 512 \\
1024 & \text{if } \text{width} / 1.5 \le 1024 \\
2048 & \text{otherwise}
\end{cases}$$

---

## 3. Frame Rate & Timecode Precision

### 3.1 Project-Driven Frame Rate
All timecode, ruler formatting, frame export requests, and gap durations consume the project-defined frame rate:
$$\text{fps} = \text{project.frameRate} \mathbin{??} 30$$

### 3.2 Total-Frame Carried Timecode Formatting
To prevent rollover carry-over errors (e.g. displaying `00:59:00` at $t = 59.99\text{s}$):
1. Compute total frames from continuous time: $\text{totalFrames} = \operatorname{round}(t \times \text{fps})$
2. Derive total seconds from total frames: $\text{totalSeconds} = \lfloor \text{totalFrames} / \text{fps} \rfloor$
3. Derive fractional frame index: $\text{frames} = \text{totalFrames} \pmod{\text{fps}}$
4. Format: $\text{hours} = \lfloor \text{totalSecs} / 3600 \rfloor$, $\text{mins} = \lfloor (\text{totalSecs} \pmod{3600}) / 60 \rfloor$, $\text{secs} = \text{totalSecs} \pmod{60}$

---

## 4. Speed & Source Time Calculations

### 4.1 Playback Rate & Media Source Mapping
When a clip has variable playback speed:
$$\text{sourceDuration} = \text{trimOut} - \text{trimIn}$$
$$\text{timelineDuration} = \frac{\text{trimOut} - \text{trimIn}}{\text{clip.speed} \mathbin{??} 1.0}$$
$$\text{sourceTime}(t_{\text{timeline}}) = \text{clip.trimIn} + ((t_{\text{timeline}} - \text{clip.startTime}) \times (\text{clip.speed} \mathbin{??} 1.0))$$

### 4.2 Split Point Preservation
When splitting a speed-adjusted clip at timeline position $t_{\text{insert}}$:
$$\text{sourceSplit} = \text{clip.trimIn} + ((t_{\text{insert}} - \text{clip.startTime}) \times (\text{clip.speed} \mathbin{??} 1.0))$$
