// Hero animation for the README (/demos/img/hero.webp): whole-page screenshots of scenes (cf. /scripts/demos.ts),
// each held for a while, cross-faded, the last fading back into the first (seamless loop).
// Usage: node scripts/hero.ts [folder of frames] (default: /sandbox/hero); needs ffmpeg (with libwebp) on the PATH.
// NOTE: animated WebP (GitHub shows it as an image; much smaller than a GIF; a video in the repo shows only as a link).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ===============================================================
// CONSTANTS
// ===============================================================

export const PATH_FRAMES = 'sandbox/hero';
export const PATH_HERO = 'demos/img/hero.webp';

// timing (seconds), frame rate, width of the animation (pixels; screenshots are 1400 wide), quality (0–100)
const HOLD = 2.0;
const FADE = 0.35;
const FPS = 10;
const WIDTH = 1120;
const QUALITY = 70;

// ===============================================================
// METHODS
// ===============================================================

/** @returns encoder of ffmpeg for animated WebP: libwebp_anim (frame differences: small), else libwebp; none: '' */
export function encoder(): string {
    try {
        const list = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
        return ['libwebp_anim', 'libwebp'].find((name) => new RegExp(`\\b${name}\\b`).test(list)) ?? '';
    } catch {
        return ''; // no ffmpeg
    }
}

/** Joins the frames (PNG, in name order) of a folder into the animation. */
export function encode(dir: string = PATH_FRAMES, out: string = PATH_HERO): void {
    const frames = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.png'))
        .sort()
        .map((name) => path.join(dir, name));
    if (frames.length < 2) throw new Error(`too few frames in ${dir}`);
    const codec = encoder();
    if (!codec) throw new Error('no ffmpeg with libwebp on the PATH');

    // the first again at the end, shown only while fading in: the loop starts over seamlessly
    const all = [...frames, frames[0]];
    const last = all.length - 1;
    const inputs = all.flatMap((file, i) => ['-loop', '1', '-t', String(i === last ? FADE : HOLD + FADE), '-i', file]);

    // each input scaled, at the same rate; then cross-faded in turn (the k-th fade starts at k × HOLD)
    const scaled = all.map((_, i) => `[${i}:v]scale=${WIDTH}:-2:flags=lanczos,fps=${FPS},settb=AVTB[s${i}]`);
    const fades = all.slice(1).map((_, k) => {
        const from = k === 0 ? '[s0]' : `[f${k}]`;
        return `${from}[s${k + 1}]xfade=transition=fade:duration=${FADE}:offset=${((k + 1) * HOLD).toFixed(2)}[f${k + 1}]`;
    });
    const graph = [...scaled, ...fades].join(';');

    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(
        'ffmpeg',
        [
            ...['-y', '-loglevel', 'error'],
            ...inputs,
            ...['-filter_complex', graph, '-map', `[f${last}]`],
            ...['-c:v', codec, '-quality', String(QUALITY), '-compression_level', '6', '-loop', '0', '-an'],
            out,
        ],
        { stdio: 'inherit' },
    );
    console.log(`wrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, ${frames.length} scenes)`);
}

// run directly: node scripts/hero.ts [folder]
if (import.meta.main) encode(process.argv[2] || PATH_FRAMES);
