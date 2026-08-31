#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把录好的长音频按静音自动切成一段段，方便丢进 sfx/ 目录。

用法：
    python split-recorded.py 录音.wav
    python split-recorded.py 录音.wav out_dir
    python split-recorded.py 录音.wav out_dir --threshold 0.04 --gap 0.25

输入必须是 16-bit PCM 的 wav。如果是 mp3 / m4a / ogg，先用 ffmpeg 转一次：

    ffmpeg -i 录音.m4a -ac 1 -ar 44100 -sample_fmt s16 录音.wav

参数：
    --threshold  静音判定阈值，相对整段最大音量的比例，默认 0.05
                 录得干净就调大（0.08），底噪大就调小（0.03）
    --gap        多长的静音才算切开，默认 0.22 秒
                 技能之间间隔太近就调大，怕切碎就调小
    --min        短于这个时长的片段直接丢弃，默认 0.10 秒
    --pad        每个片段前后各留多少秒，默认 0.03 秒，避免开头爆音

输出：
    clip_001.wav  clip_002.wav ...  按时间顺序编号
    屏幕上会打印每段的起点和时长，照你自己录制时的顺序重命名即可。
"""

import sys
import os
import wave
import array
import argparse

WIN_SEC = 0.01          # RMS 统计窗口


def read_wav_mono(path):
    """读 16-bit wav，混成单声道，返回 (采样 array('h'), 采样率)。"""
    with wave.open(path, 'rb') as w:
        nch = w.getnchannels()
        sw = w.getsampwidth()
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    if sw != 2:
        raise SystemExit('只支持 16-bit PCM wav，请先转成 -sample_fmt s16')

    a = array.array('h')
    a.frombytes(raw)
    if sys.byteorder == 'big':
        a.byteswap()

    if nch == 1:
        return a, sr

    mono = array.array('h', bytes(2 * (len(a) // nch)))
    for i in range(len(mono)):
        base = i * nch
        s = 0
        for c in range(nch):
            s += a[base + c]
        mono[i] = s // nch
    return mono, sr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('outdir', nargs='?', default='clips')
    ap.add_argument('--threshold', type=float, default=0.05)
    ap.add_argument('--gap', type=float, default=0.22)
    ap.add_argument('--min', type=float, default=0.10)
    ap.add_argument('--pad', type=float, default=0.03)
    a = ap.parse_args()

    data, sr = read_wav_mono(a.input)
    if not data:
        raise SystemExit('音频是空的')

    peak = max(max(data), -min(data)) or 1
    thr = peak * a.threshold

    # 按窗口算 RMS，得到粗粒度的「有声 / 无声」序列
    win = max(1, int(sr * WIN_SEC))
    loud = []
    for i in range(0, len(data), win):
        chunk = data[i:i + win]
        rms = (sum(v * v for v in chunk) / len(chunk)) ** 0.5
        loud.append(rms > thr)

    # 找出有声区间
    segs = []
    start = None
    for idx, is_loud in enumerate(loud):
        if is_loud and start is None:
            start = idx
        elif not is_loud and start is not None:
            segs.append((start, idx))
            start = None
    if start is not None:
        segs.append((start, len(loud)))

    # 间隔过近的片段合并 —— 一个技能音中间常有小停顿
    gap_win = max(1, int(a.gap / WIN_SEC))
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] <= gap_win:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))

    os.makedirs(a.outdir, exist_ok=True)
    pad_n = int(a.pad * sr)
    n_out = 0
    print('%-12s %-10s %-10s' % ('文件', '起点', '时长'))
    print('-' * 34)
    for s, e in merged:
        i0 = max(0, int(s * win) - pad_n)
        i1 = min(len(data), int(e * win) + pad_n)
        dur = (i1 - i0) / float(sr)
        if dur < a.min:
            continue
        n_out += 1
        name = 'clip_%03d.wav' % n_out
        with wave.open(os.path.join(a.outdir, name), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(data[i0:i1].tobytes())
        print('%-12s %-10s %-10s' % (name, '%.2fs' % (i0 / float(sr)), '%.2fs' % dur))

    print('\n共 %d 段，输出在 %s/' % (n_out, a.outdir))
    if n_out:
        print('照上面的起点时间，按你录制时的顺序重命名成 phoenix_pop.wav 之类，')
        print('再放进 sfx/ 目录即可。')
    else:
        print('一段都没切出来，把 --threshold 调小试试（当前 %g）。' % a.threshold)


if __name__ == '__main__':
    main()
