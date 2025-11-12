import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import { LRUCache } from 'lru-cache';


const app = express();
app.use(express.json({ limit: '1mb' }));

const MURF_API_KEY = process.env.MURF_API_KEY;
const DEFAULT_VOICE = process.env.MURF_DEFAULT_VOICE || 'en-US-natalie';
const DEFAULT_FORMAT = process.env.MURF_DEFAULT_FORMAT || 'MP3';
const CACHE_SIZE = parseInt(process.env.TTS_CACHE_SIZE || '200', 10);
const PORT = process.env.PORT || 3001;

if (!MURF_API_KEY) {
  console.error('Missing MURF_API_KEY in .env');
  process.exit(1);
}

// simple in-memory cache: key = voice|format|rate|pitch|variation|text
const cache = new LRUCache({ max: CACHE_SIZE });


app.get('/api/tts/health', (req, res) => res.json({ ok: true }));

// ---------- MAIN: Non-streaming TTS (recommended for demo) ----------
app.post('/api/tts', async (req, res) => {
  try {
    const {
      text,
      voiceId = DEFAULT_VOICE,
      format = DEFAULT_FORMAT,
      rate = 0,            // -50..50
      pitch = 0,           // -50..50
      variation = 1,       // 0..5 (adds naturalness)
      modelVersion = 'GEN2'// higher-quality voices
    } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const cacheKey = `${voiceId}|${format}|${rate}|${pitch}|${variation}|${text}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', mimeFromFormat(format));
      return res.send(cached);
    }

    // Murf "Synthesize Speech" REST endpoint
    const resp = await axios.post(
      'https://api.murf.ai/v1/speech/generate',
      {
        text,
        voiceId,           // e.g. 'en-IN-aishwarya' or 'en-US-natalie'
        format,            // MP3|WAV|FLAC|OGG|ALAW|ULAW|PCM
        modelVersion,      // GEN2 recommended per docs
        rate,
        pitch,
        variation,
        encodeAsBase64: true // ask Murf to return audio inline
      },
      {
        headers: { 'api-key': MURF_API_KEY },
        timeout: 30000
      }
    );

    const { encodedAudio, audioFile } = resp.data || {};
    let audioBuffer;

    if (encodedAudio) {
      audioBuffer = Buffer.from(encodedAudio, 'base64');
    } else if (audioFile) {
      // fallback: fetch audio URL if base64 wasn’t returned
      const f = await axios.get(audioFile, { responseType: 'arraybuffer' });
      audioBuffer = Buffer.from(f.data);
    } else {
      return res.status(502).json({ error: 'No audio returned from Murf' });
    }

    cache.set(cacheKey, audioBuffer);
    res.setHeader('Content-Type', mimeFromFormat(format));
    res.send(audioBuffer);
  } catch (err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  console.error('Murf TTS error:', status, data, err.message);
  // TEMP: surface the real error so we know what's wrong
  return res.status(502).json({ error: 'TTS unavailable', status, data });
}

});

function mimeFromFormat(fmt) {
  const f = (fmt || '').toUpperCase();
  if (f === 'MP3') return 'audio/mpeg';
  if (f === 'WAV' || f === 'PCM') return 'audio/wav';
  if (f === 'FLAC') return 'audio/flac';
  if (f === 'OGG') return 'audio/ogg';
  if (f === 'ALAW' || f === 'ULAW') return 'audio/basic';
  return 'application/octet-stream';
}

app.listen(PORT, () => {
  console.log(`TTS server running on :${PORT}`);
});
