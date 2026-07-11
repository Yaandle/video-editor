"""
Frame-accurate port of canvas.js narration text animations
(typewriter / wordblurin / linescan) for the moviepy renderer.

Mirrors: _layoutNarrationText, _renderNarrationStatic,
_renderNarrationTypewriter, _renderNarrationWordBlurIn,
_renderNarrationLineScan in frontend/canvas.js
"""
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


def load_narration_font(size):
    for path in ("consola.ttf", "C:/Windows/Fonts/consola.ttf", "DejaVuSansMono.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


# ── Layout (ported 1:1 from canvas.js `_layoutNarrationText`) ──────────────
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


# ── Low-level transformed glyph/word draw (mirrors ctx.translate+scale+fillText) ─
def _draw_text_transformed(base_img, text, font, cx, cy, scale, alpha, color, blur=0.0):
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
    gd.text((pad, pad), text, font=draw_font, fill=(*color, a), anchor="la")

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


def render_narration_static(base_img, layout, ox, oy, font, color):
    draw = ImageDraw.Draw(base_img)
    for line in layout["lines"]:
        line_ox = ox - line["line_width"] / 2
        for word in line["words"]:
            # Defensive: strip any embedded newlines before drawing
            word_text = word["text"].replace('\n', '').replace('\r', '')
            draw.text((line_ox + word["x"], oy + line["y"]), word_text,
                      font=font, fill=(*color, 255), anchor="la")


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
                _draw_text_transformed(base_img, ch["char"], font, cx, cy, scale, alpha, color)
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
            _draw_text_transformed(base_img, word["text"], font, wx, wy, scale, alpha, color, blur=blur)


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

        a = int(max(0.0, min(1.0, alpha)) * 255)
        draw.text((line_x, oy + line["y"]), line_text, font=font, fill=(*color, a), anchor="la")

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


ANIM_RENDERERS = {
    "typewriter": render_narration_typewriter,
    "wordblurin": render_narration_wordblurin,
    "linescan": render_narration_linescan,
}


def render_narration_frame(text, style, elapsed_ms, params, canvas_w, x_norm, font_size,
                            padding_top, padding_bottom, color=(255, 255, 255), scale_x=1.0):
    """
    Renders one frame of a narration clip onto a full-width transparent RGBA
    image. Returns the PIL Image; caller positions it at (0, y*CANVAS_H - padding_top).
    """
    font = load_narration_font(font_size)

    # wrap width now respects scale_x, mirroring canvas.js's baseMaxW * sx.
    # ratio corrected from 0.85 -> 0.88 to match canvas.js exactly — this was
    # a second, pre-existing mismatch independent of resize/scale.
    base_max_width = int(canvas_w * 0.88)
    max_width = int(base_max_width * scale_x)
    line_height = font_size * 1.4

    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    layout = layout_narration_text(font, text, max_width, line_height)

    block_h = len(layout["lines"]) * line_height
    img_h = int(block_h + padding_top + padding_bottom)
    img = Image.new("RGBA", (canvas_w, max(1, img_h)), (0, 0, 0, 0))

    ox = canvas_w * x_norm
    oy = padding_top

    if not style or style == "static":
        render_narration_static(img, layout, ox, oy, font, color)
    else:
        renderer = ANIM_RENDERERS.get(style, render_narration_static)
        if renderer is render_narration_static:
            renderer(img, layout, ox, oy, font, color)
        else:
            renderer(img, layout, ox, oy, elapsed_ms, params, font, color)

    return img