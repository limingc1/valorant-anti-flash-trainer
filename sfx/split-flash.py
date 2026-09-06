#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把「一整发闪光」的录音自动切成「出手」和「引爆」两段。

和 split-recorded.py 的区别：那个按静音切（适合一长串技能之间有停顿的录音），
这个处理的是单发闪光——出手、飞行、引爆是连在一起没有静音的，切不开。

判据：引爆瞬间「能量抬起」且「高频占比骤降」。
飞行段是嘶嘶的高频噪声（zcr 0.2~0.5），引爆是低频闷响（zcr 掉到 0.1 以下），
两个特征叠加比单看音量可靠得多——很多录音里出手比引爆还响。

用法：
    python split-flash.py 输入目录 输出目录
    python split-flash.py phoenix.wav out
    python split-flash.py in out --stereo        # 保留立体声（默认转单声道省体积）

输出：<名字>_throw.wav / <名字>_pop.wav，切点就是引爆起点，
两段接起来正好还原原声。文件名里的 ko 会自动改成 kayo（对上游戏里的特工键名）。
"""

import os
import sys
import wave
import array
import math
import argparse

WIN = 0.010          # 分析窗 10ms
SEARCH_LO = 0.35     # 引爆只在 35%~92% 时长之间找：太早是出手，太晚是尾巴
SEARCH_HI = 0.92
MIN_LEVEL = 0.25     # 引爆帧至少要有峰值的 25% 能量
PRE_ROLL = 0.02      # pop 段往前多留一点，别把起爆的第一下切掉
FADE = 0.04          # throw 段结尾淡出，避免硬切出「啪」的爆音
TAIL_DB = -45.0      # pop 段尾巴低于这个电平就截掉
PEAK_POP = -1.5      # 归一化目标：引爆是最响的一下
PEAK_THROW = -7.0    # 出手只是提示，压低一点，让引爆有冲击力
RENAME = {'ko': 'kayo'}
# 各特工「画面可见时刻」（秒，普通难度）：训练器把飞行段藏在墙后，
# t=0 时屏幕上什么都没有、声音却在响，听感就是「音效快一拍」。
# throw 段从这里开始截到引爆点，嘶嘶声才和画面上的球对上。
# breach 墙面黄点、reyna 紫眼都是 t=0 就出现，所以是 0。
VIS_AT = {'phoenix': 0.60, 'skye': 0.35, 'breach': 0.0,
          'kayo': 0.48, 'yoru': 0.37, 'reyna': 0.0}
# 个别音效的 pop 尾巴太长，硬截到指定秒数（120ms 淡出），实测 breach 尾音拖沓
POP_TAIL_CUT = {'breach': 0.70}


def normalize(buf, target_db):
    """把片段峰值拉到 target_db（dBFS）。原始录音普遍在 -13~-20dB，
    直接丢进游戏几乎听不见（游戏不做额外增益，内置合成音约 -5dB）。"""
    pk = max(max(buf), -min(buf)) if len(buf) else 0
    if pk <= 0:
        return buf
    want = (10 ** (target_db / 20.0)) * 32767.0
    g = want / pk
    if abs(g - 1.0) < 0.01:
        return buf
    for i in range(len(buf)):
        v = int(buf[i] * g)
        buf[i] = -32768 if v < -32768 else (32767 if v > 32767 else v)
    return buf


def read_wav(path):
    with wave.open(path, 'rb') as w:
        nch, sw, sr = w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(w.getnframes())
    if sw != 2:
        raise SystemExit('%s 不是 16-bit PCM，请先转一下' % path)
    a = array.array('h')
    a.frombytes(raw)
    if sys.byteorder == 'big':
        a.byteswap()
    return a, nch, sr


def to_mono(a, nch):
    if nch == 1:
        return a
    mono = array.array('h', bytes(2 * (len(a) // nch)))
    for i in range(len(mono)):
        b = i * nch
        s = 0
        for c in range(nch):
            s += a[b + c]
        mono[i] = s // nch
    return mono


def frames(mono, sr):
    """逐 10ms 算 RMS 与零交叉率（zcr 当作亮度的廉价替身）。"""
    win = max(1, int(sr * WIN))
    rms, zcr = [], []
    for i in range(0, len(mono) - win, win):
        ch = mono[i:i + win]
        rms.append((sum(v * v for v in ch) / len(ch)) ** 0.5)
        z = 0
        for k in range(1, len(ch)):
            if (ch[k - 1] >= 0) != (ch[k] >= 0):
                z += 1
        zcr.append(z / float(len(ch)))
    return rms, zcr, win


def find_pop(rms, zcr):
    """返回 (引爆帧下标, 打分明细)。找不到就返回 (None, [])。"""
    n = len(rms)
    peak = max(rms) or 1.0
    lo, hi = int(n * SEARCH_LO), int(n * SEARCH_HI)
    cands = []
    for i in range(max(6, lo), max(max(6, lo) + 1, hi)):
        if rms[i] < peak * MIN_LEVEL:
            continue
        prev = max(rms[i - 6:i]) or 1.0
        rise = 20 * math.log10(rms[i] / prev)          # 能量抬升 dB
        zb = sum(zcr[i - 6:i]) / 6.0                    # 之前的亮度
        za = sum(zcr[i:i + 5]) / len(zcr[i:i + 5])      # 之后的亮度
        drop = zb - za                                  # 高频塌陷幅度
        lvl = 20 * math.log10(rms[i] / peak)            # 本帧电平（<=0）
        # 必须带上本帧电平：只看「抬升+塌陷」的话，尾巴里一个安静的小起伏
        # 也能拿高分（breach 就被切到 2.24s / -11.6dB 的尾巴上）。
        # 引爆一定是整段里最响的几下之一。
        score = rise + drop * 30.0 + lvl * 0.6
        cands.append((score, i, rise, drop, lvl))
    if not cands:
        return None, []
    cands.sort(reverse=True)
    return cands[0][1], cands[:3]


def fade(buf, n_in, n_out):
    for i in range(min(n_in, len(buf))):
        buf[i] = int(buf[i] * i / float(n_in))
    for i in range(min(n_out, len(buf))):
        j = len(buf) - 1 - i
        buf[j] = int(buf[j] * i / float(n_out))
    return buf


def trim_tail(mono, sr, start):
    """从后往前找尾巴：连续低于 TAIL_DB 就截掉。"""
    win = max(1, int(sr * WIN))
    peak = max(max(mono), -min(mono)) or 1
    thr = peak * (10 ** (TAIL_DB / 20.0))
    end = len(mono)
    while end - win > start:
        ch = mono[end - win:end]
        if (max(max(ch), -min(ch))) > thr:
            break
        end -= win
    return end


def write_wav(path, samples, sr, nch):
    with wave.open(path, 'wb') as w:
        w.setnchannels(nch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def slice_frames(a, nch, i0, i1):
    """按「帧」（一帧 = nch 个采样）切片，保持声道对齐。"""
    return array.array('h', a[i0 * nch:i1 * nch])


def process(path, outdir, keep_stereo, override=None, norm=True,
            peak_throw=PEAK_THROW, peak_pop=PEAK_POP, vis_at=None):
    a, nch, sr = read_wav(path)
    mono = to_mono(a, nch)
    rms, zcr, win = frames(mono, sr)
    if len(rms) < 20:
        print('  跳过 %s：太短' % os.path.basename(path))
        return None
    base = os.path.splitext(os.path.basename(path))[0].lower()
    base = RENAME.get(base, base)

    note = ''
    if override is not None:
        pop_at = int(override * sr)
        note = ' (手动指定切点)'
    else:
        idx, cands = find_pop(rms, zcr)
        if idx is None:
            print('  跳过 %s：找不到引爆点' % os.path.basename(path))
            return None
        pop_at = idx * win
        note = ''

    # throw 段起点 = 画面可见时刻。t=0 屏幕上还没有球，从 0 开播就是「声音快一拍」。
    vis = 0 if vis_at is None else int(vis_at * sr)
    vis = max(0, min(vis, pop_at - int(sr * 0.10)))   # 至少给 throw 留 0.1s

    pre = int(PRE_ROLL * sr)
    cut = max(0, min(len(mono) - 1, pop_at - pre))
    start = max(0, min(vis, cut))
    end = trim_tail(mono, sr, cut)

    src = a if keep_stereo else mono
    och = nch if keep_stereo else 1
    thr_buf = slice_frames(src, och, start, cut) if keep_stereo else array.array('h', src[start:cut])
    pop_buf = slice_frames(src, och, cut, end) if keep_stereo else array.array('h', src[cut:end])
    fade(thr_buf, 0, int(FADE * sr) * och)
    fade(pop_buf, int(0.003 * sr) * och, int(0.02 * sr) * och)
    if norm:
        normalize(thr_buf, peak_throw)
        normalize(pop_buf, peak_pop)

    hard = POP_TAIL_CUT.get(base)
    if hard:
        keep = int(hard * sr) * och
        fade_n = int(0.12 * sr) * och
        pop_buf = pop_buf[:min(keep, len(pop_buf))]
        for i in range(min(fade_n, len(pop_buf))):
            j = len(pop_buf) - 1 - i
            pop_buf[j] = int(pop_buf[j] * (i / fade_n))

    write_wav(os.path.join(outdir, base + '_throw.wav'), thr_buf, sr, och)
    write_wav(os.path.join(outdir, base + '_pop.wav'), pop_buf, sr, och)

    print('  %-9s 可见 %.2fs | throw %.2fs（%.2f~%.2f）  pop %.2fs %s' % (
        base, start / float(sr), (cut - start) / float(sr),
        start / float(sr), cut / float(sr), (end - cut) / float(sr), note))
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input', help='wav 文件或目录')
    ap.add_argument('outdir', nargs='?', default='flash_clips')
    ap.add_argument('--stereo', action='store_true', help='保留立体声（默认转单声道省一半体积）')
    ap.add_argument('--at', action='append', default=[], metavar='名字=秒',
                    help='手动指定切点，自动判断不准时用，可重复：--at breach=1.15')
    ap.add_argument('--no-normalize', action='store_true',
                    help='不做音量归一化（默认会把 pop 拉到 %.1fdB、throw 到 %.1fdB）'
                         % (PEAK_POP, PEAK_THROW))
    ap.add_argument('--peak-pop', type=float, default=PEAK_POP, metavar='dB')
    ap.add_argument('--peak-throw', type=float, default=PEAK_THROW, metavar='dB')
    ap.add_argument('--no-vis', action='store_true',
                    help='throw 段从 0 开始截（原始整段），不做「可见时刻」对齐')
    a = ap.parse_args()

    forced = {}
    for item in a.at:
        if '=' not in item:
            raise SystemExit('--at 要写成 名字=秒，例如 --at breach=1.15')
        k, v = item.split('=', 1)
        forced[k.strip().lower()] = float(v)

    files = []
    if os.path.isdir(a.input):
        for n in sorted(os.listdir(a.input)):
            if n.lower().endswith('.wav'):
                files.append(os.path.join(a.input, n))
    else:
        files = [a.input]
    if not files:
        raise SystemExit('没找到 wav 文件')

    os.makedirs(a.outdir, exist_ok=True)
    print('切分 %d 个文件 -> %s/  （%s）' % (
        len(files), a.outdir, '立体声' if a.stereo else '单声道'))
    done = []
    for p in files:
        stem = os.path.splitext(os.path.basename(p))[0].lower()
        key = RENAME.get(stem, stem)
        ov = forced.get(stem, forced.get(key))
        vis = None if a.no_vis else VIS_AT.get(key)
        r = process(p, a.outdir, a.stereo, ov,
                    norm=not a.no_normalize,
                    peak_throw=a.peak_throw, peak_pop=a.peak_pop, vis_at=vis)
        if r:
            done.append(r)
    print('\n完成 %d 个，共 %d 个片段。' % (len(done), len(done) * 2))
    print('听一遍；切得不对用 --at 名字=秒 重跑，可见时刻不对用 --vis-参数改 VIS_AT。')
    print('把需要的 <特工>_throw.wav / <特工>_pop.wav 复制进 sfx/ 即可；')
    print('游戏认的特工键名：phoenix / skye / breach / kayo / yoru / reyna。')


if __name__ == '__main__':
    main()
