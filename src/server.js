import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { ttsPiper } from './engines/piper.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Health check (GET /health)
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Root message (GET /)
app.get('/', (req, res) => {
  res.send('Callarity Piper TTS is alive. POST /api/tts to synthesize audio.');
});

// TTS endpoint (POST /api/tts)
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice, speed } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    res.setHeader('Content-Type', 'audio/wav');
    await ttsPiper({ text, voice, speed }, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'TTS failed' });
    else res.end();
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Piper TTS listening on :${port}`));
