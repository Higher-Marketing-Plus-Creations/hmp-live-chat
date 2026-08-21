import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const OPENAI_REALTIME_CLIENT_SECRET_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const REALTIME_MODEL = 'gpt-realtime';

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

app.use(express.json({ limit: '20kb' }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/realtime/session', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).json({
      error: 'server_not_configured',
      message: 'OPENAI_API_KEY is not configured on the local server.'
    });
    return;
  }

  try {
    const response = await fetch(OPENAI_REALTIME_CLIENT_SECRET_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: 600
        },
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions: 'You are the HMP AI Assistant. Be concise, helpful, and professional.',
          output_modalities: ['audio'],
          audio: {
            output: {
              voice: 'marin'
            }
          }
        }
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const upstreamMessage = data?.error?.message || 'OpenAI Realtime client secret request failed.';
      console.error('[Realtime Local Server] OpenAI request failed', {
        status: response.status,
        type: data?.error?.type,
        code: data?.error?.code
      });

      res.status(response.status).json({
        error: 'openai_realtime_session_failed',
        message: upstreamMessage
      });
      return;
    }

    res.json({
      clientSecret: data.value,
      expiresAt: data.expires_at,
      model: data.session?.model || REALTIME_MODEL,
      session: data.session
    });
  } catch (error) {
    console.error('[Realtime Local Server] Unexpected request failure', {
      message: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'realtime_session_error',
      message: 'Unable to create a Realtime session.'
    });
  }
});

app.use((error, req, res, next) => {
  if (error?.message === 'Origin not allowed by CORS') {
    res.status(403).json({
      error: 'cors_origin_denied',
      message: 'This origin is not allowed to use the local Realtime server.'
    });
    return;
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`[Realtime Local Server] Listening on http://localhost:${PORT}`);
});
