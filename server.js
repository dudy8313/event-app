// Event Commitment Display - Backend Server
// Express + WebSocket for real-time sync between admin panel and display
//
// MODEL: Each member has TWO commitments:
//   - pledge   = what they personally donate
//   - raise    = what they commit to raise from others
// TWO separate goals: pledgeGoal + raiseGoal (combined = grand total goal)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_PASSWORD = 'admin2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname,'public','admin.html')));

// ---------- Persistent state ----------
function defaultState() {
  const members = [];
  for (let i = 1; i <= 130; i++) {
    members.push({
      id: i,
      name: `Member ${String(i).padStart(3, '0')}`,
      committed: false,
      pledge: 0,
      raise: 0,
      committedAt: null,
    });
  }
  return {
    pledgeGoal: 250000,
    raiseGoal: 250000,
    currency: 'USD',
    members,
    commitments: [], // history in order
  };
}

let state;
function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Migrate old format (single "amount" field) to new (pledge + raise)
      if (loaded.members && loaded.members.length){
        loaded.members.forEach(m => {
          if (typeof m.amount !== 'undefined' && typeof m.pledge === 'undefined'){
            m.pledge = m.amount;
            m.raise = 0;
            delete m.amount;
          }
          if (typeof m.pledge === 'undefined') m.pledge = 0;
          if (typeof m.raise === 'undefined') m.raise = 0;
        });
      }
      if (loaded.commitments && loaded.commitments.length){
        loaded.commitments.forEach(c => {
          if (typeof c.amount !== 'undefined' && typeof c.pledge === 'undefined'){
            c.pledge = c.amount;
            c.raise = 0;
            delete c.amount;
          }
          if (typeof c.pledge === 'undefined') c.pledge = 0;
          if (typeof c.raise === 'undefined') c.raise = 0;
        });
      }
      // Migrate old single goal -> two goals
      if (loaded.goal && !loaded.pledgeGoal){
        loaded.pledgeGoal = Math.round(loaded.goal / 2);
        loaded.raiseGoal = loaded.goal - loaded.pledgeGoal;
        delete loaded.goal;
      }
      if (!loaded.pledgeGoal) loaded.pledgeGoal = 250000;
      if (!loaded.raiseGoal) loaded.raiseGoal = 250000;
      state = loaded;
    } else {
      state = defaultState();
      saveState();
    }
  } catch (e) {
    console.error('loadState error', e);
    state = defaultState();
  }
}
function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('saveState error', e);
  }
}
loadState();

// ---------- Helpers ----------
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}
function totalPledged() {
  return state.members.reduce((s, m) => s + (m.committed ? Number(m.pledge||0) : 0), 0);
}
function totalRaised() {
  return state.members.reduce((s, m) => s + (m.committed ? Number(m.raise||0) : 0), 0);
}
function committedCount() {
  return state.members.filter((m) => m.committed).length;
}
function publicSnapshot() {
  return {
    type: 'snapshot',
    pledgeGoal: state.pledgeGoal,
    raiseGoal: state.raiseGoal,
    totalGoal: state.pledgeGoal + state.raiseGoal,
    currency: state.currency,
    totalMembers: state.members.length,
    committedCount: committedCount(),
    totalPledged: totalPledged(),
    totalRaised: totalRaised(),
    grandTotal: totalPledged() + totalRaised(),
    commitments: state.commitments.map((c) => ({
      id: c.id,
      name: c.name,
      pledge: c.pledge,
      raise: c.raise,
      committedAt: c.committedAt,
    })),
  };
}
function adminSnapshot() {
  return {
    type: 'admin-snapshot',
    pledgeGoal: state.pledgeGoal,
    raiseGoal: state.raiseGoal,
    totalGoal: state.pledgeGoal + state.raiseGoal,
    currency: state.currency,
    totalPledged: totalPledged(),
    totalRaised: totalRaised(),
    grandTotal: totalPledged() + totalRaised(),
    committedCount: committedCount(),
    members: state.members,
  };
}

wss.on('connection', (ws, req) => {
  const isAdmin = (req.url || '').includes('admin');
  ws.isAdmin = isAdmin;
  ws.send(JSON.stringify(publicSnapshot()));
  if (isAdmin) ws.send(JSON.stringify(adminSnapshot()));
});

function broadcastAdminSnapshot() {
  const data = JSON.stringify(adminSnapshot());
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN && c.isAdmin) c.send(data);
  });
}

// ---------- REST API ----------
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.body?.password;
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  if (req.body?.password === ADMIN_PASSWORD) {
    return res.json({ ok: true, token: ADMIN_PASSWORD });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/state', (req, res) => {
  res.json(publicSnapshot());
});

app.get('/api/admin/state', requireAuth, (req, res) => {
  res.json(adminSnapshot());
});

// Commit pledge + raise for a member
app.post('/api/admin/commit', requireAuth, (req, res) => {
  const { id, pledge, raise } = req.body;
  const member = state.members.find((m) => m.id === Number(id));
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const p = Number(pledge) || 0;
  const r = Number(raise) || 0;
  if (p < 0 || r < 0 || (p === 0 && r === 0)){
    return res.status(400).json({ error: 'Enter at least one amount' });
  }
  member.committed = true;
  member.pledge = p;
  member.raise = r;
  member.committedAt = Date.now();

  state.commitments = state.commitments.filter((c) => c.id !== member.id);
  state.commitments.push({
    id: member.id,
    name: member.name,
    pledge: p,
    raise: r,
    committedAt: member.committedAt,
  });
  saveState();

  broadcast({
    type: 'new-commitment',
    commitment: {
      id: member.id,
      name: member.name,
      pledge: p,
      raise: r,
      committedAt: member.committedAt,
    },
    totalPledged: totalPledged(),
    totalRaised: totalRaised(),
    grandTotal: totalPledged() + totalRaised(),
    committedCount: committedCount(),
    pledgeGoal: state.pledgeGoal,
    raiseGoal: state.raiseGoal,
  });
  broadcastAdminSnapshot();
  res.json({ ok: true, member });
});

app.post('/api/admin/rename', requireAuth, (req, res) => {
  const { id, name } = req.body;
  const member = state.members.find((m) => m.id === Number(id));
  if (!member) return res.status(404).json({ error: 'Not found' });
  member.name = String(name).slice(0, 80);
  state.commitments.forEach((c) => {
    if (c.id === member.id) c.name = member.name;
  });
  saveState();
  broadcast(publicSnapshot());
  broadcastAdminSnapshot();
  res.json({ ok: true });
});

app.post('/api/admin/bulk-names', requireAuth, (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names)) return res.status(400).json({ error: 'names array required' });

  // Resize the members list to match the names length (preserves committed entries by id where possible)
  const newCount = names.length;
  const oldMembers = state.members;
  const newMembers = [];
  for (let i = 0; i < newCount; i++) {
    const id = i + 1;
    const existing = oldMembers.find(m => m.id === id);
    const name = String(names[i] || '').trim().slice(0, 80) || `Member ${String(id).padStart(3, '0')}`;
    if (existing) {
      existing.name = name;
      newMembers.push(existing);
    } else {
      newMembers.push({
        id,
        name,
        committed: false,
        pledge: 0,
        raise: 0,
        committedAt: null,
      });
    }
  }
  state.members = newMembers;
  // Update commitment history names if they reference these IDs
  state.commitments.forEach((c) => {
    const m = state.members.find(mm => mm.id === c.id);
    if (m) c.name = m.name;
  });
  saveState();
  broadcast(publicSnapshot());
  broadcastAdminSnapshot();
  res.json({ ok: true, totalMembers: state.members.length });
});

app.post('/api/admin/reset-member', requireAuth, (req, res) => {
  const { id } = req.body;
  const member = state.members.find((m) => m.id === Number(id));
  if (!member) return res.status(404).json({ error: 'Not found' });
  member.committed = false;
  member.pledge = 0;
  member.raise = 0;
  member.committedAt = null;
  state.commitments = state.commitments.filter((c) => c.id !== member.id);
  saveState();
  broadcast(publicSnapshot());
  broadcastAdminSnapshot();
  res.json({ ok: true });
});

// Update goals
app.post('/api/admin/goals', requireAuth, (req, res) => {
  const { pledgeGoal, raiseGoal } = req.body;
  const pg = Number(pledgeGoal);
  const rg = Number(raiseGoal);
  if (!isFinite(pg) || pg < 0) return res.status(400).json({ error: 'Invalid pledge goal' });
  if (!isFinite(rg) || rg < 0) return res.status(400).json({ error: 'Invalid raise goal' });
  state.pledgeGoal = pg;
  state.raiseGoal = rg;
  saveState();
  broadcast(publicSnapshot());
  broadcastAdminSnapshot();
  res.json({ ok: true });
});

app.post('/api/admin/reset-all', requireAuth, (req, res) => {
  state.members.forEach((m) => {
    m.committed = false;
    m.pledge = 0;
    m.raise = 0;
    m.committedAt = null;
  });
  state.commitments = [];
  saveState();
  broadcast(publicSnapshot());
  broadcastAdminSnapshot();
  res.json({ ok: true });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
