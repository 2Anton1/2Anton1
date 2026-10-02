"""Generative cinematic score for 'Homo faber'. One clip per slide (slide duration + tail)."""
import numpy as np, json, sys, os, subprocess
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
TAIL = 3.5
rng = np.random.default_rng(7)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def T(d): return np.arange(int(d * SR)) / SR
def lp(x, fc, order=2):
    sos = butter(order, min(fc, SR / 2 - 100) / (SR / 2), 'low', output='sos'); return sosfilt(sos, x)
def hp(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), 'high', output='sos'); return sosfilt(sos, x)
def bp(x, lo, hi):
    sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'); return sosfilt(sos, x)

def env_ar(n, a, r):
    e = np.ones(n); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na) ** 1.5
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e

def place(buf, sig, t0, gain=1.0):
    i = int(t0 * SR)
    if i >= buf.shape[1]: return
    j = min(buf.shape[1], i + sig.shape[-1])
    if sig.ndim == 1: buf[:, i:j] += gain * sig[:j - i]
    else: buf[:, i:j] += gain * sig[:, :j - i]

def pan(sig, p):  # p -1..1
    l = np.cos((p + 1) * np.pi / 4); r = np.sin((p + 1) * np.pi / 4)
    return np.vstack([sig * l, sig * r])

# ---------- instruments ----------
def saw(f, t, nh=8, det=0.0):
    ph = 2 * np.pi * f * (1 + det) * t
    return sum(np.sin(n * ph + n * 0.37) / n for n in range(1, nh + 1))

def pad(notes, dur, bright=1800, attack=1.8, release=2.5, vib=0.0, gain=1.0):
    t = T(dur); out = np.zeros((2, len(t)))
    for k, m in enumerate(notes):
        f = mtof(m)
        fm = f * (1 + vib * 0.004 * np.sin(2 * np.pi * (4.7 + k * 0.3) * t)) if vib else f
        for d, p in ((-0.0035, -0.6), (0.0, 0.0), (0.0042, 0.6)):
            ph = np.cumsum(2 * np.pi * fm * (1 + d) / SR) if vib else 2 * np.pi * f * (1 + d) * t
            v = sum(np.sin(n * ph + rng.random() * 6) / n for n in range(1, 7))
            out += pan(v, p * 0.8) / 3
    sweep = bright * (0.75 + 0.25 * np.sin(2 * np.pi * t / max(dur, 1) * 0.5))
    out = np.vstack([lp(out[0], bright), lp(out[1], bright * 1.05)])
    return out * env_ar(len(t), attack, release) * gain / len(notes) ** 0.5

def drone(root, dur, gain=1.0):
    t = T(dur)
    s = np.sin(2 * np.pi * mtof(root) * t) + 0.5 * np.sin(2 * np.pi * mtof(root + 7) * t) + 0.25 * np.sin(2 * np.pi * mtof(root + 12) * t + 1)
    s *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * t)
    return pan(s * env_ar(len(t), 2.0, 2.5) * gain, 0)

def wind(dur, gain=1.0, lo=300, hi=1600):
    t = T(dur); n = rng.standard_normal((2, len(t)))
    n = np.vstack([bp(n[0], lo, hi), bp(n[1], lo * 1.1, hi * 0.9)])
    mod = 0.55 + 0.45 * np.sin(2 * np.pi * 0.13 * t + 1) * np.sin(2 * np.pi * 0.07 * t)
    return n * mod * env_ar(len(t), 2.5, 2.5) * gain

def drum(f0=62, decay=0.45, gain=1.0, noise=0.35):
    t = T(decay * 3); f = f0 * (1 + 0.9 * np.exp(-t * 28))
    s = np.sin(np.cumsum(2 * np.pi * f / SR)) * np.exp(-t / decay)
    s += noise * lp(rng.standard_normal(len(t)), 900) * np.exp(-t / 0.05)
    return s * gain

def pluck(m, dur=2.5, bright=1.0, gain=1.0):
    t = T(dur); f = mtof(m)
    s = sum(np.sin(2 * np.pi * n * f * t) * np.exp(-t * (1.6 + n * 1.3 / bright)) / n ** 1.1 for n in range(1, 10))
    return s * np.minimum(1, t * 400) * gain

def bell(m, dur=4.0, gain=1.0, ratio=3.5):
    t = T(dur); f = mtof(m)
    s = np.sin(2 * np.pi * f * t + 2.2 * np.exp(-t / 1.2) * np.sin(2 * np.pi * f * ratio * t)) * np.exp(-t / 1.6)
    return s * np.minimum(1, t * 300) * gain

def piano(m, dur=4.0, gain=1.0):
    t = T(dur); f = mtof(m)
    s = sum(np.sin(2 * np.pi * n * f * (1 + 0.0004 * n * n) * t) * np.exp(-t * (0.7 + n * 0.55)) / n ** 1.4 for n in range(1, 8))
    return s * np.minimum(1, t * 600) * gain

def lead(m, dur, gain=1.0, bright=2500):
    t = T(dur); f = mtof(m)
    ph = np.cumsum(2 * np.pi * f * (1 + 0.005 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t)) / SR)
    s = sum(np.sin(n * ph) / n ** 1.6 for n in range(1, 6))
    return lp(s, bright) * env_ar(len(t), min(0.35, dur / 3), min(0.8, dur / 2)) * gain

def arp_note(m, dur=0.22, gain=1.0, bright=2600):
    t = T(dur); f = mtof(m)
    s = sum(np.sin(2 * np.pi * n * f * t) / n for n in (1, 3, 5, 7))
    return lp(s, bright) * np.exp(-t / 0.09) * np.minimum(1, t * 800) * gain

def tick(gain=1.0):
    t = T(0.12); s = hp(rng.standard_normal(len(t)), 3500) * np.exp(-t / 0.012)
    s += 0.4 * np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.03)
    return s * gain

def clank(gain=1.0):
    t = T(0.9); s = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, d in ((180, 0.25), (433, 0.18), (917, 0.1), (1520, 0.07)))
    s += lp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.03) * 1.5
    return s * gain

def hit(gain=1.0, dark=False):  # cinematic impact
    t = T(4.0); f = 55 * (1 + 1.5 * np.exp(-t * 9)) * (0.8 if dark else 1)
    s = np.sin(np.cumsum(2 * np.pi * f / SR)) * np.exp(-t / 1.1)
    s += 0.6 * lp(rng.standard_normal(len(t)), 600 if dark else 1400) * np.exp(-t / 0.35)
    return s * gain

def swell(dur=1.6, gain=1.0):  # reverse-cymbal style rise
    t = T(dur); s = hp(rng.standard_normal(len(t)), 2000) * (t / dur) ** 3
    return s * gain

def boom(gain=1.0):
    t = T(9.0); f = 70 * np.exp(-t * 0.5) + 22
    s = np.sin(np.cumsum(2 * np.pi * f / SR)) * np.exp(-t / 2.8)
    s += 1.2 * lp(rng.standard_normal(len(t)), 300) * np.exp(-t / 1.6)
    s += 0.5 * lp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.25)
    return s * gain

def ring(dur, gain=1.0):
    t = T(dur); return np.sin(2 * np.pi * 3520 * t) * np.exp(-t / 4) * np.minimum(1, t * 2) * gain

IMP = None
def reverb(x, wet=0.32, size=2.8):
    global IMP
    if IMP is None:
        t = T(size); IMP = np.vstack([lp(rng.standard_normal(len(t)), 5000) * np.exp(-t / (size / 4.2)) for _ in range(2)])
        IMP /= np.sqrt((IMP ** 2).sum(axis=1, keepdims=True))
    w = np.vstack([fftconvolve(x[0], IMP[0])[:x.shape[1]], fftconvolve(x[1], IMP[1])[:x.shape[1]]])
    return x * (1 - wet) + w * wet * 2.2

# ---------- harmony ----------
LIGHT = [  # pairs of chords (voicings) for Licht clips
    ([50, 57, 62, 66, 69], [50, 55, 62, 67, 71]),   # D  - G/D
    ([47, 54, 59, 62, 66], [43, 55, 59, 62, 67]),   # Bm - G
    ([50, 57, 62, 64, 69], [45, 52, 57, 61, 64]),   # Dadd9 - A
    ([43, 55, 59, 62, 66], [50, 57, 62, 66, 69]),   # Gmaj7 - D
    ([52, 55, 59, 62, 67], [45, 52, 57, 61, 66]),   # Em7 - A6
]
SHADOW = [
    ([50, 57, 62, 65, 69], [51, 55, 58, 63, 67]),   # Dm - Eb/D (phrygian)
    ([46, 53, 58, 62, 65], [45, 52, 55, 58, 61]),   # Bb - A7b9
    ([43, 55, 58, 62, 67], [50, 51, 57, 62, 65]),   # Gm - Dm cluster
    ([50, 57, 62, 65, 68], [46, 53, 58, 61, 65]),   # Dm(b6) - Bbm
]

def chord_bass(ch): return min(ch) - 12

def melody_notes(chords, i):
    pats = [[0, 2, 1, 3], [2, 3, 4, 2], [1, 2, 4, 3], [3, 2, 1, 0], [0, 1, 2, 4]]
    p = pats[i % len(pats)]; out = []
    for k, ch in enumerate(chords):
        top = sorted(ch)[-5:]
        out += [top[p[(k * 2) % 4] % len(top)] + 12, top[p[(k * 2 + 1) % 4] % len(top)] + 12]
    return out

# ---------- clip composer ----------
def compose(slide):
    dur = slide['dur'] / 1000; L = dur + TAIL
    kind, era, idx = slide['kind'], slide['era'], slide.get('idx', 0)
    n = int(L * SR); buf = np.zeros((2, n))
    light = kind == 'L'
    chords = (LIGHT[idx % len(LIGHT)] if light else SHADOW[idx % len(SHADOW)])
    half = dur / 2

    def pads(gain=0.5, bright=1600, vib=0.0, attack=1.6):
        for k, ch in enumerate(chords):
            t0 = k * half; d = half + (TAIL if k == 1 else 1.2)
            place(buf, pad(ch, d, bright=bright, attack=attack if k == 0 else 1.0, release=2.0, vib=vib), t0, gain)
            place(buf, pad([chord_bass(ch)], d, bright=500, attack=1.2, release=2.0), t0, gain * 0.8)

    special = slide.get('special')
    # ---------------- special clips ----------------
    if special == 'intro':
        place(buf, wind(L, 0.10, 250, 1200), 0)
        place(buf, drone(26, L, 0.30), 0)
        place(buf, pad([50, 57, 62], L - 1, bright=900, attack=5, release=3), 1.0, 0.35)
        place(buf, pan(swell(2.2, 0.12), 0), 0.2)
        place(buf, pan(hit(0.55), 0), 2.2)
        for k, m in enumerate([62, 69, 74]): place(buf, pan(bell(m, 5, 0.10), -0.4 + k * 0.4), 4.5 + k * 1.6)
    elif special == 'atom':
        place(buf, pan(boom(1.2), 0), 0.0)
        place(buf, pan(ring(L, 0.025), 0.2), 0.3)
        place(buf, drone(26, L, 0.25), 2.5)
        place(buf, pad([50, 51, 56, 62], L - 5, bright=700, attack=4, release=3), 5.0, 0.35)
        place(buf, wind(L, 0.06, 150, 700), 1.5)
    elif special == 'o1':
        place(buf, drone(38, L, 0.18), 0)
        place(buf, pad([50, 57, 62, 64, 69], L, bright=1700, attack=2.5, release=3), 0, 0.45)
        for k, m in enumerate([62, 66, 69, 74, 76, 81]): place(buf, pan(piano(m, 5, 0.22), -0.5 + k * 0.2), 0.8 + k * 1.3)
        place(buf, pan(hit(0.4), 0), 0.9)
    elif special == 'o2':
        place(buf, drone(38, L, 0.18), 0)
        place(buf, pad([50, 57, 62, 65, 68], L, bright=1100, attack=2.0, release=3), 0, 0.45)
        for k, m in enumerate([74, 72, 69, 68]): place(buf, pan(piano(m, 5, 0.2), 0.3 - k * 0.2), 1.0 + k * 1.8)
        place(buf, pan(hit(0.45, dark=True), 0), 1.2)
    elif special == 'o3':
        place(buf, drone(38, L, 0.15), 0)
        place(buf, pad([50, 57, 62, 64, 69, 76], L, bright=1500, attack=4, release=4), 0, 0.42)
        for k, m in enumerate([69, 74, 76, 74, 81, 76]): place(buf, pan(piano(m, 6, 0.2), -0.3 + (k % 3) * 0.3), 2.5 + k * 1.7)
        place(buf, pan(swell(2.5, 0.08), 0), 0.5)
        place(buf, pan(hit(0.35), 0), 3.0)
    elif special == 'o4':
        place(buf, pad([38, 50, 57, 64], L, bright=900, attack=1.0, release=6), 0, 0.4)
        place(buf, pan(bell(74, 7, 0.08), 0), 1.0)
    else:
        # ---------------- regular clips ----------------
        place(buf, drone(26, L, 0.16 if light else 0.24), 0)
        if light: place(buf, pan(hit(0.42), 0), 0.85)
        else: place(buf, pan(hit(0.5, dark=True), 0), 1.2)
        mel = melody_notes(chords, idx)
        beat = 60 / {1: 66, 2: 72, 3: 76, 4: 100, 5: 70, 6: 110}[era]
        if era == 1:  # Urzeit: Rahmentrommeln, Wind
            place(buf, wind(L, 0.08), 0)
            pads(0.42, 1200 if light else 800)
            pat = [0, 1.5, 2, 3] if light else [0, 0.75, 1.5, 2, 2.5, 3, 3.5]
            b = 0.0
            while b * beat < dur:
                for p in pat:
                    tt = (b + p) * beat
                    if 1.0 < tt < dur: place(buf, pan(drum(62 if p == 0 else 78, 0.4, 0.55 if p == 0 else 0.3), rng.uniform(-0.3, 0.3)), tt)
                b += 4
            if light:
                for k, m in enumerate(mel[:4]): place(buf, pan(lead(m - 12, beat * 3, 0.10, 1400), -0.2), 2.2 + k * beat * 3)
        elif era == 2:  # Hochkulturen: Lyra-Arpeggio
            pads(0.38, 1500 if light else 900)
            step = beat / 2; tt = 1.0; k = 0
            while tt < dur + 1:
                ch = chords[0] if tt < half else chords[1]
                m = sorted(ch)[[0, 2, 3, 4, 3, 2][k % 6]] + 12
                place(buf, pan(pluck(m, 2.2, 1.2 if light else 0.7, 0.16), -0.4 + 0.15 * (k % 6)), tt); tt += step; k += 1
            if not light:
                for b in range(0, int(dur / beat), 2): place(buf, pan(drum(48, 0.6, 0.6), 0), 1.2 + b * beat)
        elif era == 3:  # Mittelalter & Neuzeit: Glocken, Chor-Pad
            pads(0.42, 1400 if light else 900, vib=1.0, attack=2.2)
            if light:
                for k, m in enumerate(mel): place(buf, pan(bell(m, 4.5, 0.11), -0.5 + 0.3 * (k % 4)), 1.5 + k * dur / len(mel) * 0.9)
            else:
                for k in range(int(dur / 2.4)): place(buf, pan(bell(38, 6, 0.22, ratio=2.4), 0), 1.0 + k * 2.4)
                for k in range(3): place(buf, pan(boom(0.25), rng.uniform(-0.5, 0.5)), 2.5 + k * 2.6)
        elif era == 4:  # Industrialisierung: Mechanik
            pads(0.36, 1500 if light else 1000)
            s16 = beat / 4; tt = 0.8; k = 0
            while tt < dur + 0.5:
                place(buf, pan(tick(0.10 if k % 4 else 0.16), 0.5 if k % 2 else -0.5), tt)
                if not light and k % 8 == 0: place(buf, pan(clank(0.35), rng.uniform(-0.3, 0.3)), tt)
                if not light and k % 4 == 2: place(buf, pan(drum(50, 0.3, 0.4, 0.6), 0), tt)
                tt += s16; k += 1
            if light:
                for k, m in enumerate(mel): place(buf, pan(pluck(m, 2.0, 1.4, 0.15), 0.2), 1.6 + k * beat * 2)
        elif era == 5:  # 20. Jahrhundert: Streicher, Pauken
            pads(0.48, 1800 if light else 900, vib=1.0, attack=2.4)
            if light:
                for k, m in enumerate(mel): place(buf, pan(lead(m, dur / len(mel) * 1.1, 0.10, 2400), 0.1), 1.4 + k * dur / len(mel) * 0.95)
            else:
                for k in range(int(dur / 1.5)):
                    for r in range(6): place(buf, pan(drum(46, 0.25, 0.10 + r * 0.04, 0.2), 0), 1.0 + k * 1.5 + r * 0.06)
                for k, ch in enumerate(chords): place(buf, pad([chord_bass(ch) + 12, chord_bass(ch) + 19], half + 1, bright=700, attack=0.6, release=1.2), k * half + 0.5, 0.5)
        elif era == 6:  # Digital: Arpeggiator
            pads(0.36, 1700 if light else 1000)
            s16 = beat / 4; tt = 1.0; k = 0
            while tt < dur + 0.5:
                ch = chords[0] if tt < half else chords[1]
                srt = sorted(ch); m = srt[[0, 2, 4, 2, 1, 3, 4, 3][k % 8] % len(srt)] + 12
                if not light and k % 7 == 3: m += 1
                place(buf, pan(arp_note(m, 0.24, 0.10, 3000 if light else 1600), -0.5 if k % 2 else 0.5), tt)
                if k % 4 == 0: place(buf, pan(drum(44, 0.35, 0.35, 0.1), 0), tt)
                tt += s16; k += 1
            if not light:
                for k in range(int(dur / 1.1)):
                    place(buf, pan(drum(40, 0.25, 0.5, 0.05), 0), 1.0 + k * 1.1); place(buf, pan(drum(40, 0.25, 0.35, 0.05), 0), 1.25 + k * 1.1)
    buf = reverb(buf, 0.30 if special != 'atom' else 0.42)
    # master: normalise, soft clip, fades
    core = buf[:, :int(dur * SR)]
    rms = np.sqrt((core ** 2).mean()) + 1e-9
    target = {"intro": 0.075, "o4": 0.05, "atom": 0.10}.get(special, 0.085)
    buf *= target / rms
    buf = np.tanh(buf * 1.4) / np.tanh(1.4)
    fi = int((1.2 if slide.get('fadeIn', True) else 0.25) * SR)
    buf[:, :fi] *= np.linspace(0, 1, fi) ** 2
    fo = int(TAIL * SR); buf[:, -fo:] *= np.linspace(1, 0, fo) ** 1.6
    # v3: Musik unter der Erzählstimme absenken (Duck-Fenster aus plan.js, in Sekunden ab Clipanfang)
    if slide.get('duck'):
        buf *= duck_env(buf.shape[1], slide['duck'])
    return buf * 0.9

DUCK_DB, DUCK_ATT, DUCK_REL = -10.0, 0.35, 0.8
def duck_env(n, windows):
    g = np.ones(n); depth = 10 ** (DUCK_DB / 20)
    t = np.arange(n) / SR
    for a, b in windows:
        a0 = a - DUCK_ATT  # Absenkung beginnt kurz vor dem ersten Wort
        down = np.clip((t - a0) / DUCK_ATT, 0, 1); up = np.clip(1 - (t - b) / DUCK_REL, 0, 1)
        w = np.minimum(down, up)            # 0 außerhalb, 1 innerhalb des Fensters
        g = np.minimum(g, 1 - (1 - depth) * (w * w * (3 - 2 * w)))
    return g

def write_mp3(buf, path):
    pcm = (np.clip(buf.T, -1, 1) * 32767).astype('<i2').tobytes()
    import lameenc
    enc = lameenc.Encoder(); enc.set_bit_rate(int(os.environ.get("MUSIC_KBPS", 112))); enc.set_in_sample_rate(SR); enc.set_channels(2); enc.set_quality(2)
    open(path, 'wb').write(enc.encode(pcm) + enc.flush())

if __name__ == '__main__':
    slides = json.load(open('music_plan.json'))
    os.makedirs('audio', exist_ok=True)
    only = sys.argv[1:]
    for k, s in enumerate(slides):
        if only and str(k) not in only: continue
        b = compose(s); write_mp3(b, f"audio/a{k:02d}.mp3"); print(k, s.get('special') or s['kind'] + str(s['era']), round(b.shape[1] / SR, 1), 's', flush=True)
