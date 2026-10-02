import express from 'express';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbFile = join(__dirname, 'db.json');

// Proficiências padrão (compartilhadas por novos itens de qualquer régua)
const seedProficiencias = [
  { id: 'teorico',   nome: 'Conhecimento teórico',                ordem: 1 },
  { id: 'auxilio',   nome: 'Pratica com auxílio',                  ordem: 2 },
  { id: 'autonomia', nome: 'Autonomia e consistência',             ordem: 3 },
  { id: 'escala',    nome: 'Pratica em escala / adversidade',      ordem: 4 },
];

// Níveis padrão (cada régua nova nasce com esses 6 níveis vazios)
const seedNiveisDefault = [
  { id: 'trainee',         nome: 'Trainee',         itens: [] },
  { id: 'junior',          nome: 'Júnior',          itens: [] },
  { id: 'pleno',           nome: 'Pleno',           itens: [] },
  { id: 'senior',          nome: 'Sênior',          itens: [] },
  { id: 'especialista-i',  nome: 'Especialista I',  itens: [] },
  { id: 'especialista-ii', nome: 'Especialista II', itens: [] },
];

// Itens genéricos para a régua "Geral" (seed inicial)
const seedItensGerais = {
  trainee: [
    { id: nanoid(6), nome: 'Entende o fluxo da equipe',           descricao: '' },
    { id: nanoid(6), nome: 'Faz primeiro PR sem ajuda direta',     descricao: '' },
    { id: nanoid(6), nome: 'Documenta o que aprendeu',             descricao: '' },
  ],
  junior: [
    { id: nanoid(6), nome: 'Git básico',                           descricao: '' },
    { id: nanoid(6), nome: 'Lê código sem medo',                   descricao: '' },
    { id: nanoid(6), nome: 'Resolve ticket sozinho',               descricao: '' },
  ],
  pleno: [
    { id: nanoid(6), nome: 'Code review construtivo',              descricao: '' },
    { id: nanoid(6), nome: 'Desenha feature pequena',              descricao: '' },
    { id: nanoid(6), nome: 'Mentora um júnior',                    descricao: '' },
  ],
  senior: [
    { id: nanoid(6), nome: 'Define arquitetura',                   descricao: '' },
    { id: nanoid(6), nome: 'Conduz pós-mortem',                    descricao: '' },
    { id: nanoid(6), nome: 'Negocia escopo com produto',           descricao: '' },
  ],
  'especialista-i': [
    { id: nanoid(6), nome: 'Domina um domínio técnico',            descricao: '' },
    { id: nanoid(6), nome: 'Lidera projeto cross-team',            descricao: '' },
    { id: nanoid(6), nome: 'Define padrões com evidências',        descricao: '' },
  ],
  'especialista-ii': [
    { id: nanoid(6), nome: 'Influencia roadmap técnico',           descricao: '' },
    { id: nanoid(6), nome: 'Mentora especialistas',                descricao: '' },
    { id: nanoid(6), nome: 'Representa a empresa externamente',    descricao: '' },
  ],
};

const seedReguaGeral = {
  id: 'geral',
  nome: 'Geral',
  descricao: 'Régua técnica compartilhada, independente da função.',
  proficiencias: seedProficiencias,
  niveis: seedNiveisDefault.map(n => ({ ...n, itens: seedItensGerais[n.id] ?? [] })),
};

const seed = { mentorados: [], reguas: [seedReguaGeral] };

const db = new Low(new JSONFile(dbFile), seed);
await db.read();

// --- Migração v1 (niveis flat) -> v2 (reguas) ---
if (db.data && db.data.niveis && !db.data.reguas) {
  const niveisAntigos = db.data.niveis;
  db.data.reguas = [{
    id: 'geral',
    nome: 'Geral',
    descricao: 'Régua técnica compartilhada (migrada).',
    proficiencias: seedProficiencias,
    niveis: niveisAntigos,
  }];
  delete db.data.niveis;
  for (const m of db.data.mentorados || []) {
    m.reguaId = 'geral';
    delete m.itensConquistados;
    m.proficiencias = {};
  }
}

// --- Migração v2 -> v3: garantir campos novos em estruturas antigas ---
if (db.data && db.data.reguas) {
  for (const r of db.data.reguas) {
    if (!r.proficiencias) r.proficiencias = seedProficiencias;
    if (r.descricao === undefined) r.descricao = '';
    for (const n of (r.niveis || [])) {
      for (const i of (n.itens || [])) {
        if (i.descricao === undefined) i.descricao = '';
      }
    }
  }
  for (const m of (db.data.mentorados || [])) {
    if (!m.reguaId) m.reguaId = 'geral';
    if (!m.proficiencias) m.proficiencias = {};
    if (m.itensConquistados) delete m.itensConquistados;
  }
}

if (!db.data || !db.data.reguas) {
  db.data = structuredClone(seed);
}

await db.write();

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const sanitize = (s = '') => String(s).trim().slice(0, 500);

// Helpers de busca
const findRegua = (data, id) => data.reguas.find(r => r.id === id);
const findNivel = (regua, id) => regua?.niveis.find(n => n.id === id);
const findItem  = (nivel, id) => nivel?.itens.find(i => i.id === id);
const findProf  = (regua, id) => regua?.proficiencias.find(p => p.id === id);

// --- Réguas ---
app.get('/api/reguas', async (_, res) => {
  await db.read();
  res.json(db.data.reguas);
});

app.post('/api/reguas', async (req, res) => {
  await db.read();
  const { nome, descricao } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const r = {
    id: nanoid(8),
    nome: sanitize(nome),
    descricao: sanitize(descricao),
    proficiencias: seedProficiencias.map(p => ({ ...p })),
    niveis: seedNiveisDefault.map(n => ({ ...n, itens: [] })),
  };
  db.data.reguas.push(r);
  await db.write();
  res.status(201).json(r);
});

app.put('/api/reguas/:id', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'não encontrada' });
  if (req.body.nome !== undefined) r.nome = sanitize(req.body.nome);
  if (req.body.descricao !== undefined) r.descricao = sanitize(req.body.descricao);
  await db.write();
  res.json(r);
});

app.delete('/api/reguas/:id', async (req, res) => {
  await db.read();
  if (db.data.mentorados.some(m => m.reguaId === req.params.id)) {
    return res.status(400).json({ erro: 'há mentorados usando esta régua' });
  }
  const antes = db.data.reguas.length;
  db.data.reguas = db.data.reguas.filter(r => r.id !== req.params.id);
  if (db.data.reguas.length === antes) return res.status(404).json({ erro: 'não encontrada' });
  await db.write();
  res.status(204).end();
});

// --- Proficiências (por régua) ---
app.post('/api/reguas/:id/proficiencias', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const ordem = r.proficiencias.reduce((m, p) => Math.max(m, p.ordem), 0) + 1;
  const p = { id: nanoid(6), nome: sanitize(nome), ordem };
  r.proficiencias.push(p);
  await db.write();
  res.status(201).json(p);
});

app.put('/api/reguas/:id/proficiencias/:profId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const p = findProf(r, req.params.profId);
  if (!p) return res.status(404).json({ erro: 'proficiência não encontrada' });
  if (req.body.nome !== undefined) p.nome = sanitize(req.body.nome);
  await db.write();
  res.json(p);
});

app.delete('/api/reguas/:id/proficiencias/:profId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const antes = r.proficiencias.length;
  r.proficiencias = r.proficiencias.filter(p => p.id !== req.params.profId);
  if (r.proficiencias.length === antes) return res.status(404).json({ erro: 'proficiência não encontrada' });
  for (const m of db.data.mentorados) {
    if (m.reguaId !== r.id) continue;
    for (const k of Object.keys(m.proficiencias)) {
      if (m.proficiencias[k] === req.params.profId) delete m.proficiencias[k];
    }
  }
  await db.write();
  res.status(204).end();
});

// --- Níveis (por régua) ---
app.post('/api/reguas/:id/niveis', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const n = { id: nanoid(6), nome: sanitize(nome), itens: [] };
  r.niveis.push(n);
  await db.write();
  res.status(201).json(n);
});

app.put('/api/reguas/:id/niveis/:nivelId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const n = findNivel(r, req.params.nivelId);
  if (!n) return res.status(404).json({ erro: 'nível não encontrado' });
  if (req.body.nome !== undefined) n.nome = sanitize(req.body.nome);
  await db.write();
  res.json(n);
});

app.delete('/api/reguas/:id/niveis/:nivelId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const n = findNivel(r, req.params.nivelId);
  if (!n) return res.status(404).json({ erro: 'nível não encontrado' });
  if (n.itens.length) return res.status(400).json({ erro: 'remova os itens do nível antes' });
  r.niveis = r.niveis.filter(x => x.id !== req.params.nivelId);
  for (const m of db.data.mentorados) {
    if (m.reguaId === r.id && m.nivelId === req.params.nivelId) {
      m.nivelId = r.niveis[0]?.id ?? '';
    }
  }
  await db.write();
  res.status(204).end();
});

// --- Itens (por nível) ---
app.post('/api/reguas/:id/niveis/:nivelId/itens', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const n = findNivel(r, req.params.nivelId);
  if (!n) return res.status(404).json({ erro: 'nível não encontrado' });
  const { nome, descricao } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const item = { id: nanoid(6), nome: sanitize(nome), descricao: sanitize(descricao) };
  n.itens.push(item);
  await db.write();
  res.status(201).json(item);
});

app.put('/api/reguas/:id/niveis/:nivelId/itens/:itemId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const n = findNivel(r, req.params.nivelId);
  if (!n) return res.status(404).json({ erro: 'nível não encontrado' });
  const item = findItem(n, req.params.itemId);
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  if (req.body.nome !== undefined) item.nome = sanitize(req.body.nome);
  if (req.body.descricao !== undefined) item.descricao = sanitize(req.body.descricao);
  await db.write();
  res.json(item);
});

app.delete('/api/reguas/:id/niveis/:nivelId/itens/:itemId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const n = findNivel(r, req.params.nivelId);
  if (!n) return res.status(404).json({ erro: 'nível não encontrado' });
  const antes = n.itens.length;
  n.itens = n.itens.filter(i => i.id !== req.params.itemId);
  if (n.itens.length === antes) return res.status(404).json({ erro: 'item não encontrado' });
  for (const m of db.data.mentorados) {
    if (m.reguaId === r.id) delete m.proficiencias[req.params.itemId];
  }
  await db.write();
  res.status(204).end();
});

// --- Mentorados ---
app.get('/api/mentorados', async (_, res) => {
  await db.read();
  res.json(db.data.mentorados);
});

app.post('/api/mentorados', async (req, res) => {
  await db.read();
  const { nome, objetivo, notas, reguaId, nivelId } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const r = findRegua(db.data, reguaId) || findRegua(db.data, 'geral') || db.data.reguas[0];
  if (!r) return res.status(400).json({ erro: 'nenhuma régua disponível' });
  const nId = findNivel(r, nivelId)?.id || r.niveis[1]?.id || r.niveis[0]?.id;
  const m = {
    id: nanoid(8),
    nome: sanitize(nome),
    objetivo: sanitize(objetivo),
    notas: sanitize(notas),
    reguaId: r.id,
    nivelId: nId,
    proficiencias: {},
    status: 'ativo',
    criadoEm: new Date().toISOString(),
  };
  db.data.mentorados.push(m);
  await db.write();
  res.status(201).json(m);
});

app.put('/api/mentorados/:id', async (req, res) => {
  await db.read();
  const m = db.data.mentorados.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ erro: 'não encontrado' });
  const { nome, objetivo, notas, status, reguaId, nivelId, proficiencias } = req.body;
  if (nome !== undefined) m.nome = sanitize(nome);
  if (objetivo !== undefined) m.objetivo = sanitize(objetivo);
  if (notas !== undefined) m.notas = sanitize(notas);
  if (status && ['ativo', 'pausado', 'concluido'].includes(status)) m.status = status;
  if (reguaId) {
    const r = findRegua(db.data, reguaId);
    if (r) {
      m.reguaId = r.id;
      // ao trocar de régua, descarta proficiências que não fazem sentido lá
      const validItems = new Set();
      for (const n of r.niveis) for (const i of n.itens) validItems.add(i.id);
      for (const k of Object.keys(m.proficiencias)) {
        if (!validItems.has(k)) delete m.proficiencias[k];
      }
    }
  }
  if (nivelId) {
    const r = findRegua(db.data, m.reguaId);
    const n = findNivel(r, nivelId);
    if (n) m.nivelId = n.id;
  }
  if (proficiencias && typeof proficiencias === 'object') {
    const r = findRegua(db.data, m.reguaId);
    const validItems = new Set();
    for (const n of r.niveis) for (const i of n.itens) validItems.add(i.id);
    const validProfs = new Set(r.proficiencias.map(p => p.id));
    for (const [k, v] of Object.entries(proficiencias)) {
      if (!validItems.has(k)) continue;
      if (v && validProfs.has(v)) m.proficiencias[k] = v;
      else delete m.proficiencias[k];
    }
  }
  await db.write();
  res.json(m);
});

app.delete('/api/mentorados/:id', async (req, res) => {
  await db.read();
  const antes = db.data.mentorados.length;
  db.data.mentorados = db.data.mentorados.filter(x => x.id !== req.params.id);
  if (db.data.mentorados.length === antes) return res.status(404).json({ erro: 'não encontrado' });
  await db.write();
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`growth-buddy em http://localhost:${PORT}`));
