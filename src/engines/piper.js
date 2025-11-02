import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const PIPER_BIN   = process.env.PIPER_BIN || 'piper';
const VOICES_DIR  = process.env.PIPER_VOICES_DIR || 'src/voices/piper';
const DEFAULT_V   = process.env.PIPER_DEFAULT_VOICE || 'en_US-amy-low';

// Convert frontend speed (1.0 = normal, 1.2 = faster) to Piper length_scale.
// Piper: length_scale > 1 => slower, < 1 => faster. We'll do length_scale = 1 / speed.
function speedToLengthScale(speed) {
  const s = Number(speed);
  if (!s || !isFinite(s) || s <= 0) return 1.0;
  return +(1 / s).toFixed(3);
}

// Resolve model files by voice (basename)
function resolveModel(voiceName) {
  const base = voiceName || DEFAULT_V;
  const onnx = path.resolve(VOICES_DIR, `${base}.onnx`);
  const cfg  = path.resolve(VOICES_DIR, `${base}.onnx.json`);
  if (!fs.existsSync(onnx)) throw new Error(`Model not found: ${onnx}`);
  if (!fs.existsSync(cfg))  throw new Error(`Model config not found: ${cfg}`);
  return { onnx, cfg };
}

// temp wav path
function tmpWavPath() {
  const id = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `piper-${id}.wav`);
}

export async function ttsPiper({ text, voice, speed }, res) {
  const { onnx, cfg } = resolveModel(voice);
  const outFile = tmpWavPath();

  const args = [
  '-m', onnx,       // model file
  '-c', cfg,        // config json
  '-f', 'wav',      // output format
  '-o', outFile     // output file
];

  // Apply speed (length_scale)
  const lengthScale = speedToLengthScale(speed);
  if (lengthScale !== 1.0) {
    args.push('--length_scale', String(lengthScale));
  }

  // Start Piper process
  const child = spawn(PIPER_BIN, args, { stdio: ['pipe', 'inherit', 'inherit'] });

  child.on('error', (e) => {
    console.error('Failed to start Piper:', e);
    if (!res.headersSent) res.status(500).end('Piper start error');
    try { child.kill(); } catch {}
  });

  // Piper reads input text from stdin
  child.stdin.write(String(text).trim() + '\n');
  child.stdin.end();

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('Piper exited with code', code);
      if (!res.headersSent) return res.status(500).end('Piper synthesis failed');
      return res.end();
    }

    // Stream WAV back, then delete temp file
    const stream = fs.createReadStream(outFile);
    stream.on('error', (e) => {
      console.error('WAV read error:', e);
      if (!res.headersSent) res.status(500).end('Audio read error');
      else res.end();
      try { fs.unlinkSync(outFile); } catch {}
    });
    stream.on('close', () => {
      try { fs.unlinkSync(outFile); } catch {}
    });
    stream.pipe(res);
  });
}
