/**
 * Lightweight mock for legacy Pixi imports in external engine dependencies.
 * Pixi is no longer used in Clypra.
 */

export class Filter {}

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
