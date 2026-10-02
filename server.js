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
  { id: 'teorico',   nome: 'Conhecimento teórico',                peso: 1 },
  { id: 'auxilio',   nome: 'Pratica com auxílio',                  peso: 2 },
  { id: 'autonomia', nome: 'Autonomia e consistência',             peso: 3 },
  { id: 'escala',    nome: 'Pratica em escala / adversidade',      peso: 4 },
];

// Assuntos macro de exemplo para a régua "Geral" (seed inicial)
const seedAssuntosGerais = [
  {
    id: nanoid(6),
    nome: 'Fundamentos',
    descricao: 'Bases técnicas do dia a dia',
    itens: [
      { id: nanoid(6), nome: 'Entende o fluxo da equipe',         descricao: '' },
      { id: nanoid(6), nome: 'Faz primeiro PR sem ajuda direta',  descricao: '' },
      { id: nanoid(6), nome: 'Documenta o que aprendeu',          descricao: '' },
    ],
  },
  {
    id: nanoid(6),
    nome: 'Colaboração',
    descricao: '',
    itens: [
      { id: nanoid(6), nome: 'Participa de code review com qualidade', descricao: '' },
      { id: nanoid(6), nome: 'Mentora colegas em início de carreira',  descricao: '' },
    ],
  },
  {
    id: nanoid(6),
    nome: 'Impacto',
    descricao: '',
    itens: [
      { id: nanoid(6), nome: 'Define padrões com evidências', descricao: '' },
      { id: nanoid(6), nome: 'Influencia roadmap técnico',    descricao: '' },
    ],
  },
];

const seedReguaGeral = {
  id: 'geral',
  nome: 'Geral',
  descricao: 'Régua técnica compartilhada, independente da função.',
  proficiencias: seedProficiencias,
  assuntosMacro: seedAssuntosGerais,
};

const seed = { mentorados: [], reguas: [seedReguaGeral] };

const db = new Low(new JSONFile(dbFile), seed);
await db.read();

// --- Migração: limpar modelo antigo (níveis/marcos por nível) e garantir campos novos ---
if (db.data && db.data.reguas) {
  for (const r of db.data.reguas) {
    if (!r.proficiencias) r.proficiencias = seedProficiencias.map(p => ({ ...p }));
    if (r.descricao === undefined) r.descricao = '';
    if (!Array.isArray(r.assuntosMacro)) r.assuntosMacro = [];
    for (const p of r.proficiencias) {
      if (p.peso === undefined) p.peso = p.ordem ?? 0;
      delete p.ordem;
    }
    delete r.niveis;
  }
  for (const m of (db.data.mentorados || [])) {
    if (!m.reguaId) m.reguaId = 'geral';
    if (!m.proficiencias) m.proficiencias = {};
    delete m.nivelId;
    delete m.itensConquistados;
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
const findProf  = (regua, id) => regua?.proficiencias.find(p => p.id === id);
const findMacro = (regua, id) => regua?.assuntosMacro.find(a => a.id === id);
const collectValidItems = (regua) => {
  const out = new Set();
  for (const a of (regua?.assuntosMacro || [])) for (const i of a.itens) out.add(i.id);
  return out;
};

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
    assuntosMacro: [],
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
  const nextPeso = r.proficiencias.reduce((m, p) => Math.max(m, p.peso || 0), 0) + 1;
  const peso = Number.isFinite(+req.body.peso) ? +req.body.peso : nextPeso;
  const p = { id: nanoid(6), nome: sanitize(nome), peso };
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
  if (Number.isFinite(+req.body.peso)) p.peso = +req.body.peso;
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

// --- Assuntos Macro (modelo v2: régua -> assunto macro -> itens) ---
app.post('/api/reguas/:id/assuntos-macro', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const { nome, descricao } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const a = {
    id: nanoid(6),
    nome: sanitize(nome),
    descricao: sanitize(descricao || ''),
    itens: [],
  };
  r.assuntosMacro.push(a);
  await db.write();
  res.status(201).json(a);
});

app.put('/api/reguas/:id/assuntos-macro/:macroId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const a = findMacro(r, req.params.macroId);
  if (!a) return res.status(404).json({ erro: 'assunto não encontrado' });
  if (req.body.nome !== undefined) a.nome = sanitize(req.body.nome);
  if (req.body.descricao !== undefined) a.descricao = sanitize(req.body.descricao);
  await db.write();
  res.json(a);
});

app.delete('/api/reguas/:id/assuntos-macro/:macroId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const antes = r.assuntosMacro.length;
  r.assuntosMacro = r.assuntosMacro.filter(a => a.id !== req.params.macroId);
  if (r.assuntosMacro.length === antes) return res.status(404).json({ erro: 'assunto não encontrado' });
  await db.write();
  res.status(204).end();
});

app.post('/api/reguas/:id/assuntos-macro/:macroId/itens', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const a = findMacro(r, req.params.macroId);
  if (!a) return res.status(404).json({ erro: 'assunto não encontrado' });
  const { nome, descricao } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const item = { id: nanoid(6), nome: sanitize(nome), descricao: sanitize(descricao || '') };
  a.itens.push(item);
  await db.write();
  res.status(201).json(item);
});

app.put('/api/reguas/:id/assuntos-macro/:macroId/itens/:itemId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const a = findMacro(r, req.params.macroId);
  if (!a) return res.status(404).json({ erro: 'assunto não encontrado' });
  const item = a.itens.find(i => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  if (req.body.nome !== undefined) item.nome = sanitize(req.body.nome);
  if (req.body.descricao !== undefined) item.descricao = sanitize(req.body.descricao);
  await db.write();
  res.json(item);
});

app.delete('/api/reguas/:id/assuntos-macro/:macroId/itens/:itemId', async (req, res) => {
  await db.read();
  const r = findRegua(db.data, req.params.id);
  if (!r) return res.status(404).json({ erro: 'régua não encontrada' });
  const a = findMacro(r, req.params.macroId);
  if (!a) return res.status(404).json({ erro: 'assunto não encontrado' });
  const antes = a.itens.length;
  a.itens = a.itens.filter(i => i.id !== req.params.itemId);
  if (a.itens.length === antes) return res.status(404).json({ erro: 'item não encontrado' });
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
  const { nome, objetivo, notas, reguaId } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const r = findRegua(db.data, reguaId) || findRegua(db.data, 'geral') || db.data.reguas[0];
  if (!r) return res.status(400).json({ erro: 'nenhuma régua disponível' });
  const m = {
    id: nanoid(8),
    nome: sanitize(nome),
    objetivo: sanitize(objetivo),
    notas: sanitize(notas),
    reguaId: r.id,
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
  const { nome, objetivo, notas, status, reguaId, proficiencias } = req.body;
  if (nome !== undefined) m.nome = sanitize(nome);
  if (objetivo !== undefined) m.objetivo = sanitize(objetivo);
  if (notas !== undefined) m.notas = sanitize(notas);
  if (status && ['ativo', 'pausado', 'concluido'].includes(status)) m.status = status;
  if (reguaId) {
    const r = findRegua(db.data, reguaId);
    if (r) {
      m.reguaId = r.id;
      const validItems = collectValidItems(r);
      for (const k of Object.keys(m.proficiencias)) {
        if (!validItems.has(k)) delete m.proficiencias[k];
      }
    }
  }
  if (proficiencias && typeof proficiencias === 'object') {
    const r = findRegua(db.data, m.reguaId);
    const validItems = collectValidItems(r);
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
