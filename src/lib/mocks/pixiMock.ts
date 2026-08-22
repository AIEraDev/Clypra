/**
 * Lightweight mock for legacy Pixi imports in external engine dependencies.
 * Pixi is no longer used in Clypra.
 */

export class Filter {}
export class GodrayFilter extends Filter {}
export class ColorGradientFilter extends Filter {}
export class ColorOverlayFilter extends Filter {}
export class HslAdjustmentFilter extends Filter {}
export class AlphaFilter extends Filter {}
export class ColorMatrixFilter extends Filter {}
export class GlowFilter extends Filter {}
export class RGBSplitFilter extends Filter {}
export class GlitchFilter extends Filter {}
export class CRTFilter extends Filter {}
export class NoiseFilter extends Filter {}
export class TiltShiftFilter extends Filter {}
export class MotionBlurFilter extends Filter {}
export class BlurFilter extends Filter {}
export class KawaseBlurFilter extends Filter {}
export class ZoomBlurFilter extends Filter {}
export class RadialBlurFilter extends Filter {}
export class DropShadowFilter extends Filter {}
export class OldFilmFilter extends Filter {}
export class ShockwaveFilter extends Filter {}
export class BulgePinchFilter extends Filter {}
export class TwistFilter extends Filter {}
export class ReflectionFilter extends Filter {}
export class DisplacementFilter extends Filter {}
export class OutlineFilter extends Filter {}
export class GrayscaleFilter extends Filter {}
export class DotFilter extends Filter {}
export class EmbossFilter extends Filter {}
export class CrossHatchFilter extends Filter {}
export class PixelateFilter extends Filter {}
export class AsciiFilter extends Filter {}
export class VideoSource {}

export class Container {
  addChild(): void {}
  removeChild(): void {}
  destroy(): void {}
  position = { set(): void {} };
  scale = { set(): void {} };
}

export class Graphics extends Container {
  clear(): this {
    return this;
  }
  rect(): this {
    return this;
  }
  fill(): this {
    return this;
  }
  stroke(): this {
    return this;
  }
  drawRect(): this {
    return this;
  }
  beginFill(): this {
    return this;
  }
  endFill(): this {
    return this;
  }
  lineStyle(): this {
    return this;
  }
}

export class Sprite extends Container {}

export const Texture = {
  from(): Record<string, unknown> {
    return {};
  },
};

export class Application {
  stage = new Container();
  renderer = { resize(): void {} };
  destroy(): void {}
}

export default {
  Filter,
  Container,
  Graphics,
  Sprite,
  Texture,
  Application,
};
