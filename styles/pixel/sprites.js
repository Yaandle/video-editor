// sprites.js — sprite sheets and tiles drawn for this pack, as rows of PICO-8
// palette indices (0–f) with '.' for transparent. Frames of one sprite share
// a size. Drawn with fillRect on whole native pixels only.

export const SPRITES = {
  coin: {
    fps: 4,   // frames per beat when spinning
    frames: [
      ['..9999..', '.9aaaa9.', '9aa7aaa9', '9aa7aaa9', '9aa7aaa9', '9aaaaaa9', '.9aaaa9.', '..9999..'],
      ['...99...', '..9aa9..', '..9a79..', '..9a79..', '..9a79..', '..9aa9..', '..9aa9..', '...99...'],
      ['...99...', '...99...', '...99...', '...99...', '...99...', '...99...', '...99...', '...99...'],
      ['...99...', '..9aa9..', '..97a9..', '..97a9..', '..97a9..', '..9aa9..', '..9aa9..', '...99...'],
    ],
  },
  heart: {
    fps: 1,
    frames: [['.88...88.', '8ee8.8888', '8e8888888', '888888888', '.8888888.', '..88888..', '...888...', '....8....']],
  },
  star: {
    fps: 1,
    frames: [['....a....', '....a....', '...aaa...', 'aaaaaaaaa', '.aaaaaaa.', '..aaaaa..', '..aa.aa..', '.aa...aa.', '.a.....a.']],
  },
  player: {
    fps: 2,   // walk cycle: two frames per beat
    frames: [
      ['...7777...', '..777777..', '..7c77c7..', '..777777..', '...7777...', '..888888..', '.88888888.', '.8.8888.8.', '...8888...', '...c..c...', '...c..c...', '..cc..cc..'],
      ['...7777...', '..777777..', '..7c77c7..', '..777777..', '...7777...', '..888888..', '.88888888.', '.8.8888.8.', '...8888...', '...c..c...', '..c....c..', '.cc....cc.'],
    ],
  },
};

export const TILES = {
  brick: ['44444445', '44444445', '55555555', '44445444', '44445444', '55555555', '44444445', '44444445'],
  ground: ['bbbbbbbb', '3b3bb3b3', '44444444', '44544444', '44444454', '44444444', '45444444', '44444444'],
  dirt: ['44444444', '44544444', '44444454', '44444444', '45444444', '44444444', '44444544', '44444444'],
  cloud: ['.....7777.......', '...77777777.....', '.7777777777777..', '777777777777777.', '6777777777777776', '.66666666666666.'],
};

/** Draw rows of palette indices at (x, y) with `u` ctx units per sprite pixel. */
export function blit(ctx, rows, x, y, u, palette, flip = false, remap = null) {
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry];
    for (let rx = 0; rx < row.length; rx++) {
      const c = row[flip ? row.length - 1 - rx : rx];
      if (c === '.') continue;
      const i = parseInt(c, 16);
      ctx.fillStyle = palette[remap?.[i] ?? i];
      ctx.fillRect(x + rx * u, y + ry * u, u, u);
    }
  }
}
