// Estado
let mentorados = [];
let reguas = [];
let activeReguaId = null;
let newReguaFormOpen = false;

// Helpers
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

const fetchJSON = async (url, opts = {}) => {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
};

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};

const reguaAtiva = () => reguas.find(r => r.id === activeReguaId) || reguas[0];

// --- Starfish: score por assunto + render SVG ---
const calcularScorePorAssunto = (mentorado, regua) => {
  if (!regua || !regua.assuntosMacro.length) return [];
  const maxPeso = Math.max(1, ...regua.proficiencias.map(p => p.peso || 0));
  return regua.assuntosMacro.map(macro => {
    const total = macro.itens.length;
    if (!total) return { id: macro.id, nome: macro.nome, score: 0, total, marcados: 0 };
    const marcados = macro.itens.filter(i => mentorado.proficiencias?.[i.id]);
    const soma = macro.itens.reduce((acc, item) => {
      const profId = mentorado.proficiencias?.[item.id];
      if (!profId) return acc;
      const prof = regua.proficiencias.find(p => p.id === profId);
      return acc + (prof?.peso || 0);
    }, 0);
    const score = soma / (total * maxPeso);
    return { id: macro.id, nome: macro.nome, score, total, marcados: marcados.length };
  });
};

const renderStarfish = (scores, size = 100) => {
  const n = scores.length;
  if (!n) return '<div class="starfish-empty">Sem assuntos</div>';
  if (n === 1) return `<div class="starfish-single">Único assunto: ${escape(scores[0].nome)} — ${(scores[0].score * 100).toFixed(0)}%</div>`;

  const labelFontPx = size >= 120 ? 11 : 0;
  const longest = Math.max(...scores.map(s => (s.nome || '').length));
  const padSide = labelFontPx ? Math.max(18, (longest * labelFontPx * 0.55) + 10) : 0;
  const w = size + padSide * 2;
  const h = size + padSide * 2;
  const cx = w / 2;
  const cy = h / 2;
  const radius = (size / 2) - 6;
  const angleFor = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pointFor = (i, r) => {
    const a = angleFor(i);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  const rings = [0.33, 0.67, 1.0];
  const grid = rings.map(ring => {
    const pts = scores.map((_, i) => {
      const p = pointFor(i, radius * ring);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');
    return `<polygon points="${pts}" class="sf-grid"/>`;
  }).join('');

  const axes = scores.map((_, i) => {
    const p = pointFor(i, radius);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="sf-axis"/>`;
  }).join('');

  const dataPts = scores.map((s, i) => {
    const p = pointFor(i, radius * s.score);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');

  const dotR = size >= 120 ? 2.6 : 1.8;
  const dots = scores.map((s, i) => {
    const p = pointFor(i, radius * s.score);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotR}" class="sf-dot"/>`;
  }).join('');

  const labels = labelFontPx ? scores.map((s, i) => {
    const p = pointFor(i, radius + 12);
    return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" class="sf-label">${escape(s.nome)}</text>`;
  }).join('') : '';

  return `
    <svg viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" class="starfish" role="img" aria-label="Distribuição de proficiência por assunto macro">
      ${grid}
      ${axes}
      <polygon points="${dataPts}" class="sf-data"/>
      ${dots}
      ${labels}
    </svg>
  `;
};

// View switching
$$('nav a').forEach(a => {
  a.onclick = (e) => {
    e.preventDefault();
    $$('nav a').forEach(x => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
    a.classList.add('active');
    a.setAttribute('aria-current', 'page');
    const view = a.dataset.view;
    $$('.view').forEach(v => v.hidden = v.id !== `view-${view}`);
    window.scrollTo(0, 0);
    const heading = $(`#view-${view} .view-header h2`);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };
});
// Default-current on first nav link
$('nav a.active')?.setAttribute('aria-current', 'page');

// --- Carregamento ---
const carregar = async () => {
  try {
    [mentorados, reguas] = await Promise.all([
      fetchJSON('/api/mentorados'),
      fetchJSON('/api/reguas'),
    ]);
    if (!activeReguaId && reguas.length) activeReguaId = reguas[0].id;
    renderAll();
  } catch (e) {
    console.error(e);
  }
};

const renderAll = () => {
  renderDashboard();
  renderMentorados();
  renderRegua();
  popularSelectRegua();
};

// Targeted re-fetches after mutations to avoid a full reload flicker
const recarregarMentorados = async () => {
  mentorados = await fetchJSON('/api/mentorados');
  renderDashboard();
  renderMentorados();
};

const recarregarReguas = async () => {
  reguas = await fetchJSON('/api/reguas');
  if (activeReguaId && !reguas.find(r => r.id === activeReguaId)) {
    activeReguaId = reguas[0]?.id;
  }
  renderDashboard();
  renderRegua();
  popularSelectRegua();
};

// --- Dashboard ---
const renderDashboard = () => {
  const total = mentorados.length;
  const ativos = mentorados.filter(m => m.status === 'ativo').length;
  const totalItens = reguas.reduce((s, r) => s + r.assuntosMacro.reduce((a, m) => a + m.itens.length, 0), 0);
  const marcados = mentorados.reduce((s, m) => {
    const regua = reguas.find(r => r.id === m.reguaId);
    if (!regua) return s;
    return s + regua.assuntosMacro.reduce((acc, macro) =>
      acc + macro.itens.filter(i => m.proficiencias?.[i.id]).length, 0);
  }, 0);

  $('#stats').innerHTML = `
    <div class="stat">
      <div class="label">Mentorados</div>
      <div class="value">${total}</div>
      <div class="hint">${ativos} ativos</div>
    </div>
    <div class="stat">
      <div class="label">Marcos marcados</div>
      <div class="value">${marcados}</div>
      <div class="hint">marcações de proficiência feitas</div>
    </div>
    <div class="stat">
      <div class="label">Réguas ativas</div>
      <div class="value">${reguas.length}</div>
      <div class="hint">${totalItens} marcos no total</div>
    </div>
  `;

  const tbody = $('#tabela-dashboard tbody');
  const vazio = $('#vazio-dashboard');

  if (!total) {
    tbody.innerHTML = '';
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;

  tbody.innerHTML = mentorados.map(m => {
    const regua = reguas.find(r => r.id === m.reguaId);
    const scores = regua ? calcularScorePorAssunto(m, regua) : [];
    const totalItensM = regua ? regua.assuntosMacro.reduce((a, ma) => a + ma.itens.length, 0) : 0;
    const marcadosM = regua
      ? regua.assuntosMacro.reduce((acc, macro) =>
          acc + macro.itens.filter(i => m.proficiencias?.[i.id]).length, 0)
      : 0;

    return `
      <tr>
        <td>
          <strong>${escape(m.nome)}</strong>
          ${m.objetivo ? `<div style="color:var(--ink-mute);font-size:0.78rem">${escape(m.objetivo)}</div>` : ''}
          ${m.criadoEm ? `<div style="color:var(--ink-faint);font-size:0.78rem">desde ${formatDate(m.criadoEm)}</div>` : ''}
        </td>
        <td>
          ${regua ? `<span class="regua-tag">${escape(regua.nome)}</span>` : ''}
        </td>
        <td class="starfish-cell">
          ${scores.length ? renderStarfish(scores, 110) : '<span class="vazio-mini">Sem assuntos</span>'}
          <div class="starfish-caption">${marcadosM} de ${totalItensM} marcos · ${scores.length} assuntos</div>
        </td>
        <td><span class="status-tag ${m.status}">${m.status}</span></td>
      </tr>
    `;
  }).join('');
};

// --- Mentorados ---
const popularSelectRegua = () => {
  const sel = $('#select-regua-form');
  if (!sel) return;
  sel.innerHTML = reguas.map(r => `<option value="${r.id}">${escape(r.nome)}</option>`).join('');
};

const renderMentorados = () => {
  const lista = $('#lista-mentorados');
  if (!mentorados.length) {
    lista.innerHTML = '<p class="vazio">Nenhum mentorado ainda. Use o formulário acima.</p>';
    return;
  }

  lista.innerHTML = mentorados.map(m => {
    const regua = reguas.find(r => r.id === m.reguaId);
    if (!regua) return '';

    const macrosHtml = regua.assuntosMacro.length ? regua.assuntosMacro.map(macro => {
      const profsSorted = regua.proficiencias.slice().sort((a, b) => (a.peso || 0) - (b.peso || 0));
      const itensHtml = macro.itens.length ? macro.itens.map(item => {
        const profId = m.proficiencias?.[item.id] || '';
        const optsHtml = [`<option value="">— sem marcação —</option>`]
          .concat(profsSorted.map(p =>
            `<option value="${p.id}" ${profId === p.id ? 'selected' : ''}>${p.peso || 0} — ${escape(p.nome)}</option>`
          ))
          .join('');
        return `
          <div class="macro-item-row">
            <div class="macro-item-info">
              <span class="item-nome">${escape(item.nome)}</span>
              ${item.descricao ? `<span class="item-desc">${escape(item.descricao)}</span>` : ''}
            </div>
            <select class="prof-select" data-prof="${m.id}|${item.id}" aria-label="Proficiência de ${escape(item.nome)} para ${escape(m.nome)}">
              ${optsHtml}
            </select>
          </div>
        `;
      }).join('') : '<p class="vazio-item-mini">Sem marcos neste assunto.</p>';

      return `
        <div class="assunto-section">
          <div class="assunto-titulo">
            <strong>${escape(macro.nome)}</strong>
            ${macro.descricao ? `<span class="item-desc">${escape(macro.descricao)}</span>` : ''}
            <span class="contador-mini">${macro.itens.length} ${macro.itens.length === 1 ? 'marco' : 'marcos'}</span>
          </div>
          ${itensHtml}
        </div>
      `;
    }).join('') : '<p class="vazio" style="padding:0.5rem">Esta régua ainda não tem assuntos macro.</p>';

    const scores = calcularScorePorAssunto(m, regua);
    const starfishBlock = scores.length ? `
      <div class="starfish-card">
        <div class="starfish-title">Distribuição por pilar</div>
        ${renderStarfish(scores, 220)}
        <ul class="starfish-legend">
          ${scores.map(s => `
            <span class="leg-item">
              <span class="leg-name">${escape(s.nome)}</span>
              <span class="leg-pct">${Math.round(s.score * 100)}%</span>
            </span>
          `).join('')}
        </ul>
      </div>
    ` : '';

    return `
      <div class="card-row">
        <div class="card-main">
          <h4>${escape(m.nome)}</h4>
          <div class="meta">
            <span class="regua-tag">${escape(regua.nome)}</span>
            <span class="status-tag ${m.status}">${m.status}</span>
            ${m.objetivo ? ` · ${escape(m.objetivo)}` : ''}
            ${m.criadoEm ? ` · desde ${formatDate(m.criadoEm)}` : ''}
          </div>
          ${macrosHtml}
          ${m.notas ? `<div class="notas">${escape(m.notas)}</div>` : ''}
          <form class="edit-form" data-edit-form="${m.id}" hidden>
            <div class="form-grid">
              <label>Nome
                <input name="nome" value="${escape(m.nome)}" required maxlength="80">
              </label>
              <label>Objetivo
                <input name="objetivo" value="${escape(m.objetivo || '')}" maxlength="200" placeholder="ex: virar pleno backend">
              </label>
              <label>Régua
                <select name="reguaId">
                  ${reguas.map(r => `<option value="${r.id}" ${r.id === m.reguaId ? 'selected' : ''}>${escape(r.nome)}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Notas
              <textarea name="notas" maxlength="500">${escape(m.notas || '')}</textarea>
            </label>
            <div class="acoes">
              <button type="submit">Salvar</button>
              <button type="button" class="ghost" data-cancel-edit="${escape(m.id)}">Cancelar</button>
            </div>
          </form>
        </div>
        <aside class="card-side">
          ${starfishBlock || '<div class="starfish-empty">Sem assuntos macro nesta régua.</div>'}
          <div class="acoes">
            <select data-status="${m.id}" aria-label="Status de ${escape(m.nome)}">
              <option value="ativo" ${m.status === 'ativo' ? 'selected' : ''}>ativo</option>
              <option value="pausado" ${m.status === 'pausado' ? 'selected' : ''}>pausado</option>
              <option value="concluido" ${m.status === 'concluido' ? 'selected' : ''}>concluído</option>
            </select>
            <button class="ghost small" data-editar="${m.id}">editar</button>
            <button class="danger small" data-remover="${m.id}">remover</button>
          </div>
        </aside>
      </div>
    `;
  }).join('');

  $$('[data-edit-form]').forEach(form => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const id = form.dataset.editForm;
      const data = Object.fromEntries(new FormData(form));
      await fetchJSON(`/api/mentorados/${id}`, { method: 'PUT', body: data });
      await recarregarMentorados();
    };
  });

  $$('[data-cancel-edit]').forEach(b => {
    b.onclick = () => {
      const form = document.querySelector(`[data-edit-form="${b.dataset.cancelEdit}"]`);
      if (form) form.hidden = true;
    };
  });

  $$('.prof-select').forEach(s => {
    s.onchange = () => {
      const [id, itemId] = s.dataset.prof.split('|');
      const m = mentorados.find(x => x.id === id);
      const novo = { ...(m.proficiencias || {}) };
      if (s.value) novo[itemId] = s.value;
      else delete novo[itemId];
      atualizarMentorado(id, { proficiencias: novo });
    };
  });
  $$('[data-status]').forEach(s => {
    s.onchange = () => atualizarMentorado(s.dataset.status, { status: s.value });
  });
  $$('[data-editar]').forEach(b => {
    b.onclick = () => editarMentorado(b.dataset.editar);
  });
  $$('[data-remover]').forEach(b => {
    b.onclick = () => removerMentorado(b.dataset.remover);
  });
};

$('#form-mentorado').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  await fetchJSON('/api/mentorados', { method: 'POST', body: data });
  e.target.reset();
  await recarregarMentorados();
};

const atualizarMentorado = async (id, patch) => {
  // optimistic: update local state, then PUT, rollback on error
  const idx = mentorados.findIndex(m => m.id === id);
  const snapshot = idx >= 0 ? { ...mentorados[idx] } : null;
  if (snapshot) Object.assign(mentorados[idx], patch);
  renderDashboard();
  renderMentorados();
  try {
    await fetchJSON(`/api/mentorados/${id}`, { method: 'PUT', body: patch });
  } catch (err) {
    if (snapshot) mentorados[idx] = snapshot;
    renderDashboard();
    renderMentorados();
    alert(err.message);
  }
};

const editarMentorado = async (id) => {
  const form = document.querySelector(`[data-edit-form="${id}"]`);
  if (!form) return;
  const willOpen = form.hidden;
  document.querySelectorAll('[data-edit-form]').forEach(f => f.hidden = true);
  form.hidden = !willOpen;
  if (willOpen) form.querySelector('input[name="nome"]')?.focus();
};

const removerMentorado = async (id) => {
  if (!confirm('Remover este mentorado?')) return;
  await fetchJSON(`/api/mentorados/${id}`, { method: 'DELETE' });
  await recarregarMentorados();
};

// --- Réguas ---
const renderRegua = () => {
  const tabs = $('#regua-tabs');
  if (!tabs) return;
  tabs.innerHTML = reguas.map(r => `
    <button class="regua-tab ${r.id === activeReguaId ? 'active' : ''}" data-tab="${r.id}">${escape(r.nome)}</button>
  `).join('') + `<button class="regua-tab add" data-add-regua>+ Nova régua</button>`;

  tabs.querySelectorAll('[data-tab]').forEach(b => {
    b.onclick = () => { activeReguaId = b.dataset.tab; renderRegua(); };
  });
  tabs.querySelector('[data-add-regua]').onclick = () => {
    newReguaFormOpen = !newReguaFormOpen;
    renderRegua();
    if (newReguaFormOpen) {
      const f = $('#regua-detail [data-new-regua-form]');
      f?.querySelector('input[name="nome"]')?.focus();
    }
  };

  const r = reguaAtiva();
  if (!r) {
    $('#regua-detail').innerHTML = '<p class="vazio">Crie sua primeira régua técnica.</p>';
    return;
  }

  const detail = $('#regua-detail');
  detail.innerHTML = `
    <form class="panel new-regua-form" data-new-regua-form ${newReguaFormOpen ? '' : 'hidden'}>
      <h3>Nova régua</h3>
      <div class="form-grid">
        <label>Nome
          <input name="nome" required maxlength="80" placeholder="ex: Developer Backend">
        </label>
        <label>Descrição (opcional)
          <input name="descricao" maxlength="300" placeholder="Desenvolvedor backend Node + Postgres">
        </label>
      </div>
      <div class="acoes">
        <button type="submit">Criar régua</button>
        <button type="button" class="ghost" data-cancel-new-regua>Cancelar</button>
      </div>
    </form>

    <div class="regua-detail-header">
      <div class="texto">
        <h3>${escape(r.nome)}</h3>
        <p>${escape(r.descricao || 'Sem descrição.')}</p>
      </div>
      <div class="acoes">
        <button class="ghost small" data-edit-regua>renomear</button>
        <button class="danger small" data-del-regua>remover</button>
      </div>
    </div>

    <div class="profs-section">
      <h4>Níveis de proficiência</h4>
      <div class="profs-list">
        ${r.proficiencias.slice().sort((a, b) => (a.peso || 0) - (b.peso || 0)).map(p => `
          <span class="prof-pill">
            <span class="prof-ordem">${p.peso}</span>
            ${escape(p.nome)}
            <button class="ghost mini" data-edit-prof="${p.id}">editar</button>
            <button class="danger mini" data-del-prof="${p.id}">×</button>
          </span>
        `).join('') || '<span style="color:var(--ink-mute);font-size:0.85rem">Nenhum nível definido.</span>'}
      </div>
      <div class="add-prof">
        <input placeholder="Nome do nível (ex: Conhecimento sólido)" data-add-prof maxlength="120">
        <input type="number" placeholder="Peso" data-add-prof-peso min="0" max="100" step="1" aria-label="Peso do nível">
        <button data-add-prof-btn>Adicionar</button>
      </div>
    </div>

    <div class="macros-list">
      <h4>Assuntos macro</h4>
      ${r.assuntosMacro.length ? r.assuntosMacro.map(macro => `
        <article class="macro-card">
          <header>
            <div class="texto">
              <h5>${escape(macro.nome)}</h5>
              ${macro.descricao ? `<p>${escape(macro.descricao)}</p>` : ''}
              <p class="contador">${macro.itens.length} ${macro.itens.length === 1 ? 'marco' : 'marcos'}</p>
            </div>
            <div class="acoes">
              <button class="ghost mini" data-edit-macro="${macro.id}" data-macro-nome="${escape(macro.nome)}" data-macro-desc="${escape(macro.descricao || '')}">editar</button>
              <button class="danger mini" data-del-macro="${macro.id}">remover</button>
            </div>
          </header>
          <ul class="macro-itens">
            ${macro.itens.length ? macro.itens.map(item => `
              <li>
                <div class="linha-topo">
                  <div class="texto">
                    <strong>${escape(item.nome)}</strong>
                    ${item.descricao ? `<span class="item-desc">${escape(item.descricao)}</span>` : ''}
                  </div>
                  <div class="acoes">
                    <button class="ghost small" data-edit-item-macro="${macro.id}|${item.id}" data-item-macro-nome="${escape(item.nome)}" data-item-macro-desc="${escape(item.descricao || '')}">editar</button>
                    <button class="danger small" data-del-item-macro="${macro.id}|${item.id}">remover</button>
                  </div>
                </div>
              </li>
            `).join('') : '<li class="vazio-item">Sem marcos neste assunto. Adicione abaixo.</li>'}
          </ul>
          <div class="add-item-macro">
            <input placeholder="Nome do marco (ex: Faz code review)" data-add-item-macro-nome="${macro.id}" maxlength="120">
            <textarea placeholder="Descrição (opcional)" data-add-item-macro-desc="${macro.id}" maxlength="300"></textarea>
            <div class="linha">
              <button data-add-item-macro-btn="${macro.id}">Adicionar marco</button>
            </div>
          </div>
        </article>
      `).join('') : '<p class="vazio">Nenhum assunto macro. Adicione o primeiro abaixo.</p>'}
    </div>

    <div class="add-macro">
      <h4>Novo assunto macro</h4>
      <div class="form-grid">
        <label>Nome
          <input data-add-macro-nome placeholder="ex: Codificação, Qualidade, SoftSkills" maxlength="80">
        </label>
        <label>Descrição (opcional)
          <input data-add-macro-desc placeholder="Detalhe o que este assunto cobre" maxlength="300">
        </label>
      </div>
      <div class="linha">
        <button data-add-macro-btn>Adicionar assunto</button>
      </div>
    </div>
  `;

  const detailRoot = $('#regua-detail');

  detailRoot.querySelector('[data-edit-regua]').onclick = () => editarRegua(r.id);
  detailRoot.querySelector('[data-del-regua]').onclick = () => removerRegua(r.id);

  const newReguaForm = detailRoot.querySelector('[data-new-regua-form]');
  if (newReguaForm) {
    newReguaForm.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(newReguaForm));
      const created = await fetchJSON('/api/reguas', { method: 'POST', body: data });
      newReguaFormOpen = false;
      activeReguaId = created.id;
      await recarregarReguas();
    };
  }
  detailRoot.querySelector('[data-cancel-new-regua]')?.addEventListener('click', () => {
    newReguaFormOpen = false;
    renderRegua();
  });

  // Proficiências
  detailRoot.querySelectorAll('[data-edit-prof]').forEach(b => {
    b.onclick = () => editarProf(r.id, b.dataset.editProf);
  });
  detailRoot.querySelectorAll('[data-del-prof]').forEach(b => {
    b.onclick = () => removerProf(r.id, b.dataset.delProf);
  });
  detailRoot.querySelector('[data-add-prof-btn]').onclick = () => addProf(r.id);
  detailRoot.querySelector('[data-add-prof]').addEventListener('keydown', e => {
    if (e.key === 'Enter') addProf(r.id);
  });

  // Assuntos macro
  detailRoot.querySelectorAll('[data-edit-macro]').forEach(b => {
    b.onclick = () => editarMacro(r.id, b.dataset.editMacro, b.dataset.macroNome, b.dataset.macroDesc);
  });
  detailRoot.querySelectorAll('[data-del-macro]').forEach(b => {
    b.onclick = () => removerMacro(r.id, b.dataset.delMacro);
  });

  // Itens dentro de assunto macro
  detailRoot.querySelectorAll('[data-edit-item-macro]').forEach(b => {
    b.onclick = () => editarItemMacro(r.id, b.dataset.editItemMacro, b.dataset.itemMacroNome, b.dataset.itemMacroDesc);
  });
  detailRoot.querySelectorAll('[data-del-item-macro]').forEach(b => {
    b.onclick = () => removerItemMacro(r.id, b.dataset.delItemMacro);
  });
  detailRoot.querySelectorAll('[data-add-item-macro-btn]').forEach(b => {
    b.onclick = () => addItemMacro(r.id, b.dataset.addItemMacroBtn);
  });
  detailRoot.querySelectorAll('[data-add-item-macro-nome]').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') addItemMacro(r.id, input.dataset.addItemMacroNome);
    });
  });

  detailRoot.querySelector('[data-add-macro-btn]').onclick = () => addMacro(r.id);
  detailRoot.querySelector('[data-add-macro-nome]').addEventListener('keydown', e => {
    if (e.key === 'Enter') addMacro(r.id);
  });
};

const editarRegua = async (id) => {
  const r = reguas.find(x => x.id === id);
  if (!r) return;
  const nome = prompt('Nome:', r.nome);
  if (nome === null) return;
  const descricao = prompt('Descrição:', r.descricao || '');
  if (descricao === null) return;
  await fetchJSON(`/api/reguas/${id}`, { method: 'PUT', body: { nome, descricao } });
  await recarregarReguas();
};

const removerRegua = async (id) => {
  const r = reguas.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Remover a régua "${r.nome}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await fetchJSON(`/api/reguas/${id}`, { method: 'DELETE' });
    await recarregarReguas();
  } catch (e) {
    alert(e.message);
  }
};

const addProf = async (reguaId) => {
  const input = $('#regua-detail [data-add-prof]');
  const pesoInput = $('#regua-detail [data-add-prof-peso]');
  const nome = input.value.trim();
  if (!nome) return;
  const body = { nome };
  const pesoRaw = pesoInput.value.trim();
  if (pesoRaw !== '') {
    const n = Number(pesoRaw);
    if (Number.isFinite(n)) body.peso = n;
  }
  await fetchJSON(`/api/reguas/${reguaId}/proficiencias`, { method: 'POST', body });
  input.value = '';
  pesoInput.value = '';
  await recarregarReguas();
};

const editarProf = async (reguaId, profId) => {
  const r = reguas.find(x => x.id === reguaId);
  const p = r?.proficiencias.find(x => x.id === profId);
  if (!p) return;
  const nome = prompt('Nome do nível de proficiência:', p.nome);
  if (nome === null || !nome.trim()) return;
  const pesoStr = prompt('Peso (define a ordem no dropdown e a nota do gráfico):', String(p.peso ?? 0));
  if (pesoStr === null) return;
  const peso = Number(pesoStr);
  const body = { nome };
  if (Number.isFinite(peso)) body.peso = peso;
  await fetchJSON(`/api/reguas/${reguaId}/proficiencias/${profId}`, { method: 'PUT', body });
  await recarregarReguas();
};

const removerProf = async (reguaId, profId) => {
  if (!confirm('Remover este nível de proficiência? Será desmarcado dos mentorados.')) return;
  await fetchJSON(`/api/reguas/${reguaId}/proficiencias/${profId}`, { method: 'DELETE' });
  await recarregarReguas();
};

const addMacro = async (reguaId) => {
  const nomeInput = $('#regua-detail [data-add-macro-nome]');
  const descInput = $('#regua-detail [data-add-macro-desc]');
  const nome = nomeInput.value.trim();
  if (!nome) return;
  const descricao = descInput.value.trim();
  await fetchJSON(`/api/reguas/${reguaId}/assuntos-macro`, {
    method: 'POST',
    body: { nome, descricao },
  });
  nomeInput.value = '';
  descInput.value = '';
  await recarregarReguas();
};

const editarMacro = async (reguaId, macroId, nomeAtual, descAtual) => {
  const nome = prompt('Nome do assunto macro:', nomeAtual);
  if (nome === null || !nome.trim()) return;
  const descricao = prompt('Descrição (opcional):', descAtual || '');
  if (descricao === null) return;
  await fetchJSON(`/api/reguas/${reguaId}/assuntos-macro/${macroId}`, {
    method: 'PUT',
    body: { nome, descricao },
  });
  await recarregarReguas();
};

const removerMacro = async (reguaId, macroId) => {
  if (!confirm('Remover este assunto macro e todos os marcos dentro dele?')) return;
  await fetchJSON(`/api/reguas/${reguaId}/assuntos-macro/${macroId}`, { method: 'DELETE' });
  await recarregarReguas();
};

const addItemMacro = async (reguaId, macroId) => {
  const nomeInput = $(`#regua-detail [data-add-item-macro-nome="${macroId}"]`);
  const descInput = $(`#regua-detail [data-add-item-macro-desc="${macroId}"]`);
  const nome = nomeInput.value.trim();
  if (!nome) return;
  const descricao = descInput.value.trim();
  await fetchJSON(`/api/reguas/${reguaId}/assuntos-macro/${macroId}/itens`, {
    method: 'POST',
    body: { nome, descricao },
  });
  nomeInput.value = '';
  descInput.value = '';
  await recarregarReguas();
};

const editarItemMacro = async (reguaId, key, nomeAtual, descAtual) => {
  const [macroId, itemId] = key.split('|');
  const nome = prompt('Nome do marco:', nomeAtual);
  if (nome === null || !nome.trim()) return;
  const descricao = prompt('Descrição (opcional):', descAtual || '');
  if (descricao === null) return;
  await fetchJSON(`/api/reguas/${reguaId}/assuntos-macro/${macroId}/itens/${itemId}`, {
    method: 'PUT',
    body: { nome, descricao },
  });
  await recarregarReguas();
};

const removerItemMacro = async (reguaId, key) => {
  const [macroId, itemId] = key.split('|');
  if (!confirm('Remover este marco?')) return;
  await fetchJSON(`/api/reguas/${reguaId}/assuntos-macro/${macroId}/itens/${itemId}`, { method: 'DELETE' });
  await recarregarReguas();
};

carregar();