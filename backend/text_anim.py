
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Easing (ported 1:1 from canvas.js `Easing`) ─────────────────────────────
class Easing:
    @staticmethod
    def linear(t):
        return t

    @staticmethod
    def ease_out_cubic(t):
        return 1 - (1 - t) ** 3

    @staticmethod
    def ease_out_expo(t):
        return 1.0 if t == 1 else 1 - 2 ** (-10 * t)

    @staticmethod
    def ease_out_back(t, overshoot=1.7):
        c1 = overshoot
        c3 = c1 + 1
        x = t - 1
        return 1 + c3 * x ** 3 + c1 * x ** 2


_FONT_WARNED = False

def load_narration_font(size):
    """
    Load a monospace font at `size`, trying Windows/Linux/macOS locations.
    PIL's bitmap default font IGNORES the size argument, so falling back to it
    produces tiny unreadable text in rendered frames — warn loudly if we must.
    """
    global _FONT_WARNED
    candidates = (
        "consola.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/cour.ttf",
        "DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
        "/Library/Fonts/Courier New.ttf",
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    # Pillow >= 9.2 can scale its packaged default font.
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        pass
    if not _FONT_WARNED:
        _FONT_WARNED = True
        import sys
        print(
            "[text_anim] WARNING: no scalable monospace font found — falling "
            "back to PIL's bitmap default, which ignores font size. Rendered "
            "text will be tiny. Install DejaVu Sans Mono (or Consolas).",
            file=sys.stderr,
        )
    return ImageFont.load_default()


# ── Layout (ported 1:1 from canvas.js `_layoutNarrationText`) ──────────────
# ⚠ SYNC CONTRACT: this function MUST stay behaviourally identical to
# `_layoutNarrationText` in frontend/canvas.js. If either side changes, port
# the change to the other. Parameters that must match: word-wrap threshold
# (space + word > max_width), per-char x offsets, global word/char indices,
# and line y = index * line_height. The wrap width itself is derived in
# render_narration_frame as canvas_w * 0.88 * scale_x (canvas.js: baseMaxW*sx).
def layout_narration_text(font, text, max_width, line_height):
    # Split on paragraphs (hard line breaks) first, then wrap words within each
    paragraphs = text.split('\n')
    space_width = font.getlength(' ')

    lines = []
    g_word = 0
    g_char = 0

    for para in paragraphs:
        words_raw = para.split(' ')
        current_line = []
        current_width = 0.0

        for word in words_raw:
            width = font.getlength(word)
            if current_line and current_width + space_width + width > max_width:
                lines.append(current_line)
                current_line = []
                current_width = 0.0

            chars = []
            cx = 0.0
            for ch in word:
                cw = font.getlength(ch)
                chars.append({"char": ch, "x": cx, "width": cw, "global_index": g_char})
                g_char += 1
                cx += cw

            current_line.append({
                "text": word, "width": width, "chars": chars, "global_index": g_word
            })
            g_word += 1
            current_width += (space_width if len(current_line) > 1 else 0) + width

        if current_line:
            lines.append(current_line)

    out_lines = []
    for li, line in enumerate(lines):
        x = 0.0
        out_words = []
        for wi, word in enumerate(line):
            if wi > 0:
                x += space_width
            w = dict(word)
            w["x"] = x
            x += word["width"]
            out_words.append(w)
        out_lines.append({"words": out_words, "y": li * line_height, "line_width": x})

    return {"lines": out_lines, "line_height": line_height}


def _font_scaled_variant(font, scale):
    if scale == 1.0:
        return font
    if not hasattr(font, 'font_variant') or not hasattr(font, 'size'):
        return None
    try:
        size = max(1, int(round(font.size * scale)))
        if size == font.size:
            return font
        return font.font_variant(size=size)
    except Exception:
        return None


def _to_rgb(color):
    """Accept '#rrggbb' strings or (r,g,b) tuples; return an (r,g,b) tuple."""
    if isinstance(color, str):
        c = color.lstrip('#')
        if len(c) == 3:
            c = ''.join(ch * 2 for ch in c)
        try:
            return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            return (255, 255, 255)
    return tuple(color)


def draw_narration_text(draw_target, text, font, x, y, color, params=None, alpha=1.0):
    """
    Single source of truth for narration text drawing: shadow -> stroke -> fill.
    Mirrors canvas.js _drawNarrationText. Used directly by static/linescan;
    typewriter/wordblurin apply the same order inside _draw_text_transformed,
    since those need scale/blur baked into an intermediate glyph image.
    """
    params = params or {}
    text = text.replace('\n', '').replace('\r', '')
    if not text:
        return

    a = int(max(0.0, min(1.0, alpha)) * 255)
    color = _to_rgb(color)

    shadow = params.get("text_shadow")
    if shadow and shadow.get("color"):
        sx = x + shadow.get("x", 0)
        sy = y + shadow.get("y", 0)
        shadow_alpha = int(a * shadow.get("opacity", 1.0))
        draw_target.text((sx, sy), text, font=font, fill=(*_to_rgb(shadow["color"]), shadow_alpha), anchor="la")

    stroke = params.get("text_stroke")
    stroke_color = stroke.get("color") if stroke else None
    stroke_width = stroke.get("width", 0) if stroke else 0

    if stroke_color and stroke_width > 0:
        draw_target.text(
            (x, y),
            text,
            font=font,
            fill=(*color, a),
            anchor="la",
            stroke_width=int(stroke_width),
            stroke_fill=(*_to_rgb(stroke_color), a)
        )
    else:
        draw_target.text(
            (x, y),
            text,
            font=font,
            fill=(*color, a),
            anchor="la"
        )


# ── Low-level transformed glyph/word draw (mirrors ctx.translate+scale+fillText) ─
def _draw_text_transformed(
    base_img,
    text,
    font,
    cx,
    cy,
    scale,
    alpha,
    color,
    blur=0.0,
    params=None
):
    params = params or {}

    text = text.replace('\n', '').replace('\r', '')
    if alpha <= 0.003 or not text:
        return

    draw_font = font
    scaled_font = None
    if scale != 1.0:
        scaled_font = _font_scaled_variant(font, scale)
        if scaled_font is not None:
            draw_font = scaled_font

    base_w = font.getlength(text)        # advance width, matches layout positions
    w = draw_font.getlength(text)
    ascent, descent = draw_font.getmetrics()  # constant per font — no per-glyph jitter
    h = ascent + descent
    if w <= 0 or h <= 0:
        return

    pad = 4
    glyph = Image.new("RGBA", (math.ceil(w) + pad * 2, h + pad * 2), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyph)

    a = int(max(0.0, min(1.0, alpha)) * 255)
    color = _to_rgb(color)

    shadow = params.get("text_shadow")
    if shadow and shadow.get("color"):
        sx = pad + shadow.get("x", 0)
        sy = pad + shadow.get("y", 0)
        shadow_alpha = int(a * shadow.get("opacity", 1.0))
        gd.text(
            (sx, sy),
            text,
            font=draw_font,
            fill=(*_to_rgb(shadow["color"]), shadow_alpha),
            anchor="la"
        )

    stroke = params.get("text_stroke")
    stroke_color = stroke.get("color") if stroke else None
    stroke_width = stroke.get("width", 0) if stroke else 0

    if stroke_color and stroke_width > 0:
        gd.text(
            (pad, pad),
            text,
            font=draw_font,
            fill=(*color, a),
            anchor="la",
            stroke_width=int(stroke_width),
            stroke_fill=(*_to_rgb(stroke_color), a)
        )
    else:
        gd.text(
            (pad, pad),
            text,
            font=draw_font,
            fill=(*color, a),
            anchor="la"
        )

    if scale != 1.0 and scaled_font is None:
        nw = max(1, round(glyph.width * scale))
        nh = max(1, round(glyph.height * scale))
        glyph = glyph.resize((nw, nh), Image.Resampling.LANCZOS)
        left = cx - (base_w * scale) / 2 - pad * scale
        top = cy - pad * scale
    else:
        left = cx - (base_w * scale) / 2 - pad
        top = cy - pad

    if blur and blur > 0.3:
        glyph = glyph.filter(ImageFilter.GaussianBlur(blur))

    base_img.alpha_composite(glyph, (round(left), round(top)))


def render_narration_static(base_img, layout, ox, oy, font, color, params=None):
    draw = ImageDraw.Draw(base_img)

    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            draw_narration_text(
                draw,
                word["text"],
                font,
                line_ox + word["x"],
                oy + line["y"],
                color,
                params
            )


def render_narration_typewriter(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    ms_per_char = 1000 / params.get("text_chars_per_second", 26)
    pop_ms = params.get("text_pop_duration_ms", 90)

    last_x, last_y = ox, oy
    last_h = layout["line_height"] * 0.78
    all_done = True

    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            for ch in word["chars"]:
                reveal_at = ch["global_index"] * ms_per_char
                local_t = elapsed_ms - reveal_at
                if local_t < 0:
                    all_done = False
                    continue
                pop_t = min(1.0, local_t / pop_ms)
                scale = 0.4 + 0.6 * max(0.0, Easing.ease_out_back(pop_t, 1.2))
                alpha = min(1.0, local_t / (pop_ms * 0.6))
                cx = line_ox + word["x"] + ch["x"] + ch["width"] / 2
                cy = oy + line["y"]
                _draw_text_transformed(
                    base_img,
                    ch["char"],
                    font,
                    cx,
                    cy,
                    scale,
                    alpha,
                    color,
                    params=params
                )
                last_x = line_ox + word["x"] + ch["x"] + ch["width"]
                last_y = oy + line["y"]

    if not all_done:
        blink_on = int((elapsed_ms / 1000) * 2) % 2 == 0
        if blink_on:
            draw = ImageDraw.Draw(base_img)
            cursor_color = color
            draw.rectangle(
                [last_x + 2, last_y, last_x + 2 + 3, last_y + last_h],
                fill=(*cursor_color, 255),
            )


def render_narration_wordblurin(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    stagger = params.get("text_stagger_ms", 60)
    dur = params.get("text_duration_ms", 550)
    max_blur = params.get("text_max_blur", 14)
    rise = params.get("text_rise_distance", 22)

    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            start_time = word["global_index"] * stagger
            local_t = elapsed_ms - start_time
            if local_t < 0:
                continue
            t = max(0.0, min(1.0, local_t / dur))
            clear_t = Easing.ease_out_cubic(min(1.0, t * 1.6))
            spring_t = Easing.ease_out_back(t, 1.4)
            blur = max_blur * (1 - clear_t)
            alpha = min(1.0, t * 2.2)
            y_offset = rise * (1 - spring_t)
            scale = 0.85 + 0.15 * spring_t

            wx = line_ox + word["x"] + word["width"] / 2
            wy = oy + line["y"] + y_offset
            _draw_text_transformed(
                base_img,
                word["text"],
                font,
                wx,
                wy,
                scale,
                alpha,
                color,
                blur=blur,
                params=params
            )


def render_narration_linescan(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    dur = params.get("text_duration_ms", 550)
    stagger = params.get("text_line_stagger_ms", 140)
    slide_dist = params.get("text_slide_distance", 90)
    sweep_width = params.get("text_sweep_width", 140)

    draw = ImageDraw.Draw(base_img)

    for li, line in enumerate(layout["lines"]):
        start_time = li * stagger
        local_t = elapsed_ms - start_time
        if local_t < 0:
            continue
        t = max(0.0, min(1.0, local_t / dur))
        eased = Easing.ease_out_expo(t)
        x_offset = -slide_dist * (1 - eased)
        alpha = min(1.0, t * 3)
        line_x = ox - line["line_width"] / 2 + x_offset
        # Defensive: strip any embedded newlines from each word before joining
        line_text = " ".join(w["text"].replace('\n', '').replace('\r', '') for w in line["words"])

        # Base draw now goes through the shared helper — shadow/stroke/fill,
        # same order and same colour resolution as every other style.
        draw_narration_text(draw, line_text, font, line_x, oy + line["y"], color, params, alpha)

        # Sweep highlight (approximation — soft bright band crossing the line as it settles)
        if t < 0.9 and line["line_width"] > 0:
            sweep_t = Easing.ease_out_cubic(min(1.0, t / 0.75))
            lw = int(line["line_width"]) + 20
            lh = int(layout["line_height"]) + 4
            band = Image.new("L", (lw, lh), 0)
            bd = ImageDraw.Draw(band)
            bd.text((0, 0), line_text, font=font, fill=255, anchor="la")

            sweep_x = -sweep_width + sweep_t * (line["line_width"] + sweep_width * 2)
            grad = Image.new("L", (lw, lh), 0)
            gd = ImageDraw.Draw(grad)
            for gx in range(lw):
                d = abs(gx - sweep_x)
                v = max(0, 255 - int(255 * (d / (sweep_width / 2))))
                gd.line([(gx, 0), (gx, lh)], fill=v)

            highlight_mask = Image.composite(
                grad, Image.new("L", (lw, lh), 0), band
            )
            highlight = Image.new("RGBA", (lw, lh), (*color, 0))
            highlight.putalpha(Image.eval(highlight_mask, lambda v: int(v * alpha)))
            base_img.alpha_composite(highlight, (round(line_x), round(oy + line["y"])))


def _render_static_alpha(base_img, layout, ox, oy, font, color, params, alpha):
    """Static layout drawn at a uniform alpha (helper for fade/slideup/glitch)."""
    draw = ImageDraw.Draw(base_img)
    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            draw_narration_text(
                draw, word["text"], font,
                line_ox + word["x"], oy + line["y"],
                color, params, alpha,
            )


def render_narration_fade(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    # canvas.js _renderNarrationFadeIn
    dur = params.get("text_duration_ms", 550)
    t = max(0.0, min(1.0, elapsed_ms / dur))
    _render_static_alpha(base_img, layout, ox, oy, font, color, params,
                         Easing.ease_out_cubic(t))


def render_narration_slideup(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    # canvas.js _renderNarrationSlideUp
    dur = params.get("text_duration_ms", 550)
    rise = params.get("text_rise_distance", 36)
    t = max(0.0, min(1.0, elapsed_ms / dur))
    eased = Easing.ease_out_cubic(t)
    _render_static_alpha(
        base_img, layout, ox, oy - rise * (1 - eased),
        font, color, params, min(1.0, t * 1.6),
    )


def render_narration_scalepop(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    # canvas.js _renderNarrationScalePop — uniform scale about (ox, oy).
    dur = params.get("text_duration_ms", 550)
    t = max(0.0, min(1.0, elapsed_ms / dur))
    scale = 0.6 + 0.4 * max(0.0, Easing.ease_out_back(t, 1.7))
    alpha = min(1.0, t * 2)
    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            # word centre in unscaled space, then scaled about the anchor
            wx = line_ox + word["x"] + word["width"] / 2
            wy = oy + line["y"]
            sx = ox + (wx - ox) * scale
            sy = oy + (wy - oy) * scale
            _draw_text_transformed(
                base_img, word["text"], font, sx, sy,
                scale, alpha, color, params=params,
            )


def render_narration_charstagger(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    # canvas.js _renderNarrationCharStagger
    stagger = params.get("text_stagger_ms", 25)
    dur = params.get("text_duration_ms", 300)
    rise = params.get("text_rise_distance", 14)
    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            for ch in word["chars"]:
                local_t = elapsed_ms - ch["global_index"] * stagger
                if local_t <= 0:
                    continue
                t = max(0.0, min(1.0, local_t / dur))
                y_offset = rise * (1 - Easing.ease_out_back(t, 1.5))
                cx = line_ox + word["x"] + ch["x"] + ch["width"] / 2
                cy = oy + line["y"] + y_offset
                _draw_text_transformed(
                    base_img, ch["char"], font, cx, cy,
                    1.0, min(1.0, t * 2.2), color, params=params,
                )


def render_narration_glitch(base_img, layout, ox, oy, elapsed_ms, params, font, color):
    # canvas.js _renderNarrationGlitch — same pseudo-random jitter/flicker.
    dur = params.get("text_duration_ms", 500)
    t = max(0.0, min(1.0, elapsed_ms / dur))
    if t >= 1.0:
        render_narration_static(base_img, layout, ox, oy, font, color, params)
        return
    decay = 1 - Easing.ease_out_cubic(t)
    seed = int(elapsed_ms // 60)

    def jitter(n):
        x = math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
        return (x - math.floor(x)) * 2 - 1

    max_offset = 6 * decay
    flicker = 0.3 if jitter(9) > 0.6 else 1.0
    _render_static_alpha(
        base_img, layout,
        ox + max_offset * jitter(1),
        oy + max_offset * jitter(2) * 0.4,
        font, color, params, flicker,
    )


ANIM_RENDERERS = {
    "typewriter": render_narration_typewriter,
    "wordblurin": render_narration_wordblurin,
    "wordblur": render_narration_wordblurin,  # alias — Advanced Text modal id (#66)
    "linescan": render_narration_linescan,
    "fade": render_narration_fade,
    "slideup": render_narration_slideup,
    "scalepop": render_narration_scalepop,
    "charstagger": render_narration_charstagger,
    "glitch": render_narration_glitch,
}


def render_narration_frame(text, style, elapsed_ms, params, canvas_w, x_norm, font_size,
                            padding_top, padding_bottom, color=(255, 255, 255), scale_x=1.0):
    """
    Renders one frame of a narration clip onto a full-width transparent RGBA
    image. Returns the PIL Image; caller positions it at (0, y*CANVAS_H - padding_top).
    """
    font = load_narration_font(font_size)
    color = _to_rgb(color)  # accept '#rrggbb' from clip dicts as well as tuples

    # wrap width now respects scale_x, mirroring canvas.js's baseMaxW * sx.
    # ratio corrected from 0.85 -> 0.88 to match canvas.js exactly — this was
    # a second, pre-existing mismatch independent of resize/scale.
    base_max_width = int(canvas_w * 0.88)
    max_width = int(base_max_width * scale_x)
    line_height = font_size * 1.4

    layout = layout_narration_text(font, text, max_width, line_height)

    block_h = len(layout["lines"]) * line_height
    img_h = int(block_h + padding_top + padding_bottom)
    img = Image.new("RGBA", (canvas_w, max(1, img_h)), (0, 0, 0, 0))

    ox = canvas_w * x_norm
    oy = padding_top

    if not style or style == "static":
        render_narration_static(img, layout, ox, oy, font, color, params)
    else:
        renderer = ANIM_RENDERERS.get(style, render_narration_static)
        if renderer is render_narration_static:
            renderer(img, layout, ox, oy, font, color, params)
        else:
            renderer(img, layout, ox, oy, elapsed_ms, params, font, color)

    return img