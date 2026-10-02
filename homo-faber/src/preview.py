"""v3: Kontrollbilder + automatische Prüfung der Animationen (LibreOffice zeigt keine Animationen).
Setzt die Ebenen aus meta.json mit denselben Transformationen zusammen, die post2.py als OOXML schreibt:
Ken Burns (animScale), Pfade (animMotion), Drehung, Keyframe-Spuren (ppt_x/y/w/h + animRot), Orbits, Ein-/Ausblenden.
Ausgabe: qa/frames/sNN.jpg (0 % | 50 % | 100 %), qa/kontrollbilder_*.jpg, qa/report.txt
Prüft alle 100 ms: Werkzeug-Ebenen im Bild, keine Ebene (Alpha ≥ 0,35) in der Textzone, Ende ≤ advTm,
Carry-Startlage = Endlage der Vorfolie."""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

META = json.load(open('meta.json'))
SC = 0.5                         # Renderauflösung relativ zu 1920×1080
W, H = int(1920 * SC), int(1080 * SC)
PX = 144 * SC                    # px pro Zoll
ZONE = (0, int(706 * SC), int(1181 * SC), H)   # Textzone x<1181, y>706
ATH = int(0.35 * 255)
os.makedirs('qa/frames', exist_ok=True)

TOOLS = lambda n: n in ('icon', 'iconOff', 'iconBase', 'carry', 'carryOff') or n.startswith('!!') or n.startswith('vir')
FX_SKIP = {'sky', 'land', 'rays', 'clouds', 'disc', 'parts', 'bokeh', 'overlay', 'caveframe', 'flash', 'meteor', 'orb'}

_img = {}
def load(f):
    if f not in _img: _img[f] = Image.open(f).convert('RGBA')
    return _img[f]

def ease(u): return 2 * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 2 / 2
def interp(P, t):
    if t <= P[0][0]: return P[0][1]
    for (t0, v0), (t1, v1) in zip(P, P[1:]):
        if t <= t1: return v0 + (v1 - v0) * (t - t0) / ((t1 - t0) or 1)
    return P[-1][1]

def state(slide, name, t):
    """Transformation einer Ebene zur Zeit t: (dx, dy) px, Faktor sx, sy, Zusatzdrehung, Deckkraft"""
    dx = dy = 0.0; sx = sy = 1.0; dr = 0.0
    vis_ev = []
    for a in slide['anims']:
        if a['id'] != name: continue
        k = a['t']; d0 = a.get('delay', 0)
        if k in ('scale', 'move', 'spin'):
            D = a['dur']; rep = a.get('repeat') or 1; cyc = D * (2 if a.get('autoRev') else 1)
            tau = t - d0
            if tau <= 0: u = 0
            elif tau >= cyc * rep: u = 0 if a.get('autoRev') else 1
            else:
                q = tau % cyc; u = q / D if q < D else 2 - q / D
            if a.get('ease'): u = ease(u)
            if k == 'scale': sx *= 1 + (a['by'] - 1) * u; sy *= 1 + (a['by'] - 1) * u
            elif k == 'move': dx += a['dx'] * 1920 * SC * u; dy += a['dy'] * 1080 * SC * u
            else: dr += a['deg'] * u
        elif k == 'kf':
            P = a['props']; e = a['ref'] == 'end'
            ref = {p: (P[p][-1][1] if e else P[p][0][1]) for p in P}
            dx += (interp(P['x'], t) - ref['x']) * SC; dy += (interp(P['y'], t) - ref['y']) * SC
            sx *= interp(P['sx'], t) / ref['sx']; sy *= interp(P['sy'], t) / ref['sy']
            dr += interp(P['r'], t) - ref['r']
        elif k == 'orbit':
            A = math.radians(a['th'])
            def Pt(f): u, v = a['a'] * math.cos(f), a['b'] * math.sin(f); return (u * math.cos(A) - v * math.sin(A), u * math.sin(A) + v * math.cos(A))
            tt = min(max(t, a['t0']), a['t0'] + a['per'] * ((a['t1'] - a['t0']) / a['per']))
            f = a['phi0'] + 2 * math.pi * (tt - a['t0']) / a['per']
            p0, p1 = Pt(a['phi0']), Pt(f); dx += (p1[0] - p0[0]) * SC; dy += (p1[1] - p0[1]) * SC
        elif k in ('fadeIn', 'fadeOut', 'show', 'hide'):
            vis_ev.append(a)
    # Sichtbarkeit: verborgen, wenn das erste Ereignis ein Eingang ist
    vis_ev.sort(key=lambda a: a.get('delay', 0))
    op = 0.0 if vis_ev and vis_ev[0]['t'] in ('fadeIn', 'show') else 1.0
    for a in vis_ev:
        d0 = a.get('delay', 0)
        if t < d0: break
        if a['t'] == 'show': op = 1.0
        elif a['t'] == 'hide': op = 0.0
        elif a['t'] == 'fadeIn': op = min(1.0, (t - d0) / max(1, a['d']))
        elif a['t'] == 'fadeOut': op = max(0.0, 1 - (t - d0) / max(1, a['d']))
    return dx, dy, sx, sy, dr, op

def transformed(L, st):
    """Ebene transformieren → (RGBA-Bild, linke obere Ecke) in Render-px"""
    dx, dy, sx, sy, dr, op = st
    w, h = max(1, int(round(L['w'] * PX * sx))), max(1, int(round(L['h'] * PX * sy)))
    cx, cy = (L['x'] + L['w'] / 2) * PX + dx, (L['y'] + L['h'] / 2) * PX + dy
    if L.get('kind') == 'rect':
        im = Image.new('RGBA', (w, h), L['color'])
    else:
        im = load(L['file']).resize((w, h), Image.BILINEAR)
    rot = (L.get('rot', 0) + dr) % 360
    if abs(rot) > 0.05: im = im.rotate(-rot, resample=Image.BILINEAR, expand=True)
    if op < 0.999:
        a = im.getchannel('A').point(lambda v: int(v * op)); im.putalpha(a)
    return im, (int(round(cx - im.width / 2)), int(round(cy - im.height / 2)))

FONT = {}
def font(kind, size):
    key = (kind, size)
    if key not in FONT:
        f = {'serif': 'dejavu/DejaVuSerif.ttf', 'serifi': 'liberation/LiberationSerif-Italic.ttf', 'sansb': 'dejavu/DejaVuSans-Bold.ttf', 'sans': 'dejavu/DejaVuSans.ttf'}[kind]
        try: FONT[key] = ImageFont.truetype('/usr/share/fonts/truetype/' + f, size)
        except OSError: FONT[key] = ImageFont.load_default()
    return FONT[key]

def render(k, t, draw_zone=False):
    S = META[k]; can = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    for L in S['layers']:
        st = state(S, L['name'], t)
        if st[5] <= 0.001: continue
        im, pos = transformed(L, st); can.paste(im, pos, im)
    d = ImageDraw.Draw(can)
    for T in S['texts']:
        op = state(S, T['name'], t)[5]
        if op <= 0.01: continue
        size = int(T['size'] * 2 * SC * 0.92)
        kind = 'sansb' if T['name'] in ('year',) else ('serifi' if T['italic'] else ('sans' if T['name'] == 'credits' else 'serif'))
        col = {'year': (185, 169, 142), 'title': (244, 237, 225), 'sub': (242, 196, 109), 'credits': (185, 169, 142)}.get(T['name'], (244, 237, 225))
        col = tuple(int(c * op) for c in col)
        x, y = T['x'] * PX, T['y'] * PX
        if T['align'] == 'center':
            tw = d.textlength(T['text'], font=font(kind, size)); x = x + T['w'] * PX / 2 - tw / 2
        if T['name'] == 'title': y += (T['h'] * PX - size) / 2 - size * 0.15
        d.text((x, y), T['text'], font=font(kind, size), fill=col)
    if draw_zone:
        d.rectangle(ZONE[:2] + (ZONE[2], ZONE[3] - 1), outline=(80, 200, 255), width=1)
    return can.convert('RGB')

def check(k):
    """Alle 100 ms: Werkzeuge im Bild, nichts in der Textzone"""
    S = META[k]; issues = []; names = [L for L in S['layers'] if L['name'] not in FX_SKIP and not L['name'].startswith('tl')]
    worst = {}
    for t in range(0, S['dur'] + 1, 100):
        for L in names:
            st = state(S, L['name'], t)
            if st[5] < 0.05: continue
            im, (x0, y0) = transformed(L, st)
            a = im.getchannel('A').point(lambda v: 255 if v >= ATH else 0)
            bb = a.getbbox()
            if not bb: continue
            X0, Y0, X1, Y1 = x0 + bb[0], y0 + bb[1], x0 + bb[2], y0 + bb[3]
            if TOOLS(L['name']) and (X0 < 0 or Y0 < 0 or X1 > W or Y1 > H):
                worst.setdefault((L['name'], 'Bildrand'), (t, round(min(X0, Y0, W - X1, H - Y1) / SC)))
            zx0, zy0, zx1, zy1 = max(ZONE[0], X0), max(ZONE[1], Y0), min(ZONE[2], X1), min(ZONE[3], Y1)
            if zx0 < zx1 and zy0 < zy1:
                n = sum(a.crop((zx0 - x0, zy0 - y0, zx1 - x0, zy1 - y0)).histogram()[255:])
                if n > 0:
                    w0 = worst.get((L['name'], 'Textzone'))
                    if not w0 or n > w0[1]: worst[(L['name'], 'Textzone')] = (t, n)
    for (n, kind), (t, v) in worst.items():
        issues.append(f'Folie {k + 1}: {n} {kind} bei {t} ms ({"px über Rand" if kind == "Bildrand" else "px in Zone"}: {abs(v)})')
    # Animationsende ≤ advTm
    for a in S['anims']:
        if a['t'] == 'kf': end = max(P[-1][0] for P in a['props'].values())
        elif a['t'] == 'orbit': end = a['t1']
        else: end = a.get('delay', 0) + a.get('d', 0) + (a.get('dur', 0) * (a.get('repeat') or 1) * (2 if a.get('autoRev') else 1) if a['t'] in ('scale', 'move', 'spin', 'shake') else 0)
        if end > S['dur'] + 1: issues.append(f'Folie {k + 1}: {a["id"]} ({a["t"]}) endet bei {end} ms > advTm {S["dur"]}')
    return issues

def continuity(k):
    """Carry-/Morph-Objekte: Startlage auf Folie k+1 = Endlage auf Folie k"""
    out = []
    A, B = META[k], META[k + 1]
    LA = {L['name']: L for L in A['layers']}
    for L in B['layers']:
        if not (L['name'].startswith('carry')): continue
        src = {'carry': 'icon', 'carryOff': 'iconOff', 'carryGlow': 'bglow', 'carryScreen': 'screen'}[L['name']]
        if src not in LA: continue
        dx, dy, sx, sy, dr, _ = state(A, src, A['dur'])
        S0 = LA[src]
        ca = ((S0['x'] + S0['w'] / 2) * PX + dx, (S0['y'] + S0['h'] / 2) * PX + dy, S0['w'] * sx, S0['h'] * sy, (S0['rot'] + dr) % 360)
        db = state(B, L['name'], 0)
        cb = ((L['x'] + L['w'] / 2) * PX + db[0], (L['y'] + L['h'] / 2) * PX + db[1], L['w'] * db[2], L['h'] * db[3], (L['rot'] + db[4]) % 360)
        err = max(abs(ca[0] - cb[0]) / SC, abs(ca[1] - cb[1]) / SC, abs(ca[2] - cb[2]) * 144, abs(ca[3] - cb[3]) * 144, min(abs(ca[4] - cb[4]), 360 - abs(ca[4] - cb[4])))
        out.append((k + 2, L['name'], round(err, 3)))
    return out

if __name__ == '__main__':
    only = [int(a) for a in sys.argv[1:]] or list(range(len(META)))
    rep = []; cont = []
    for k in only:
        S = META[k]
        fr = [render(k, t, draw_zone=False) for t in (0, S['dur'] // 2, S['dur'])]
        strip = Image.new('RGB', (W * 3 + 20, H + 34), (20, 20, 26)); d = ImageDraw.Draw(strip)
        for i, f in enumerate(fr): strip.paste(f, (i * (W + 10), 34))
        lab = f'Folie {k + 1}  ·  {S["dur"] / 1000:.1f} s  ·  ' + ('Morph' if S.get('morph') else ('Überblendung durch Schwarz' if S['thruBlk'] else 'Überblendung')) + '   |   0 %  ·  50 %  ·  100 %'
        d.text((8, 8), lab, font=font('sans', 18), fill=(240, 230, 200))
        strip.save(f'qa/frames/s{k + 1:02d}.jpg', quality=82)
        iss = check(k); rep += iss
        if k + 1 < len(META): cont += continuity(k)
        print(f'Folie {k + 1}: {"OK" if not iss else str(len(iss)) + " Hinweise"}', flush=True)
    with open('qa/report.txt', 'w') as f:
        f.write('\n'.join(rep) if rep else 'Keine Verstöße (Bildrand, Textzone, advTm).')
        f.write('\n\nKontinuität Carry (max. Abweichung in px bzw. Grad):\n' + '\n'.join(f'Folie {a}: {b} Δ={c}' for a, b, c in cont))
    print('\n'.join(rep) or 'Keine Verstöße.'); print('Kontinuität max Δ:', max([c for _, _, c in cont] or [0]))
