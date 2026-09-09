import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import QRCode from 'qrcode';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined,
  credentials: process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    : undefined
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 100 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imágenes.'));
    cb(null, true);
  }
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

function cleanSlug(value = '') {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function safeFileName(value = 'foto.jpg') {
  const parts = value.split('.');
  const ext = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const base = cleanSlug(parts.join('.')) || 'foto';
  return `${base}${ext || '.jpg'}`;
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'PHOTO FEST API' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Base de datos no disponible.' });
  }
});

app.get('/api/events', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.id, e.name, e.event_date, e.place, e.slug, e.active, e.created_at,
             COUNT(p.id)::int AS photos
      FROM events e
      LEFT JOIN photos p ON p.event_id = e.id
      GROUP BY e.id
      ORDER BY e.event_date DESC, e.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudieron cargar los eventos.' });
  }
});

app.post('/api/events', async (req, res) => {
  const { name, event_date, place = '', slug: rawSlug = '' } = req.body || {};
  const slug = cleanSlug(rawSlug || name);
  if (!name || !event_date || !slug) return res.status(400).json({ error: 'Nombre, fecha y código son obligatorios.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO events (name, event_date, place, slug)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name.trim(), event_date, place.trim(), slug]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    if (error.code === '23505') return res.status(409).json({ error: 'Ese código de evento ya existe.' });
    res.status(500).json({ error: 'No se pudo crear el evento.' });
  }
});

app.get('/api/events/:slug', async (req, res) => {
  try {
    const eventResult = await pool.query('SELECT * FROM events WHERE slug = $1 AND active = TRUE', [req.params.slug]);
    if (!eventResult.rowCount) return res.status(404).json({ error: 'Evento no encontrado.' });

    const photosResult = await pool.query(
      'SELECT id, file_name, public_url, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC',
      [eventResult.rows[0].id]
    );

    res.json({ ...eventResult.rows[0], photos: photosResult.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo cargar el evento.' });
  }
});

app.get('/api/events/:slug/photos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.file_name, p.public_url, p.created_at
       FROM photos p
       JOIN events e ON e.id = p.event_id
       WHERE e.slug = $1 AND e.active = TRUE
       ORDER BY p.created_at DESC`,
      [req.params.slug]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudieron cargar las fotografías.' });
  }
});

app.post('/api/events/:slug/photos', upload.array('photos', 100), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Selecciona al menos una fotografía.' });

  try {
    const eventResult = await pool.query('SELECT id, slug FROM events WHERE slug = $1', [req.params.slug]);
    if (!eventResult.rowCount) return res.status(404).json({ error: 'Evento no encontrado.' });
    const event = eventResult.rows[0];

    const uploaded = [];
    for (const file of files) {
      const fileName = safeFileName(file.originalname);
      const key = `events/${event.slug}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${fileName}`;

      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable'
      }));

      const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
      const publicUrl = `${publicBase}/${key}`;
      const { rows } = await pool.query(
        `INSERT INTO photos (event_id, object_key, file_name, public_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id, file_name, public_url, created_at`,
        [event.id, key, file.originalname, publicUrl]
      );
      uploaded.push(rows[0]);
    }

    res.status(201).json({ uploaded: uploaded.length, photos: uploaded });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudieron subir las fotografías.' });
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    const photoResult = await pool.query('SELECT object_key FROM photos WHERE id = $1', [req.params.id]);
    if (!photoResult.rowCount) return res.status(404).json({ error: 'Fotografía no encontrada.' });

    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: photoResult.rows[0].object_key }));
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo eliminar la fotografía.' });
  }
});

app.get('/api/events/:slug/qr', async (req, res) => {
  try {
    const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const eventUrl = `${frontend}/photofest/galeria.html?evento=${encodeURIComponent(req.params.slug)}`;
    const dataUrl = await QRCode.toDataURL(eventUrl, { margin: 1, width: 512 });
    res.json({ url: eventUrl, qr: dataUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo generar el QR.' });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
  res.status(400).json({ error: error.message || 'Solicitud inválida.' });
});

app.listen(port, () => console.log(`PHOTO FEST API lista en puerto ${port}`));
