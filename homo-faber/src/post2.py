import zipfile, json, re, hashlib, posixpath, math, subprocess, os, tempfile
META = json.load(open('meta.json'))
SRC, DST = 'raw2.pptx', os.environ.get('DST', 'Homo_faber_Film.pptx')
SWPX, SHPX = 1920.0, 1080.0
VOICE_DELAY = 800

def ids(xml):
    out = {}
    for m in re.finditer(r'<p:cNvPr id="(\d+)" name="([^"]*)"', xml):
        out.setdefault(m.group(2), m.group(1))
    return out

class Seq:
    def __init__(self): self.n = 4; self.grp = {}; self.bld = {}
    def nid(self): self.n += 1; return self.n
    def g(self, spid):
        k = self.grp.get(spid, 0); self.grp[spid] = k + 1; return k

def tgt(sp): return f'<p:tgtEl><p:spTgt spid="{sp}"/></p:tgtEl>'

def outer(S, sp, cls, preset, delay, inner, extra='', grp=True, a=None):
    gid = S.g(sp) if grp else None
    g = f' grpId="{gid}"' if grp else ''
    return (f'<p:par><p:cTn id="{a}" presetID="{preset}" presetClass="{cls}" presetSubtype="0"{extra} fill="hold"{g} nodeType="withEffect">'
            f'<p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>{inner}</p:childTnLst></p:cTn></p:par>'), gid

def vis(S, sp, val, delay=0):
    return (f'<p:set><p:cBhvr><p:cTn id="{S.nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>{tgt(sp)}'
            f'<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{val}"/></p:to></p:set>')

# ---- v3: Keyframe-Spur einer Eigenschaft als <p:anim> (Formeln relativ zur Layout-Lage) ----
ATTR = {'x': ('ppt_x', 'path', 0), 'y': ('ppt_y', 'path', 0), 'sx': ('ppt_w', 'emph', 6), 'sy': ('ppt_h', 'emph', 6)}
def kf_prop(S, sp, prop, P, ref):
    attr, cls, preset = ATTR[prop]
    t0, t1 = P[0][0], P[-1][0]
    if t1 <= t0: return ''
    tav, last = '', -1
    oid = S.nid()
    for t, v in P:
        tm = int(round((t - t0) / (t1 - t0) * 100000))
        if tm <= last: continue
        last = tm
        if prop == 'x': val = f'#ppt_x+{(v - ref) / SWPX:.6f}'
        elif prop == 'y': val = f'#ppt_y+{(v - ref) / SHPX:.6f}'
        elif prop == 'sx': val = f'#ppt_w*{v / ref:.6f}'
        else: val = f'#ppt_h*{v / ref:.6f}'
        tav += f'<p:tav tm="{tm}"><p:val><p:strVal val="{val}"/></p:val></p:tav>'
    inner = (f'<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="{S.nid()}" dur="{t1 - t0}" fill="hold"/>{tgt(sp)}'
             f'<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>{tav}</p:tavLst></p:anim>')
    return outer(S, sp, cls, preset, t0, inner, a=oid)[0]

def rot_seg(S, sp, delay, d, by):
    oid = S.nid()
    inner = f'<p:animRot by="{int(round(by * 60000))}"><p:cBhvr><p:cTn id="{S.nid()}" dur="{max(1, d)}" fill="hold"/>{tgt(sp)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>'
    return outer(S, sp, 'emph', 8, delay, inner, a=oid)[0]

def kf(S, a, sp):
    props, refEnd = a['props'], a['ref'] == 'end'
    x = ''
    for k in ('x', 'y', 'sx', 'sy'):
        P = props[k]
        vals = [v for _, v in P]
        if max(vals) - min(vals) < 1e-6: continue
        ref = P[-1][1] if refEnd else P[0][1]
        x += kf_prop(S, sp, k, P, ref)
    R = props['r']
    if max(v for _, v in R) - min(v for _, v in R) > 1e-6:
        # Drehung als Kette relativer animRot-Segmente (Layout-Drehung = Referenzzustand)
        if refEnd and abs(R[0][1] - R[-1][1]) > 1e-6:
            x += rot_seg(S, sp, 0, 1, R[0][1] - R[-1][1])
        for (ta, va), (tb, vb) in zip(R, R[1:]):
            if abs(vb - va) > 1e-4: x += rot_seg(S, sp, ta, tb - ta, vb - va)
    return x

# ---- v3: Ellipsenbahn (Elektronen, Datenpakete) als geschlossener Bézier-Bewegungspfad ----
def orbit(S, a, sp):
    A, K = math.radians(a['th']), 0.5523
    def P(f): u, v = a['a'] * math.cos(f), a['b'] * math.sin(f); return (u * math.cos(A) - v * math.sin(A), u * math.sin(A) + v * math.cos(A))
    def dP(f): u, v = -a['a'] * math.sin(f), a['b'] * math.cos(f); return (u * math.cos(A) - v * math.sin(A), u * math.sin(A) + v * math.cos(A))
    f0 = a['phi0']; p0 = P(f0)
    rel = lambda q: f'{(q[0] - p0[0]) / SWPX:.5f} {(q[1] - p0[1]) / SHPX:.5f}'
    path = 'M 0 0'
    for k in range(4):
        fa, fb = f0 + k * math.pi / 2, f0 + (k + 1) * math.pi / 2
        pa, pb, da, db = P(fa), P(fb), dP(fa), dP(fb)
        c1 = (pa[0] + K * da[0], pa[1] + K * da[1]); c2 = (pb[0] - K * db[0], pb[1] - K * db[1])
        path += f' C {rel(c1)} {rel(c2)} {rel(pb)}'
    path += ' Z'
    rep = (a['t1'] - a['t0']) / a['per']
    oid = S.nid()
    inner = (f'<p:animMotion origin="layout" path="{path}" pathEditMode="relative" ptsTypes="AAAAA"><p:cBhvr>'
             f'<p:cTn id="{S.nid()}" dur="{a["per"]}" repeatCount="{int(rep * 1000)}" fill="hold"/>{tgt(sp)}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>')
    return outer(S, sp, 'path', 0, a['t0'], inner, a=oid)[0]

def eff(S, a, sp, kinds):
    t = a['t']
    if t == 'kf': return kf(S, a, sp)
    if t == 'orbit': return orbit(S, a, sp)
    oid = S.nid()
    delay = a.get('delay', 0)
    ease = ' accel="30000" decel="30000"' if a.get('ease') else ''
    rep = ''
    if a.get('repeat'): rep += f' repeatCount="{int(a["repeat"] * 1000)}"'
    if a.get('autoRev'): rep += ' autoRev="1"'
    if t == 'scale':
        by = round(a['by'] * 100000)
        inner = f'<p:animScale><p:cBhvr><p:cTn id="{S.nid()}" dur="{a["dur"]}" fill="hold"/>{tgt(sp)}</p:cBhvr><p:by x="{by}" y="{by}"/></p:animScale>'
        x, _ = outer(S, sp, 'emph', 6, delay, inner, rep + ease, a=oid); return x
    if t == 'spin':
        inner = f'<p:animRot by="{int(a["deg"] * 60000)}"><p:cBhvr><p:cTn id="{S.nid()}" dur="{a["dur"]}" fill="hold"/>{tgt(sp)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>'
        x, _ = outer(S, sp, 'emph', 8, delay, inner, a=oid); return x
    if t in ('move', 'shake'):
        if t == 'move':
            path = f'M 0 0 L {a["dx"]:.4f} {a["dy"]:.4f} E'; pts = 'AA'
        else:
            path = 'M 0 0 L 0.004 0.003 L -0.003 -0.004 L 0.003 -0.002 L 0 0 E'; pts = 'AAAAA'
        inner = (f'<p:animMotion origin="layout" path="{path}" pathEditMode="relative" ptsTypes="{pts}"><p:cBhvr>'
                 f'<p:cTn id="{S.nid()}" dur="{a["dur"]}" fill="hold"/>{tgt(sp)}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>')
        x, _ = outer(S, sp, 'path', 0, delay, inner, rep + ease, a=oid); return x
    if t == 'fadeIn':
        d = a['d']
        inner = vis(S, sp, 'visible') + f'<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="{S.nid()}" dur="{d}"/>{tgt(sp)}</p:cBhvr></p:animEffect>'
        preset = 10
        if a.get('rise'):
            preset = 42
            inner += (f'<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="{S.nid()}" dur="{d}" decel="100000" fill="hold"/>{tgt(sp)}'
                      f'<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>'
                      f'<p:tav tm="0"><p:val><p:strVal val="#ppt_y+.012"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>')
        x, gid = outer(S, sp, 'entr', preset, delay, inner, a=oid)
        if kinds.get(sp) in ('text', 'shape'): S.bld[(sp, gid)] = kinds[sp]
        return x
    if t == 'fadeOut':
        d = a['d']
        inner = f'<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="{S.nid()}" dur="{d}"/>{tgt(sp)}</p:cBhvr></p:animEffect>' + vis(S, sp, 'hidden', d - 1)
        x, gid = outer(S, sp, 'exit', 10, delay, inner, a=oid)
        if kinds.get(sp) in ('text', 'shape'): S.bld[(sp, gid)] = kinds[sp]
        return x
    if t in ('show', 'hide'):   # v3: Erscheinen / Verschwinden (Flackern, Blinken)
        x, gid = outer(S, sp, 'entr' if t == 'show' else 'exit', 1, delay, vis(S, sp, 'visible' if t == 'show' else 'hidden'), a=oid)
        if kinds.get(sp) in ('text', 'shape'): S.bld[(sp, gid)] = kinds[sp]
        return x
    raise ValueError(t)

def timing(meta, idm, kinds, medias):
    S = Seq(); effs = ''
    for a in meta['anims']:
        if a['id'] not in idm: raise KeyError(f"Ebene {a['id']} fehlt")
        effs += eff(S, a, idm[a['id']], kinds)
    nodes = []
    for m in medias:   # Mediaplayback (Musik bei 0 ms, Sprecher bei 800 ms)
        a = S.nid(); b = S.nid()
        effs += (f'<p:par><p:cTn id="{a}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="withEffect">'
                 f'<p:stCondLst><p:cond delay="{m["delay"]}"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr>'
                 f'<p:cTn id="{b}" dur="{m["ms"]}" fill="hold"/>{tgt(m["sp"])}</p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>')
    audio = ''
    for m in medias:
        c = S.nid()
        audio += (f'<p:audio><p:cMediaNode vol="{m["vol"]}" numSld="{m["numSld"]}" showWhenStopped="0"><p:cTn id="{c}" fill="hold" display="0">'
                  f'<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>'
                  f'</p:cTn>{tgt(m["sp"])}</p:cMediaNode></p:audio>')
    AB = ' animBg="1"'
    bld = ''.join(f'<p:bldP spid="{sp}" grpId="{g}"{AB if k == "shape" else ""}/>' for (sp, g), k in S.bld.items())
    return ('<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
            '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>'
            '<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' + effs +
            '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>'
            '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
            '</p:seq>' + audio + '</p:childTnLst></p:cTn></p:par></p:tnLst>' + (f'<p:bldLst>{bld}</p:bldLst>' if bld else '') + '</p:timing>'), S

def mp3_ms(data):
    # Dauer über ffprobe (Musik 160 kbps CBR, Sprache beliebig)
    with tempfile.NamedTemporaryFile(suffix='.mp3') as f:
        f.write(data); f.flush()
        return int(float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f.name])) * 1000)

def transition(meta):
    adv = meta['dur']
    TB = ' thruBlk="1"' if meta['thruBlk'] else ''
    fade = f'<p:transition spd="slow" advTm="{adv}"><p:fade{TB}/></p:transition>'
    if not meta.get('morph'): return fade
    # v3: Morph (PowerPoint 2019/365), sonst Überblendung
    return ('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
            '<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">'
            f'<p:transition spd="slow" advTm="{adv}"><p159:morph option="byObject"/></p:transition></mc:Choice>'
            f'<mc:Fallback>{fade}</mc:Fallback></mc:AlternateContent>')

zin = zipfile.ZipFile(SRC)
names = zin.namelist()
files = {n: zin.read(n) for n in names}

# --- dedupe media ---
canon, seen = {}, {}
for n in names:
    if n.startswith('ppt/media/'):
        h = hashlib.md5(files[n]).hexdigest() + posixpath.splitext(n)[1]
        if h in seen: canon[n] = seen[h]
        else: seen[h] = n
for n in list(names):
    if n.endswith('.rels'):
        x = files[n].decode('utf8')
        for dup, keep in canon.items():
            x = x.replace('../media/' + posixpath.basename(dup) + '"', '../media/' + posixpath.basename(keep) + '"')
        files[n] = x.encode('utf8')
for dup in canon: del files[dup]

files['[Content_Types].xml'] = files['[Content_Types].xml'].replace(b'ContentType="audio/mp3"', b'ContentType="audio/mpeg"')

nslides = len(META); ms_cache = {}; report = []
for n in list(files):
    m = re.match(r'ppt/slides/slide(\d+)\.xml$', n)
    if not m: continue
    k = int(m.group(1)) - 1; meta = META[k]
    xml = files[n].decode('utf8')
    xml = xml.replace('<a:videoFile r:link=', '<a:audioFile r:link=')
    kinds = {}
    for sm in re.finditer(r'<p:sp>(.*?)</p:sp>', xml, re.S):
        cid = re.search(r'<p:cNvPr id="(\d+)"', sm.group(1)).group(1)
        kinds[cid] = 'text' if '<a:t>' in sm.group(1) else 'shape'
    # Medien: 1. = Musik (läuft in die Folgefolie), 2. = Sprecher (nur diese Folie, Start 800 ms)
    rels = files[f'ppt/slides/_rels/slide{k + 1}.xml.rels'].decode('utf8')
    medias = []; nxt = max(int(v) for v in re.findall(r'<p:cNvPr id="(\d+)"', xml)) + 1
    for j, mm in enumerate(list(re.finditer(r'<p:cNvPr id="(\d+)" name="(Media[^"]*)"', xml))):
        name = 'Musik' if j == 0 else 'Sprecher'
        xml = xml.replace(mm.group(0), f'<p:cNvPr id="{nxt}" name="{name}"', 1)
        rid = re.search(r'<a:audioFile r:link="(rId\d+)"', xml[xml.find(f'name="{name}"'):]).group(1)
        tgt_ = re.search(rf'Id="{rid}" Type="[^"]+/audio" Target="\.\./media/([^"]+)"', rels).group(1)
        if tgt_ not in ms_cache: ms_cache[tgt_] = mp3_ms(files['ppt/media/' + tgt_])
        if j == 0: medias.append({'sp': str(nxt), 'ms': ms_cache[tgt_], 'delay': 0, 'vol': 80000, 'numSld': 1 if k == nslides - 1 else 2})
        else:
            assert VOICE_DELAY + ms_cache[tgt_] <= meta['dur'], f'Folie {k + 1}: Stimme länger als Folie'
            medias.append({'sp': str(nxt), 'ms': ms_cache[tgt_], 'delay': VOICE_DELAY, 'vol': 100000, 'numSld': 1})
        nxt += 1
    idm = ids(xml)
    tim, S = timing(meta, idm, kinds, medias)
    ins = transition(meta) + tim
    assert '<p:timing' not in xml
    xml = xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + ins, 1)
    # Prüfungen: eindeutige Shape-IDs, alle spid vorhanden, cTn-IDs eindeutig und aufsteigend
    sid = re.findall(r'<p:cNvPr id="(\d+)"', xml)
    assert len(sid) == len(set(sid)), f'Folie {k + 1}: doppelte Shape-ID'
    assert set(re.findall(r'spid="(\d+)"', xml)) <= set(sid), f'Folie {k + 1}: spid ohne Shape'
    ct = [int(v) for v in re.findall(r'<p:cTn id="(\d+)"', xml)]
    assert ct == sorted(ct) and len(ct) == len(set(ct)), f'Folie {k + 1}: cTn-IDs'
    report.append((k + 1, S.n, len(medias)))
    files[n] = xml.encode('utf8')

with zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in names:
        if n in files:
            z.writestr(zin.getinfo(n), files[n])
print('slides', nslides, 'deduped media', len(canon), 'total s', sum(m['dur'] for m in META) / 1000, 'max cTn', max(r[1] for r in report), 'voice slides', sum(1 for r in report if r[2] == 2))
