const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 8080;

// Ensure storage directories exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'vault.db');
const db = new sqlite3.Database(DB_PATH);

// Initialize Database Schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      storage_quota_bytes INTEGER DEFAULT 5368709120,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      folder_id INTEGER,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      description TEXT,
      notes TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(folder_id) REFERENCES folders(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_tags (
      document_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY(document_id, tag_id),
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  // Seed initial admin if specified in env
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@vault.local';
  const adminPass = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  
  db.get(`SELECT id FROM users WHERE email = ?`, [adminEmail], (err, row) => {
    if (!row) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(adminPass, salt, 10000, 64, 'sha256').toString('hex');
      const storedHash = `${salt}:${hash}`;
      db.run(`INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)`,
        [adminEmail, storedHash, 'System Administrator', 'admin'],
        (err) => {
          if (!err) console.log(`Initialized default admin account: ${adminEmail}`);
        }
      );
    }
  });
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Simple cookie parser
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie;
  req.cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      req.cookies[parts[0].trim()] = decodeURIComponent(parts[1] || '');
    });
  }
  next();
});

// Authentication middleware
function requireAuth(req, res, next) {
  const token = req.cookies.session_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  db.get(`SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')`, [token], (err, session) => {
    if (err || !session) return res.status(401).json({ error: 'Session expired or invalid' });
    
    db.get(`SELECT id, email, display_name, storage_quota_bytes, role FROM users WHERE id = ?`, [session.user_id], (err, user) => {
      if (err || !user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      next();
    });
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  db.get(`SELECT 1`, (err) => {
    if (err) {
      res.status(500).json({ status: 'error', database: err.message });
    } else {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    }
  });
});

// Auth API
app.post('/api/auth/register', (req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
  const storedHash = `${salt}:${hash}`;

  db.run(`INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)`,
    [email, storedHash, display_name || email.split('@')[0]],
    function(err) {
      if (err) return res.status(400).json({ error: 'Email already registered or invalid' });
      
      const userId = this.lastID;
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.run(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`, [token, userId, expires], (err) => {
        if (err) return res.status(500).json({ error: 'Session creation failed' });
        res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
        res.json({ success: true, user: { id: userId, email, display_name } });
      });
    }
  );
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Invalid email or password' });

    const [salt, storedHash] = user.password_hash.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');

    if (hash !== storedHash) return res.status(401).json({ error: 'Invalid email or password' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.run(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`, [token, user.id, expires], (err) => {
      if (err) return res.status(500).json({ error: 'Session creation failed' });
      res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
      res.json({ success: true, user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role } });
    });
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.cookies.session_token;
  db.run(`DELETE FROM sessions WHERE id = ?`, [token], () => {
    res.setHeader('Set-Cookie', `session_token=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ success: true });
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  db.get(`SELECT SUM(size_bytes) as used FROM documents WHERE user_id = ? AND status != 'deleted'`, [req.user.id], (err, row) => {
    const used = (row && row.used) || 0;
    res.json({
      user: req.user,
      storage: {
        used_bytes: used,
        quota_bytes: req.user.storage_quota_bytes,
        percentage: Math.min(100, parseFloat(((used / req.user.storage_quota_bytes) * 100).toFixed(2)))
      }
    });
  });
});

// Folders API
app.get('/api/folders', requireAuth, (req, res) => {
  db.all(`SELECT * FROM folders WHERE user_id = ? ORDER BY name ASC`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/folders', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Folder name required' });

  db.run(`INSERT INTO folders (user_id, name) VALUES (?, ?)`, [req.user.id, name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, user_id: req.user.id });
  });
});

// Tags API
app.get('/api/tags', requireAuth, (req, res) => {
  db.all(`SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/tags', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Tag name required' });

  db.run(`INSERT INTO tags (user_id, name) VALUES (?, ?)`, [req.user.id, name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, user_id: req.user.id });
  });
});

// Documents API
app.get('/api/documents', requireAuth, (req, res) => {
  const { folder_id, status = 'active', search, tag_id } = req.query;
  let query = `
    SELECT d.*, f.name as folder_name 
    FROM documents d 
    LEFT JOIN folders f ON d.folder_id = f.id 
    WHERE d.user_id = ?
  `;
  const params = [req.user.id];

  if (status === 'deleted') {
    query += ` AND d.status = 'deleted'`;
  } else {
    query += ` AND d.status != 'deleted'`;
  }

  if (folder_id) {
    query += ` AND d.folder_id = ?`;
    params.push(folder_id);
  }

  if (search) {
    query += ` AND (d.original_name LIKE ? OR d.description LIKE ? OR d.notes LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ` ORDER BY d.created_at DESC`;

  db.all(query, params, (err, docs) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Fetch tags for documents
    if (docs.length === 0) return res.json([]);

    const docIds = docs.map(d => d.id);
    db.all(`
      dt.document_id, t.id as tag_id, t.name as tag_name 
      FROM document_tags dt 
      JOIN tags t ON dt.tag_id = t.id 
      WHERE dt.document_id IN (${docIds.map(() => '?').join(',')})
    `.replace(/^\s+/, ''), docIds, (err, tags) => {
      const tagMap = {};
      if (!err && tags) {
        tags.forEach(t => {
          if (!tagMap[t.document_id]) tagMap[t.document_id] = [];
          tagMap[t.document_id].push({ id: t.tag_id, name: t.tag_name });
        });
      }

      docs.forEach(d => {
        d.tags = tagMap[d.id] || [];
      });

      if (tag_id) {
        const filtered = docs.filter(d => d.tags.some(t => t.tag_id == tag_id));
        return res.json(filtered);
      }

      res.json(docs);
    });
  });
});

// Upload Document
app.post('/api/documents', requireAuth, (req, res) => {
  const { original_name, content_base64, mime_type, folder_id, description, notes, tag_ids } = req.body;
  if (!original_name || !content_base64) return res.status(400).json({ error: 'File name and content required' });

  const buffer = Buffer.from(content_base64, 'base64');
  const sizeBytes = buffer.length;

  // Check quota
  db.get(`SELECT SUM(size_bytes) as used FROM documents WHERE user_id = ? AND status != 'deleted'`, [req.user.id], (err, row) => {
    const used = (row && row.used) || 0;
    if (used + sizeBytes > req.user.storage_quota_bytes) {
      return res.status(400).json({ error: 'Storage quota exceeded (5 GB limit)' });
    }

    const storedName = `${crypto.randomUUID()}_${Date.now()}`;
    const targetPath = path.join(UPLOADS_DIR, storedName);

    fs.writeFile(targetPath, buffer, (err) => {
      if (err) return res.status(500).json({ error: 'Failed to write file' });

      db.run(`
        INSERT INTO documents (user_id, folder_id, original_name, stored_name, description, notes, mime_type, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [req.user.id, folder_id || null, original_name, storedName, description || '', notes || '', mime_type || 'application/octet-stream', sizeBytes],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const docId = this.lastID;

        if (tag_ids && Array.isArray(tag_ids) && tag_ids.length > 0) {
          const stmt = db.prepare(`INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)`);
          tag_ids.forEach(tid => stmt.run(docId, tid));
          stmt.finalize();
        }

        res.json({ success: true, id: docId });
      });
    });
  });
});

// Download Document
app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const docId = req.params.id;
  db.get(`SELECT * FROM documents WHERE id = ? AND user_id = ?`, [docId, req.user.id], (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(UPLOADS_DIR, doc.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on storage' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
    res.setHeader('Content-Type', doc.mime_type);
    fs.createReadStream(filePath).pipe(res);
  });
});

// Preview Document
app.get('/api/documents/:id/preview', requireAuth, (req, res) => {
  const docId = req.params.id;
  db.get(`SELECT * FROM documents WHERE id = ? AND user_id = ?`, [docId, req.user.id], (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(UPLOADS_DIR, doc.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on storage' });

    res.setHeader('Content-Type', doc.mime_type);
    fs.createReadStream(filePath).pipe(res);
  });
});

// Update Document
app.put('/api/documents/:id', requireAuth, (req, res) => {
  const docId = req.params.id;
  const { description, notes, folder_id, tag_ids } = req.body;

  db.run(`
    UPDATE documents SET description = ?, notes = ?, folder_id = ? 
    WHERE id = ? AND user_id = ?
  `, [description || '', notes || '', folder_id || null, docId, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    db.run(`DELETE FROM document_tags WHERE document_id = ?`, [docId], () => {
      if (tag_ids && Array.isArray(tag_ids) && tag_ids.length > 0) {
        const stmt = db.prepare(`INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)`);
        tag_ids.forEach(tid => stmt.run(docId, tid));
        stmt.finalize();
      }
      res.json({ success: true });
    });
  });
});

// Trash Document
app.post('/api/documents/:id/trash', requireAuth, (req, res) => {
  const docId = req.params.id;
  db.run(`UPDATE documents SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, [docId, req.user.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Restore Document
app.post('/api/documents/:id/restore', requireAuth, (req, res) => {
  const docId = req.params.id;
  db.run(`UPDATE documents SET status = 'active', deleted_at = NULL WHERE id = ? AND user_id = ?`, [docId, req.user.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Permanent Delete
app.delete('/api/documents/:id', requireAuth, (req, res) => {
  const docId = req.params.id;
  db.get(`SELECT * FROM documents WHERE id = ? AND user_id = ?`, [docId, req.user.id], (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(UPLOADS_DIR, doc.stored_name);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }

    db.run(`DELETE FROM document_tags WHERE document_id = ?`, [docId], () => {
      db.run(`DELETE FROM documents WHERE id = ?`, [docId], () => {
        res.json({ success: true });
      });
    });
  });
});

// Frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Document Vault server running on http://0.0.0.0:${PORT}`);
});
